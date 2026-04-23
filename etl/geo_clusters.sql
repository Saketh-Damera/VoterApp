-- Real geographic clustering. For every contacted voter with coordinates,
-- group into clusters where every point is within ~eps meters of at least one
-- neighbor. Default eps: 150m (about a short city block), min_pts: 2.
-- Uses ST_ClusterDBSCAN, which is exactly this algorithm.
create or replace function geo_clusters(
    p_eps_meters double precision default 150,
    p_min_pts    int default 2
)
returns table (
    cluster_id     int,
    people_count   int,
    centroid_lat   double precision,
    centroid_lng   double precision,
    members        jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
    with contacted as (
        select distinct on (i.voter_ncid)
            i.voter_ncid, i.sentiment, i.created_at
        from interactions i
        where i.user_id = auth.uid() and i.voter_ncid is not null
        order by i.voter_ncid, i.created_at desc
    ),
    joined as (
        select
            v.ncid,
            v.first_name,
            v.last_name,
            v.res_street_address,
            v.res_city,
            v.party_cd,
            v.lat, v.lng,
            c.sentiment,
            c.created_at,
            voter_priority(v.ncid) as priority,
            st_setsrid(st_makepoint(v.lng, v.lat), 4326) as g
        from contacted c
        join voters v on v.ncid = c.voter_ncid
        where v.lat is not null and v.lng is not null
    ),
    clustered as (
        select *,
            st_clusterdbscan(g, eps := p_eps_meters / 111320.0, minpoints := p_min_pts)
                over () as cid
        from joined
    ),
    only_clustered as (
        select * from clustered where cid is not null
    )
    select
        c.cid as cluster_id,
        count(*)::int as people_count,
        avg(c.lat) as centroid_lat,
        avg(c.lng) as centroid_lng,
        jsonb_agg(
            jsonb_build_object(
                'ncid',      c.ncid,
                'first_name',c.first_name,
                'last_name', c.last_name,
                'address',   c.res_street_address,
                'city',      c.res_city,
                'party',     c.party_cd,
                'sentiment', c.sentiment,
                'priority',  c.priority,
                'lat',       c.lat,
                'lng',       c.lng
            )
            order by c.created_at desc
        ) as members
    from only_clustered c
    group by c.cid
    order by people_count desc;
$$;

grant execute on function geo_clusters(double precision, int) to authenticated;
