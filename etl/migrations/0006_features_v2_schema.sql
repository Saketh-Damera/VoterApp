-- Candidate extras: fundraising goal, personal scratchpad.
alter table candidates add column if not exists fundraising_goal numeric(12,2);
alter table candidates add column if not exists scratchpad text default '';

-- Personal to-dos (distinct from reminders which are tied to a voter interaction).
create table if not exists todos (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users(id) on delete cascade,
    title      text not null,
    notes      text,
    due_date   date,
    status     text not null default 'pending' check (status in ('pending','done')),
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create index if not exists todos_user_status on todos (user_id, status, due_date nulls last);

alter table todos enable row level security;
drop policy if exists todos_owner on todos;
create policy todos_owner on todos for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Fundraising pipeline.
create table if not exists fundraising_prospects (
    id                   uuid primary key default gen_random_uuid(),
    user_id              uuid not null references auth.users(id) on delete cascade,
    voter_ncid           text references voters(ncid) on delete set null,
    full_name            text not null,
    email                text,
    phone                text,
    employer             text,
    role                 text,
    estimated_capacity   numeric(12,2),
    asked_amount         numeric(12,2),
    committed_amount     numeric(12,2),
    donated_amount       numeric(12,2),
    status               text not null default 'prospect'
                         check (status in ('prospect','asked','committed','donated','declined')),
    notes                text,
    next_step            text,
    next_step_date       date,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);

create index if not exists fp_user_status on fundraising_prospects (user_id, status);

alter table fundraising_prospects enable row level security;
drop policy if exists fp_owner on fundraising_prospects;
create policy fp_owner on fundraising_prospects for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep updated_at fresh on fundraising_prospects.
create or replace function touch_fp_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end $$;

drop trigger if exists fp_touch on fundraising_prospects;
create trigger fp_touch before update on fundraising_prospects
    for each row execute function touch_fp_updated_at();

-- Dashboard summary: one call returns totals a candidate cares about.
create or replace function dashboard_stats()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
    select jsonb_build_object(
        'people_tracked', (
            select count(distinct voter_ncid) from interactions
            where user_id = auth.uid() and voter_ncid is not null
        ),
        'interactions_total', (
            select count(*) from interactions where user_id = auth.uid()
        ),
        'interactions_7d', (
            select count(*) from interactions
            where user_id = auth.uid() and created_at > now() - interval '7 days'
        ),
        'supportive_count', (
            select count(*) from interactions
            where user_id = auth.uid()
              and sentiment in ('supportive','leaning_supportive')
        ),
        'undecided_count', (
            select count(*) from interactions
            where user_id = auth.uid() and sentiment = 'undecided'
        ),
        'pending_reminders', (
            select count(*) from reminders
            where user_id = auth.uid() and status = 'pending'
        ),
        'pending_todos', (
            select count(*) from todos
            where user_id = auth.uid() and status = 'pending'
        ),
        'fundraising_committed', (
            select coalesce(sum(committed_amount),0) from fundraising_prospects
            where user_id = auth.uid() and status in ('committed','donated')
        ),
        'fundraising_donated', (
            select coalesce(sum(donated_amount),0) from fundraising_prospects
            where user_id = auth.uid() and status = 'donated'
        ),
        'fundraising_goal', (
            select fundraising_goal from candidates where user_id = auth.uid()
        )
    )
$$;

grant execute on function dashboard_stats() to authenticated;
