-- Candidate profile: one row per signed-in user.
create table if not exists candidates (
    user_id        uuid primary key references auth.users(id) on delete cascade,
    candidate_name text not null,
    office         text,
    jurisdiction   text,
    election_date  date,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

alter table candidates enable row level security;

drop policy if exists candidates_owner on candidates;
create policy candidates_owner on candidates for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Election-aware priority: within 14 days of election, recency / GOTV value surges.
create or replace function voter_priority(p_ncid text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
    with t as (
        select coalesce(generals_voted, 0) as g
        from voter_turnout
        where ncid = p_ncid
    ),
    i as (
        select sentiment, created_at as last_contact
        from interactions
        where voter_ncid = p_ncid
        order by created_at desc
        limit 1
    ),
    c as (
        select election_date - current_date as days_until_election
        from candidates
        where user_id = auth.uid()
    )
    select round(
        greatest(0.0, 1.0 - abs(coalesce((select g from t), 0) - 3) / 5.0) *
        case coalesce((select sentiment from i), 'unknown')
            when 'undecided'           then 1.0
            when 'leaning_supportive'  then 0.7
            when 'leaning_opposed'     then 0.7
            when 'supportive'          then 0.4
            when 'opposed'             then 0.0
            else 0.3
        end *
        case
            when (select last_contact from i) is null then 0.5
            when now() - (select last_contact from i) < interval '3 days'  then 1.0
            when now() - (select last_contact from i) < interval '14 days' then 0.7
            when now() - (select last_contact from i) < interval '30 days' then 0.4
            else 0.2
        end *
        -- GOTV multiplier: inside election window, ranked voters surge.
        case
            when (select days_until_election from c) is null         then 1.0
            when (select days_until_election from c) < 0             then 1.0  -- election passed
            when (select days_until_election from c) <= 3            then 1.8
            when (select days_until_election from c) <= 7            then 1.5
            when (select days_until_election from c) <= 14           then 1.25
            when (select days_until_election from c) <= 30           then 1.1
            else 1.0
        end * 100
    , 1);
$$;

grant execute on function voter_priority(text) to authenticated;

-- Small touch-up: keep updated_at fresh.
create or replace function touch_candidates_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end $$;

drop trigger if exists candidates_touch on candidates;
create trigger candidates_touch before update on candidates
    for each row execute function touch_candidates_updated_at();
