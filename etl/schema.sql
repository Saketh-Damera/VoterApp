-- Voter Intelligence Notebook — Postgres schema for Supabase.
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

create table if not exists voters (
    ncid               text primary key,
    voter_reg_num      text,
    first_name         text,
    middle_name        text,
    last_name          text,
    name_suffix        text,
    full_name          text generated always as (
        trim(
            coalesce(first_name,'') || ' ' ||
            coalesce(middle_name,'') || ' ' ||
            coalesce(last_name,'')   || ' ' ||
            coalesce(name_suffix,'')
        )
    ) stored,
    res_street_address text,
    res_city           text,
    res_zip            text,
    party_cd           text,
    gender_code        text,
    race_code          text,
    ethnic_code        text,
    birth_year         smallint,
    age                smallint,
    registr_dt         date,
    precinct_abbrv     text,
    precinct_desc      text,
    ward_abbrv         text,
    ward_desc          text,
    municipality_desc  text
);

create index if not exists voters_full_name_trgm on voters using gin (full_name gin_trgm_ops);
create index if not exists voters_last_name_trgm on voters using gin (last_name gin_trgm_ops);
create index if not exists voters_address        on voters (res_street_address, res_city);
create index if not exists voters_precinct       on voters (precinct_abbrv);

create table if not exists vote_history (
    id             bigserial primary key,
    ncid           text not null references voters(ncid) on delete cascade,
    election_date  date not null,
    election_desc  text,
    voting_method  text,
    voted_party_cd text
);

create index if not exists vote_history_ncid on vote_history (ncid);
create index if not exists vote_history_date on vote_history (election_date desc);

create materialized view if not exists voter_turnout as
select
    v.ncid,
    count(vh.id)                                               as elections_voted,
    max(vh.election_date)                                      as last_voted,
    count(*) filter (where vh.election_desc ilike '%GENERAL%') as generals_voted,
    count(*) filter (where vh.election_desc ilike '%PRIMARY%') as primaries_voted
from voters v
left join vote_history vh on vh.ncid = v.ncid
group by v.ncid;

create unique index if not exists voter_turnout_ncid on voter_turnout (ncid);

create table if not exists interactions (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users(id) on delete cascade,
    voter_ncid        text references voters(ncid) on delete set null,
    captured_name     text not null,
    captured_location text,
    notes             text,
    match_confidence  numeric(4,3),
    issues            text[],
    sentiment         text,
    tags              text[],
    created_at        timestamptz not null default now()
);

create index if not exists interactions_user_created on interactions (user_id, created_at desc);
create index if not exists interactions_voter        on interactions (voter_ncid);

create table if not exists reminders (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    interaction_id  uuid references interactions(id) on delete cascade,
    voter_ncid      text references voters(ncid) on delete set null,
    due_at          timestamptz not null,
    message         text,
    status          text not null default 'pending' check (status in ('pending','done','snoozed')),
    created_at      timestamptz not null default now()
);

create index if not exists reminders_user_pending on reminders (user_id, due_at) where status = 'pending';

alter table interactions enable row level security;
alter table reminders    enable row level security;
alter table voters       enable row level security;
alter table vote_history enable row level security;

create policy interactions_owner on interactions for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy reminders_owner on reminders for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy voters_read       on voters       for select using (auth.role() = 'authenticated');
create policy vote_history_read on vote_history for select using (auth.role() = 'authenticated');
