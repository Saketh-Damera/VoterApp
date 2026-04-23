-- Derive a "street key" by stripping the leading house number, for grouping neighbors.
create or replace function street_key(addr text, city text)
returns text
language sql
immutable
as $$
    select case
        when addr is null or addr = '' then null
        else lower(trim(regexp_replace(addr, '^\d+[A-Za-z]?\s+', ''))) || '|' || lower(coalesce(city,''))
    end
$$;

-- For the current user's contacted voters, cluster by street and return summary.
create or replace function contacted_clusters(p_limit int default 50)
returns table (
    street_label      text,
    city              text,
    people_count      int,
    latest_contact    timestamptz,
    avg_priority      numeric,
    top_sentiments    text[],
    voter_ncids       text[]
)
language sql
stable
security invoker
set search_path = public
as $$
    with contacted as (
        select distinct on (i.voter_ncid)
            i.voter_ncid, i.created_at, i.sentiment
        from interactions i
        where i.user_id = auth.uid() and i.voter_ncid is not null
        order by i.voter_ncid, i.created_at desc
    ),
    joined as (
        select
            v.ncid,
            v.res_street_address,
            v.res_city,
            street_key(v.res_street_address, v.res_city) as skey,
            c.created_at,
            c.sentiment
        from contacted c
        join voters v on v.ncid = c.voter_ncid
        where v.res_street_address is not null and v.res_street_address <> ''
    )
    select
        -- human-friendly label: keep the first address's street portion
        (select trim(regexp_replace(res_street_address, '^\d+[A-Za-z]?\s+', ''))
         from joined j2 where j2.skey = j.skey limit 1) as street_label,
        j.res_city as city,
        count(*)::int as people_count,
        max(j.created_at) as latest_contact,
        round(avg(voter_priority(j.ncid))::numeric, 1) as avg_priority,
        array_agg(distinct j.sentiment) filter (where j.sentiment is not null) as top_sentiments,
        array_agg(j.ncid order by j.created_at desc) as voter_ncids
    from joined j
    where j.skey is not null
    group by j.skey, j.res_city
    having count(*) >= 1
    order by people_count desc, latest_contact desc
    limit p_limit;
$$;

grant execute on function contacted_clusters(int) to authenticated;
