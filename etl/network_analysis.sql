-- Network analysis: derive connections between contacted voters from
-- (a) shared household address and (b) co-attendance at the same event.
-- Nothing is persisted — the edges are computed from facts we already track.

-- Returns the full edge list for the current user's contacted voters.
create or replace function network_edges()
returns table (
    a_ncid       text,
    b_ncid       text,
    reason       text,
    detail       text
)
language sql
stable
security invoker
set search_path = public
as $$
    with contacted as (
        select distinct voter_ncid as ncid
        from interactions
        where user_id = auth.uid() and voter_ncid is not null
    ),
    contacted_info as (
        select c.ncid, v.res_street_address, v.res_city
        from contacted c
        join voters v on v.ncid = c.ncid
    ),
    household_edges as (
        select
            a.ncid as a_ncid,
            b.ncid as b_ncid,
            'household' as reason,
            a.res_street_address || coalesce(', ' || a.res_city, '') as detail
        from contacted_info a
        join contacted_info b on
            a.res_street_address = b.res_street_address
            and a.res_city is not distinct from b.res_city
            and a.res_street_address <> ''
            and a.ncid < b.ncid
    ),
    event_edges as (
        select
            a.voter_ncid as a_ncid,
            b.voter_ncid as b_ncid,
            'event' as reason,
            e.title as detail
        from events e
        join event_attendees a on a.event_id = e.id
        join event_attendees b on b.event_id = e.id and a.voter_ncid < b.voter_ncid
        where e.user_id = auth.uid()
          and exists (select 1 from contacted c where c.ncid = a.voter_ncid)
          and exists (select 1 from contacted c where c.ncid = b.voter_ncid)
    )
    select * from household_edges
    union all
    select * from event_edges
$$;

grant execute on function network_edges() to authenticated;

-- Super-connectors: who has the most connections among your contacted set.
create or replace function super_connectors(p_limit int default 10)
returns table (
    ncid            text,
    first_name      text,
    last_name       text,
    res_city        text,
    degree          int,
    household_ties  int,
    event_ties      int,
    connections     jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
    with edges as (select * from network_edges()),
    undirected as (
        select a_ncid as self, b_ncid as other, reason, detail from edges
        union all
        select b_ncid as self, a_ncid as other, reason, detail from edges
    ),
    grouped as (
        select
            self,
            count(distinct other) as degree,
            count(distinct case when reason = 'household' then other end) as household_ties,
            count(distinct case when reason = 'event'     then other end) as event_ties,
            jsonb_agg(distinct jsonb_build_object(
                'ncid', other, 'reason', reason, 'detail', detail
            )) as connections
        from undirected
        group by self
    )
    select
        g.self as ncid,
        v.first_name,
        v.last_name,
        v.res_city,
        g.degree::int,
        g.household_ties::int,
        g.event_ties::int,
        g.connections
    from grouped g
    join voters v on v.ncid = g.self
    where g.degree >= 1
    order by g.degree desc
    limit p_limit;
$$;

grant execute on function super_connectors(int) to authenticated;

-- Overall network stats for the dashboard.
create or replace function network_stats()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
    with e as (select * from network_edges()),
    nodes as (select ncid from (
        select a_ncid as ncid from e union select b_ncid from e
    ) x)
    select jsonb_build_object(
        'edges', (select count(*) from e),
        'household_edges', (select count(*) from e where reason = 'household'),
        'event_edges', (select count(*) from e where reason = 'event'),
        'connected_people', (select count(*) from nodes),
        'total_contacted', (select count(distinct voter_ncid)
                            from interactions
                            where user_id = auth.uid() and voter_ncid is not null)
    )
$$;

grant execute on function network_stats() to authenticated;
