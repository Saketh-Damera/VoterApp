-- Safe deletion of a voter list. The legacy voters.list_id column has an ON
-- DELETE CASCADE FK pointing at voter_lists, which would also cascade-delete
-- any voter whose list_id happens to equal the deleted list — even if that
-- voter still belongs to OTHER lists via voter_list_members. We reassign the
-- legacy list_id to one of the voter's surviving memberships first so only
-- truly orphaned voters get cleaned up.
create or replace function delete_voter_list(p_list_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_owner uuid;
begin
    select user_id into v_owner from voter_lists where id = p_list_id;
    if v_owner is null then
        raise exception 'list not found' using errcode = 'P0002';
    end if;
    if v_owner != auth.uid() then
        raise exception 'not authorized' using errcode = '42501';
    end if;

    -- Reassign legacy list_id for voters that still belong elsewhere.
    update voters v
       set list_id = (
           select vlm.list_id
             from voter_list_members vlm
            where vlm.voter_ncid = v.ncid
              and vlm.list_id != p_list_id
            limit 1
       )
     where v.list_id = p_list_id
       and exists (
           select 1 from voter_list_members vlm
            where vlm.voter_ncid = v.ncid
              and vlm.list_id != p_list_id
       );

    -- Cascade handles voter_list_members for this list and orphaned voters.
    -- Interactions referencing orphaned voters set voter_ncid = null, so the
    -- user's conversations remain (they show up as unmatched on /people).
    delete from voter_lists where id = p_list_id;
end $$;

grant execute on function delete_voter_list(uuid) to authenticated;
