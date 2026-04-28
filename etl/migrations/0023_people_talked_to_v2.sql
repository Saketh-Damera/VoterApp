-- Rebuild people_talked_to to read from interaction_participants. Each row is
-- a unique person the candidate has talked to (deduped by voter_ncid when
-- matched, by lower(captured_name) when unlinked). Returns the most-recent
-- participant row's data plus list_ids and a turnout snapshot.
drop function if exists people_talked_to(int);
create or replace function people_talked_to(p_limit int default 500)
returns table (
    voter_ncid           text,
    first_name           text,
    last_name            text,
    res_street_address   text,
    res_city             text,
    party_cd             text,
    last_participant_id  uuid,
    last_interaction_id  uuid,
    last_sentiment       text,
    last_notes           text,
    last_issues          text[],
    last_tags            text[],
    last_relationship    text,
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
    -- Pull every participant row that belongs to a conversation owned by the
    -- caller. A participant either has a voter_ncid (matched) or just a
    -- captured_name (unmatched). Latest-per-person wins.
    with mine as (
        select p.*, i.created_at as conv_at, i.user_id
          from interaction_participants p
          join interactions i on i.id = p.interaction_id
         where i.user_id = auth.uid()
    ),
    latest_matched as (
        select distinct on (voter_ncid)
            voter_ncid, id as participant_id, interaction_id,
            sentiment, issues, tags, notes, relationship, captured_name, conv_at
        from mine
        where voter_ncid is not null
        order by voter_ncid, conv_at desc, created_at desc
    ),
    matched as (
        select
            v.ncid                       as voter_ncid,
            v.first_name,
            v.last_name,
            v.res_street_address,
            v.res_city,
            v.party_cd,
            l.participant_id             as last_participant_id,
            l.interaction_id             as last_interaction_id,
            l.sentiment                  as last_sentiment,
            l.notes                      as last_notes,
            l.issues                     as last_issues,
            l.tags                       as last_tags,
            l.relationship               as last_relationship,
            l.conv_at                    as last_contact,
            (select count(*)::int from mine m2 where m2.voter_ncid = v.ncid)        as interaction_count,
            ((voter_relevance(v.ncid)->>'relevant_votes')::int)                     as relevant_votes,
            ((voter_relevance(v.ncid)->>'total_votes')::int)                        as total_votes,
            false                        as is_unmatched,
            l.captured_name              as captured_name,
            (select coalesce(array_agg(vlm.list_id), '{}'::uuid[])
               from voter_list_members vlm
               join voter_lists vl on vl.id = vlm.list_id
               where vlm.voter_ncid = v.ncid
                 and vl.user_id = auth.uid())                                       as list_ids
        from voters v
        join latest_matched l on l.voter_ncid = v.ncid
    ),
    latest_unmatched as (
        select distinct on (lower(coalesce(captured_name, '(no name)')))
            id as participant_id, interaction_id, sentiment, issues, tags, notes,
            relationship, captured_name, conv_at
        from mine
        where voter_ncid is null
        order by lower(coalesce(captured_name, '(no name)')), conv_at desc, created_at desc
    ),
    unmatched as (
        select
            null::text                   as voter_ncid,
            null::text                   as first_name,
            null::text                   as last_name,
            null::text                   as res_street_address,
            null::text                   as res_city,
            null::text                   as party_cd,
            u.participant_id             as last_participant_id,
            u.interaction_id             as last_interaction_id,
            u.sentiment                  as last_sentiment,
            u.notes                      as last_notes,
            u.issues                     as last_issues,
            u.tags                       as last_tags,
            u.relationship               as last_relationship,
            u.conv_at                    as last_contact,
            (select count(*)::int from mine m2
              where m2.voter_ncid is null
                and lower(coalesce(m2.captured_name, '(no name)')) =
                    lower(coalesce(u.captured_name, '(no name)')))                  as interaction_count,
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
