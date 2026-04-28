-- Shared-sample voter lists: any authenticated user can read voters in them.
-- Intended for canned demo datasets (e.g. NC Durham).
alter table voter_lists add column if not exists is_sample boolean not null default false;

-- Flag the seeded Durham list as sample so newly signed-up users see it when they opt in.
update voter_lists
set is_sample = true
where name ilike '%durham%' and state = 'NC';

-- Update voters RLS to allow reading voters in any is_sample=true list.
drop policy if exists voters_read on voters;
create policy voters_read on voters for select using (
    auth.role() = 'authenticated' and (
        list_id is null
        or exists (
            select 1 from voter_lists vl
            where vl.id = voters.list_id
              and (vl.user_id = auth.uid() or vl.is_sample = true)
        )
    )
);

-- vote_history piggy-backs on the voter visibility
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
          )
    )
);
