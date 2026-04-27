-- Many-to-many between voter_lists and voters. The voters table stays
-- deduplicated by ncid (a state's voter ID is global within the state's data),
-- but a voter can now belong to multiple lists — e.g. a "Tenafly Registered
-- Voters" list AND a "Tenafly Primary Voters" subset list.
create table if not exists voter_list_members (
    list_id    uuid not null references voter_lists(id) on delete cascade,
    voter_ncid text not null references voters(ncid) on delete cascade,
    added_at   timestamptz not null default now(),
    primary key (list_id, voter_ncid)
);

create index if not exists vlm_voter on voter_list_members (voter_ncid);

-- Backfill from existing voters.list_id (whatever first list a voter landed in)
insert into voter_list_members (list_id, voter_ncid)
select list_id, ncid from voters where list_id is not null
on conflict do nothing;

-- RLS: visibility through list ownership / sample flag
alter table voter_list_members enable row level security;
drop policy if exists vlm_read on voter_list_members;
create policy vlm_read on voter_list_members for select using (
    exists (
        select 1 from voter_lists vl
        where vl.id = voter_list_members.list_id
          and (vl.user_id = auth.uid() or vl.is_sample = true)
    )
);
drop policy if exists vlm_insert on voter_list_members;
create policy vlm_insert on voter_list_members for insert with check (
    exists (
        select 1 from voter_lists vl
        where vl.id = voter_list_members.list_id
          and vl.user_id = auth.uid()
    )
);
drop policy if exists vlm_delete on voter_list_members;
create policy vlm_delete on voter_list_members for delete using (
    exists (
        select 1 from voter_lists vl
        where vl.id = voter_list_members.list_id
          and vl.user_id = auth.uid()
    )
);

-- Update voters_read so a voter is visible if you own ANY list they're in
-- (via voter_list_members) — not just the legacy first list_id column.
drop policy if exists voters_read on voters;
create policy voters_read on voters for select using (
    auth.role() = 'authenticated' and (
        list_id is null
        or exists (
            select 1 from voter_lists vl
            where vl.id = voters.list_id
              and (vl.user_id = auth.uid() or vl.is_sample = true)
        )
        or exists (
            select 1 from voter_list_members vlm
            join voter_lists vl on vl.id = vlm.list_id
            where vlm.voter_ncid = voters.ncid
              and (vl.user_id = auth.uid() or vl.is_sample = true)
        )
    )
);

-- vote_history visibility piggy-backs on voters
drop policy if exists vote_history_read on vote_history;
create policy vote_history_read on vote_history for select using (
    exists (
        select 1 from voters v
        where v.ncid = vote_history.ncid
          and (
              v.list_id is null
              or exists (
                  select 1 from voter_lists vl
                  where vl.id = v.list_id
                    and (vl.user_id = auth.uid() or vl.is_sample = true)
              )
              or exists (
                  select 1 from voter_list_members vlm
                  join voter_lists vl on vl.id = vlm.list_id
                  where vlm.voter_ncid = v.ncid
                    and (vl.user_id = auth.uid() or vl.is_sample = true)
              )
          )
    )
);
