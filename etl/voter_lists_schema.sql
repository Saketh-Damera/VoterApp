-- Each candidate owns one or more voter lists; voters/vote_history live under a list.
create table if not exists voter_lists (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    name            text not null,
    state           text,
    source_filename text,
    row_count       integer not null default 0,
    created_at      timestamptz not null default now()
);

alter table voter_lists enable row level security;

drop policy if exists voter_lists_owner on voter_lists;
create policy voter_lists_owner on voter_lists for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Add list_id to voters; nullable for now (back-compat with seeded demo data).
alter table voters add column if not exists list_id uuid references voter_lists(id) on delete cascade;
create index if not exists voters_list_id on voters (list_id);

-- Replace voters RLS: each user sees their own list's voters OR the public demo set (list_id IS NULL).
drop policy if exists voters_read on voters;
create policy voters_read on voters for select using (
    auth.role() = 'authenticated' and (
        list_id is null
        or exists (select 1 from voter_lists vl where vl.id = voters.list_id and vl.user_id = auth.uid())
    )
);
-- Allow inserts only into one of the user's own lists.
drop policy if exists voters_insert on voters;
create policy voters_insert on voters for insert with check (
    list_id is not null and exists (
        select 1 from voter_lists vl where vl.id = voters.list_id and vl.user_id = auth.uid()
    )
);
drop policy if exists voters_delete on voters;
create policy voters_delete on voters for delete using (
    list_id is not null and exists (
        select 1 from voter_lists vl where vl.id = voters.list_id and vl.user_id = auth.uid()
    )
);

-- vote_history inherits list visibility through the voter it points to.
drop policy if exists vote_history_read on vote_history;
create policy vote_history_read on vote_history for select using (
    exists (
        select 1 from voters v
        where v.ncid = vote_history.ncid
          and (v.list_id is null or exists (
              select 1 from voter_lists vl where vl.id = v.list_id and vl.user_id = auth.uid()
          ))
    )
);
