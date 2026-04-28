-- Enable PostGIS for radius queries.
create extension if not exists postgis;

-- Add lat/lng to voters. We geocode lazily (only for contacted voters) to avoid
-- batch-geocoding 200k+ addresses.
alter table voters add column if not exists lat      double precision;
alter table voters add column if not exists lng      double precision;
alter table voters add column if not exists geocoded_at timestamptz;

-- Spatial index via a generated geography column.
alter table voters add column if not exists geog geography(point, 4326)
    generated always as (
        case when lat is not null and lng is not null
             then st_setsrid(st_makepoint(lng, lat), 4326)::geography
             else null
        end
    ) stored;
create index if not exists voters_geog_idx on voters using gist (geog);

-- Map view: all voters the current user has talked to, plus their coordinates
-- (skipping any we haven't geocoded yet).
create or replace function map_contacted_voters()
returns table (
    ncid               text,
    first_name         text,
    last_name          text,
    res_street_address text,
    res_city           text,
    party_cd           text,
    lat                double precision,
    lng                double precision,
    last_sentiment     text,
    priority           numeric
)
language sql
stable
security invoker
set search_path = public
as $$
    with contacted as (
        select distinct on (i.voter_ncid) i.voter_ncid, i.sentiment
        from interactions i
        where i.user_id = auth.uid() and i.voter_ncid is not null
        order by i.voter_ncid, i.created_at desc
    )
    select
        v.ncid, v.first_name, v.last_name,
        v.res_street_address, v.res_city, v.party_cd,
        v.lat, v.lng,
        c.sentiment as last_sentiment,
        voter_priority(v.ncid) as priority
    from contacted c
    join voters v on v.ncid = c.voter_ncid
    where v.lat is not null and v.lng is not null;
$$;

grant execute on function map_contacted_voters() to authenticated;

-- Radius search: voters in the user's lists within D miles of (lat, lng),
-- optionally filtered by party. Limit to 500 markers.
create or replace function voters_within_radius(
    p_lat        double precision,
    p_lng        double precision,
    p_miles      double precision,
    p_party      text default null,
    p_contacted_only boolean default false,
    p_limit      int default 500
)
returns table (
    ncid               text,
    first_name         text,
    last_name          text,
    res_street_address text,
    res_city           text,
    party_cd           text,
    lat                double precision,
    lng                double precision,
    distance_mi        double precision,
    has_interaction    boolean
)
language sql
stable
security invoker
set search_path = public
as $$
    with target as (
        select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
    ),
    contacted as (
        select distinct voter_ncid
        from interactions
        where user_id = auth.uid() and voter_ncid is not null
    )
    select
        v.ncid, v.first_name, v.last_name,
        v.res_street_address, v.res_city, v.party_cd,
        v.lat, v.lng,
        st_distance(v.geog, (select g from target)) / 1609.344 as distance_mi,
        (c.voter_ncid is not null) as has_interaction
    from voters v
    cross join target
    left join contacted c on c.voter_ncid = v.ncid
    where v.geog is not null
      and st_dwithin(v.geog, target.g, p_miles * 1609.344)
      and (p_party is null or v.party_cd = p_party)
      and (not p_contacted_only or c.voter_ncid is not null)
    order by distance_mi
    limit p_limit;
$$;

grant execute on function voters_within_radius(double precision, double precision, double precision, text, boolean, int) to authenticated;
