-- One conversation can involve multiple people. interactions stays as the
-- encounter (location, transcript-style notes, when), and interaction_participants
-- holds one row per person involved. Each participant carries its own
-- voter_ncid (nullable = unlinked), sentiment, issues, tags, and relationship
-- to the lead participant ("spouse", "son", etc.).
create table if not exists interaction_participants (
    id                uuid primary key default gen_random_uuid(),
    interaction_id    uuid not null references interactions(id) on delete cascade,
    voter_ncid        text references voters(ncid) on delete set null,
    captured_name     text not null,
    relationship      text,
    sentiment         text,
    issues            text[],
    tags              text[],
    notes             text,
    match_confidence  numeric(4,3),
    is_primary        boolean not null default false,
    created_at        timestamptz not null default now()
);

create index if not exists ip_interaction on interaction_participants (interaction_id);
create index if not exists ip_voter       on interaction_participants (voter_ncid);
-- One primary per interaction max
create unique index if not exists ip_one_primary
    on interaction_participants (interaction_id) where is_primary;

alter table interaction_participants enable row level security;

drop policy if exists ip_owner on interaction_participants;
create policy ip_owner on interaction_participants for all using (
    exists (
        select 1 from interactions i
         where i.id = interaction_participants.interaction_id
           and i.user_id = auth.uid()
    )
) with check (
    exists (
        select 1 from interactions i
         where i.id = interaction_participants.interaction_id
           and i.user_id = auth.uid()
    )
);

-- Audit trigger: participants are owned through their parent interaction.
create or replace function audit_participants_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_user_id uuid;
    v_who     text;
begin
    if tg_op = 'DELETE' then
        select user_id into v_user_id from interactions where id = old.interaction_id;
    else
        select user_id into v_user_id from interactions where id = new.interaction_id;
    end if;
    if v_user_id is null then
        return case when tg_op = 'DELETE' then old else new end;
    end if;

    if tg_op = 'INSERT' then
        v_who := coalesce(new.captured_name, '(no name)');
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (v_user_id, 'create', 'participant', new.id::text,
                'Added ' || v_who || ' to a conversation', to_jsonb(new));
        return new;
    elsif tg_op = 'UPDATE' then
        v_who := coalesce(new.captured_name, old.captured_name, '(no name)');
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (v_user_id, 'update', 'participant', new.id::text,
                'Updated ' || v_who || ' in a conversation', to_jsonb(old));
        return new;
    elsif tg_op = 'DELETE' then
        v_who := coalesce(old.captured_name, '(no name)');
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (v_user_id, 'delete', 'participant', old.id::text,
                'Removed ' || v_who || ' from a conversation', to_jsonb(old));
        return old;
    end if;
    return null;
end $$;

drop trigger if exists audit_participants on interaction_participants;
create trigger audit_participants
    after insert or update or delete on interaction_participants
    for each row execute function audit_participants_trigger();

-- Household links: when 2+ matched participants share a conversation we can
-- assert they know each other. Symmetric — store the smaller ncid first to
-- avoid duplicates. source_interaction_id explains why the edge exists.
create table if not exists household_links (
    voter_a              text not null references voters(ncid) on delete cascade,
    voter_b              text not null references voters(ncid) on delete cascade,
    source_interaction_id uuid references interactions(id) on delete set null,
    relationship         text,
    user_id              uuid not null references auth.users(id) on delete cascade,
    created_at           timestamptz not null default now(),
    primary key (user_id, voter_a, voter_b),
    check (voter_a < voter_b)
);

create index if not exists hl_user_voter_a on household_links (user_id, voter_a);
create index if not exists hl_user_voter_b on household_links (user_id, voter_b);

alter table household_links enable row level security;
drop policy if exists hl_owner on household_links;
create policy hl_owner on household_links for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Backfill: every existing interaction becomes a primary-only participant.
-- Idempotent: only inserts when no participant exists for that interaction.
-- ---------------------------------------------------------------------------
insert into interaction_participants
    (interaction_id, voter_ncid, captured_name, sentiment, issues, tags, notes,
     match_confidence, is_primary, created_at)
select
    i.id,
    i.voter_ncid,
    coalesce(i.captured_name, '(no name)'),
    i.sentiment,
    i.issues,
    i.tags,
    i.notes,
    i.match_confidence,
    true,
    i.created_at
from interactions i
where not exists (
    select 1 from interaction_participants p where p.interaction_id = i.id
);
