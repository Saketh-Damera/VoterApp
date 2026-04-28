-- Safe deletion of a voter list. The legacy voters.list_id column has an ON
-- DELETE CASCADE FK pointing at voter_lists, which would also cascade-delete
-- any voter whose list_id happens to equal the deleted list — even if that
-- voter still belongs to OTHER lists via voter_list_members. We reassign the
-- legacy list_id to one of the voter's surviving memberships first so only
-- truly orphaned voters get cleaned up.
--
-- security definer + explicit auth.uid() check: bypasses RLS for the cascade
-- cleanup queries so they don't fight per-row policies on voters/vote_history,
-- while still refusing to act on lists the caller does not own.
create or replace function delete_voter_list(p_list_id uuid)
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '300s'
set lock_timeout = '60s'
as $$
declare
    v_owner uuid;
    v_caller uuid;
begin
    v_caller := auth.uid();
    if v_caller is null then
        raise exception 'unauthorized: no auth context' using errcode = '42501';
    end if;

    select user_id into v_owner from voter_lists where id = p_list_id;
    if v_owner is null then
        raise exception 'list not found: %', p_list_id using errcode = 'P0002';
    end if;
    if v_owner <> v_caller then
        raise exception 'not authorized: list owned by another user' using errcode = '42501';
    end if;

    update voters v
       set list_id = (
           select vlm.list_id
             from voter_list_members vlm
            where vlm.voter_ncid = v.ncid
              and vlm.list_id <> p_list_id
            limit 1
       )
     where v.list_id = p_list_id
       and exists (
           select 1 from voter_list_members vlm
            where vlm.voter_ncid = v.ncid
              and vlm.list_id <> p_list_id
       );

    delete from voter_lists where id = p_list_id;
end $$;

grant execute on function delete_voter_list(uuid) to authenticated;
