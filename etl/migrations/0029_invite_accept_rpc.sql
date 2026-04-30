-- Atomic invite acceptance. Runs as security definer because the invitee
-- cannot read volunteer_invites under RLS by default — the table is
-- owner-scoped. The function verifies the code exists, isn't expired,
-- and isn't already accepted; then it adds a membership and marks the
-- invite accepted.
create or replace function accept_volunteer_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_invite      record;
    v_caller      uuid := auth.uid();
begin
    if v_caller is null then
        raise exception 'unauthorized: no auth context' using errcode = '42501';
    end if;

    select * into v_invite
      from volunteer_invites
     where invite_code = p_code
     limit 1;
    if v_invite is null then
        raise exception 'invite not found' using errcode = 'P0002';
    end if;
    if v_invite.expires_at < now() then
        raise exception 'invite expired' using errcode = '22023';
    end if;
    if v_invite.accepted_at is not null then
        raise exception 'invite already accepted' using errcode = '23505';
    end if;

    -- Add the membership. ON CONFLICT keeps the operation idempotent if the
    -- invitee was already a member.
    insert into volunteer_memberships (group_id, user_id, role)
    values (v_invite.group_id, v_caller, 'volunteer')
    on conflict (group_id, user_id) do nothing;

    update volunteer_invites
       set accepted_at = now(),
           accepted_by = v_caller
     where id = v_invite.id;

    return v_invite.group_id;
end $$;

grant execute on function accept_volunteer_invite(text) to authenticated;
