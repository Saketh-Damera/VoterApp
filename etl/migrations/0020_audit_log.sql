-- Append-only history of user-driven actions. Triggers capture a JSON snapshot
-- of each affected row so deletions are recoverable: even if the live row is
-- gone, the audit_log row preserves the data the user lost.
create table if not exists audit_log (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    action      text not null check (action in ('create','update','delete')),
    entity_type text not null,
    entity_id   text,
    summary     text not null,
    snapshot    jsonb,
    created_at  timestamptz not null default now()
);
create index if not exists audit_log_user_created on audit_log (user_id, created_at desc);

alter table audit_log enable row level security;
drop policy if exists audit_log_owner_read on audit_log;
create policy audit_log_owner_read on audit_log for select using (auth.uid() = user_id);
-- No insert/update/delete policies for users — the triggers below run as
-- security definer and are the only writers. This prevents tampering.

-- ============================================================================
-- Trigger helpers
-- ============================================================================

create or replace function audit_interactions_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_who text;
begin
    if tg_op = 'INSERT' then
        v_who := coalesce(new.captured_name, new.voter_ncid, '(no name)');
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (new.user_id, 'create', 'interaction', new.id::text,
                'Logged conversation with ' || v_who, to_jsonb(new));
        return new;
    elsif tg_op = 'UPDATE' then
        v_who := coalesce(new.captured_name, new.voter_ncid, old.captured_name, old.voter_ncid, '(no name)');
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (new.user_id, 'update', 'interaction', new.id::text,
                'Updated conversation with ' || v_who, to_jsonb(old));
        return new;
    elsif tg_op = 'DELETE' then
        v_who := coalesce(old.captured_name, old.voter_ncid, '(no name)');
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (old.user_id, 'delete', 'interaction', old.id::text,
                'Deleted conversation with ' || v_who, to_jsonb(old));
        return old;
    end if;
    return null;
end $$;

create or replace function audit_voter_lists_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'INSERT' then
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (new.user_id, 'create', 'voter_list', new.id::text,
                'Uploaded list: ' || new.name || ' (' || coalesce(new.row_count, 0) || ' voters)',
                to_jsonb(new));
        return new;
    elsif tg_op = 'UPDATE' then
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (new.user_id, 'update', 'voter_list', new.id::text,
                'Updated list: ' || new.name, to_jsonb(old));
        return new;
    elsif tg_op = 'DELETE' then
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (old.user_id, 'delete', 'voter_list', old.id::text,
                'Deleted list: ' || old.name || ' (' || coalesce(old.row_count, 0) || ' voters)',
                to_jsonb(old));
        return old;
    end if;
    return null;
end $$;

create or replace function audit_candidates_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'INSERT' then
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (new.user_id, 'create', 'candidate', new.user_id::text,
                'Created candidate profile: ' || coalesce(new.candidate_name, '(no name)'),
                to_jsonb(new));
        return new;
    elsif tg_op = 'UPDATE' then
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (new.user_id, 'update', 'candidate', new.user_id::text,
                'Updated candidate profile', to_jsonb(old));
        return new;
    elsif tg_op = 'DELETE' then
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (old.user_id, 'delete', 'candidate', old.user_id::text,
                'Deleted candidate profile', to_jsonb(old));
        return old;
    end if;
    return null;
end $$;

create or replace function audit_reminders_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'INSERT' then
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (new.user_id, 'create', 'reminder', new.id::text,
                'Created reminder: ' || left(coalesce(new.message, '(no message)'), 80),
                to_jsonb(new));
        return new;
    elsif tg_op = 'UPDATE' then
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (new.user_id, 'update', 'reminder', new.id::text,
                'Updated reminder', to_jsonb(old));
        return new;
    elsif tg_op = 'DELETE' then
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (old.user_id, 'delete', 'reminder', old.id::text,
                'Deleted reminder', to_jsonb(old));
        return old;
    end if;
    return null;
end $$;

-- ============================================================================
-- Bind triggers
-- ============================================================================

drop trigger if exists audit_interactions on interactions;
create trigger audit_interactions
    after insert or update or delete on interactions
    for each row execute function audit_interactions_trigger();

drop trigger if exists audit_voter_lists on voter_lists;
create trigger audit_voter_lists
    after insert or update or delete on voter_lists
    for each row execute function audit_voter_lists_trigger();

drop trigger if exists audit_candidates on candidates;
create trigger audit_candidates
    after insert or update or delete on candidates
    for each row execute function audit_candidates_trigger();

drop trigger if exists audit_reminders on reminders;
create trigger audit_reminders
    after insert or update or delete on reminders
    for each row execute function audit_reminders_trigger();
