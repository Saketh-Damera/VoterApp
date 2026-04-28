-- Candidates declare the type of race they're in. This reshapes what
-- "relevant turnout" means for a given voter.
alter table candidates add column if not exists race_type text
    check (race_type in ('primary_dem','primary_rep','primary_any',
                         'general','municipal','special','unspecified'))
    default 'unspecified';
alter table candidates add column if not exists race_party text; -- optional, for primary

-- How many times has this voter participated in races matching the
-- candidate's race_type? Plus total lifetime participations for a sanity anchor.
create or replace function voter_relevance(p_ncid text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
    v_race text;
    v_party text;
    v_total int;
    v_relevant int;
    v_recent int;
    v_last date;
begin
    select race_type, race_party
      into v_race, v_party
      from candidates where user_id = auth.uid();

    -- Lifetime + last_voted sanity numbers
    select count(*)::int, max(election_date)
      into v_total, v_last
      from vote_history where ncid = p_ncid;

    -- Relevant count: depends on race_type
    if v_race = 'primary_dem' then
        select count(*)::int into v_relevant
        from vote_history
        where ncid = p_ncid
          and election_desc ilike '%primary%'
          and voted_party_cd = 'DEM';
    elsif v_race = 'primary_rep' then
        select count(*)::int into v_relevant
        from vote_history
        where ncid = p_ncid
          and election_desc ilike '%primary%'
          and voted_party_cd = 'REP';
    elsif v_race = 'primary_any' then
        select count(*)::int into v_relevant
        from vote_history
        where ncid = p_ncid and election_desc ilike '%primary%';
    elsif v_race = 'general' then
        select count(*)::int into v_relevant
        from vote_history
        where ncid = p_ncid and election_desc ilike '%general%';
    elsif v_race = 'municipal' then
        select count(*)::int into v_relevant
        from vote_history
        where ncid = p_ncid and election_desc ilike '%municipal%';
    elsif v_race = 'special' then
        select count(*)::int into v_relevant
        from vote_history
        where ncid = p_ncid and election_desc ilike '%special%';
    else
        v_relevant := v_total;
    end if;

    -- Recent activity: votes in the last 6 years
    select count(*)::int into v_recent
    from vote_history
    where ncid = p_ncid and election_date > now() - interval '6 years';

    return jsonb_build_object(
        'race_type', coalesce(v_race, 'unspecified'),
        'race_party', v_party,
        'total_votes', v_total,
        'relevant_votes', v_relevant,
        'recent_votes', v_recent,
        'last_voted', v_last
    );
end $$;

grant execute on function voter_relevance(text) to authenticated;

-- Replace top_priority_actions to return upcoming reminders WITHOUT the score.
-- We order by due_at ascending so the soonest follow-up shows first.
drop function if exists top_priority_actions(int);
create or replace function top_priority_actions(p_limit int default 3)
returns table (
    id          uuid,
    voter_ncid  text,
    first_name  text,
    last_name   text,
    res_city    text,
    message     text,
    due_at      timestamptz,
    sentiment   text,
    relevant_votes int,
    total_votes    int
)
language sql
stable
security invoker
set search_path = public
as $$
    select
        r.id,
        r.voter_ncid,
        v.first_name,
        v.last_name,
        v.res_city,
        r.message,
        r.due_at,
        (
            select i.sentiment
            from interactions i
            where i.voter_ncid = r.voter_ncid
            order by i.created_at desc
            limit 1
        ) as sentiment,
        ((voter_relevance(r.voter_ncid)->>'relevant_votes')::int) as relevant_votes,
        ((voter_relevance(r.voter_ncid)->>'total_votes')::int) as total_votes
    from reminders r
    left join voters v on v.ncid = r.voter_ncid
    where r.user_id = auth.uid()
      and r.status = 'pending'
    order by r.due_at asc
    limit p_limit;
$$;

grant execute on function top_priority_actions(int) to authenticated;
