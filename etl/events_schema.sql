create table if not exists events (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references auth.users(id) on delete cascade,
    title               text not null,
    location            text,
    event_date          timestamptz,
    notes               text,
    brief               text,
    brief_generated_at  timestamptz,
    created_at          timestamptz not null default now()
);

alter table events enable row level security;
drop policy if exists events_owner on events;
create policy events_owner on events for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists event_attendees (
    event_id   uuid not null references events(id) on delete cascade,
    voter_ncid text not null references voters(ncid) on delete cascade,
    note       text,
    added_at   timestamptz not null default now(),
    primary key (event_id, voter_ncid)
);

alter table event_attendees enable row level security;
drop policy if exists event_attendees_owner on event_attendees;
create policy event_attendees_owner on event_attendees for all
    using (exists (select 1 from events e where e.id = event_attendees.event_id and e.user_id = auth.uid()))
    with check (exists (select 1 from events e where e.id = event_attendees.event_id and e.user_id = auth.uid()));

create index if not exists event_attendees_voter on event_attendees (voter_ncid);
