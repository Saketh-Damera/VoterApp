-- people_talked_to: returns relevant + total vote counts plus the latest
-- interaction id so the table can edit it inline.
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
    total_votes          int
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
    latest as (
        select distinct on (i.voter_ncid)
            i.voter_ncid, i.id as last_interaction_id, i.sentiment, i.notes,
            i.issues, i.tags, i.created_at
        from interactions i
        join mine m on m.voter_ncid = i.voter_ncid
        where i.user_id = auth.uid()
        order by i.voter_ncid, i.created_at desc
    )
    select
        v.ncid as voter_ncid,
        v.first_name,
        v.last_name,
        v.res_street_address,
        v.res_city,
        v.party_cd,
        l.last_interaction_id,
        l.sentiment as last_sentiment,
        l.notes     as last_notes,
        l.issues    as last_issues,
        l.tags      as last_tags,
        l.created_at as last_contact,
        (select count(*)::int from interactions i2 where i2.voter_ncid = v.ncid and i2.user_id = auth.uid()) as interaction_count,
        ((voter_relevance(v.ncid)->>'relevant_votes')::int) as relevant_votes,
        ((voter_relevance(v.ncid)->>'total_votes')::int) as total_votes
    from voters v
    join latest l on l.voter_ncid = v.ncid
    order by l.created_at desc
    limit p_limit;
$$;

grant execute on function people_talked_to(int) to authenticated;
