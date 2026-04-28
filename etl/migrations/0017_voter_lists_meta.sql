-- Tag each voter list with the race it represents and the city it covers.
-- Lets a candidate keep separate lists for primary voters vs general voters,
-- or one city's registered voters vs another's, and filter People by them.
alter table voter_lists add column if not exists race_type text
    check (race_type in ('primary_dem','primary_rep','primary_any',
                         'general','municipal','special','unspecified'))
    default 'unspecified';
alter table voter_lists add column if not exists city text;

-- Surface list memberships in the People view so the UI can filter by list.
-- We extend people_talked_to to return a `list_ids` array per matched voter
-- (unmatched conversations have no NCID, so list_ids stays NULL there).
drop function if exists people_talked_to(int);
create or replace function people_talked_to(p_limit int default 500)
returns table (
    voter_ncid           text,
    first_name           text,
    last_name            text,
    res_street_address   text,
    res_city             text,
    party_cd             text,
    last_interaction_id  uuid,
    last_sentiment       text,
    last_notes           text,
    last_issues          text[],
    last_tags            text[],
    last_contact         timestamptz,
    interaction_count    int,
    relevant_votes       int,
    total_votes          int,
    is_unmatched         boolean,
    captured_name        text,
    list_ids             uuid[]
)
language sql
stable
security invoker
set search_path = public
as $$
    with mine as (
        select distinct voter_ncid
        from interactions
        where user_id = auth.uid() and voter_ncid is not null
    ),
    latest_matched as (
        select distinct on (i.voter_ncid)
            i.voter_ncid, i.id as last_interaction_id, i.sentiment, i.notes,
            i.issues, i.tags, i.created_at, i.captured_name
        from interactions i
        join mine m on m.voter_ncid = i.voter_ncid
        where i.user_id = auth.uid()
        order by i.voter_ncid, i.created_at desc
    ),
    matched as (
        select
            v.ncid                       as voter_ncid,
            v.first_name,
            v.last_name,
            v.res_street_address,
            v.res_city,
            v.party_cd,
            l.last_interaction_id,
            l.sentiment                  as last_sentiment,
            l.notes                      as last_notes,
            l.issues                     as last_issues,
            l.tags                       as last_tags,
            l.created_at                 as last_contact,
            (select count(*)::int
               from interactions i2
               where i2.voter_ncid = v.ncid and i2.user_id = auth.uid())   as interaction_count,
            ((voter_relevance(v.ncid)->>'relevant_votes')::int)            as relevant_votes,
            ((voter_relevance(v.ncid)->>'total_votes')::int)               as total_votes,
            false                        as is_unmatched,
            l.captured_name              as captured_name,
            (select coalesce(array_agg(vlm.list_id), '{}'::uuid[])
               from voter_list_members vlm
               join voter_lists vl on vl.id = vlm.list_id
               where vlm.voter_ncid = v.ncid
                 and vl.user_id = auth.uid())                              as list_ids
        from voters v
        join latest_matched l on l.voter_ncid = v.ncid
    ),
    latest_unmatched as (
        select distinct on (lower(coalesce(captured_name, '(no name)')))
            id as last_interaction_id, sentiment, notes, issues, tags,
            created_at, captured_name
        from interactions
        where user_id = auth.uid() and voter_ncid is null
        order by lower(coalesce(captured_name, '(no name)')), created_at desc
    ),
    unmatched as (
        select
            null::text                   as voter_ncid,
            null::text                   as first_name,
            null::text                   as last_name,
            null::text                   as res_street_address,
            null::text                   as res_city,
            null::text                   as party_cd,
            u.last_interaction_id,
            u.sentiment                  as last_sentiment,
            u.notes                      as last_notes,
            u.issues                     as last_issues,
            u.tags                       as last_tags,
            u.created_at                 as last_contact,
            (select count(*)::int
               from interactions i2
               where lower(coalesce(i2.captured_name, '(no name)')) =
                     lower(coalesce(u.captured_name, '(no name)'))
                 and i2.user_id = auth.uid()
                 and i2.voter_ncid is null)                                as interaction_count,
            null::int                    as relevant_votes,
            null::int                    as total_votes,
            true                         as is_unmatched,
            u.captured_name              as captured_name,
            null::uuid[]                 as list_ids
        from latest_unmatched u
    )
    select * from matched
    union all
    select * from unmatched
    order by last_contact desc
    limit p_limit;
$$;

grant execute on function people_talked_to(int) to authenticated;
