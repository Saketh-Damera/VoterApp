-- =============================================================================
-- Audit phase 2: drop the legacy mirror columns on interactions.
-- After this migration, interactions has only encounter-level fields.
-- Per-person fields (voter_ncid, sentiment, issues, tags, match_confidence)
-- live exclusively on interaction_participants.
-- Idempotent.
-- =============================================================================

-- 1) Update audit trigger so it stops referencing voter_ncid (which is going
--    away). captured_name remains and is the human-readable encounter label.
create or replace function audit_interactions_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_who text;
begin
    if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
        return new;
    end if;
    if tg_op = 'INSERT' then
        v_who := coalesce(new.captured_name, '(no name)');
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (new.user_id, 'create', 'interaction', new.id::text,
                'Logged conversation with ' || v_who, to_jsonb(new));
        return new;
    elsif tg_op = 'UPDATE' then
        v_who := coalesce(new.captured_name, old.captured_name, '(no name)');
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (new.user_id, 'update', 'interaction', new.id::text,
                'Updated conversation with ' || v_who, to_jsonb(old));
        return new;
    elsif tg_op = 'DELETE' then
        v_who := coalesce(old.captured_name, '(no name)');
        insert into audit_log (user_id, action, entity_type, entity_id, summary, snapshot)
        values (old.user_id, 'delete', 'interaction', old.id::text,
                'Deleted conversation with ' || v_who, to_jsonb(old));
        return old;
    end if;
    return null;
end $$;

-- 2) Refresh record_conversation to stop writing the dropped columns.
--    Issues/sentiment/tags/match_confidence/voter_ncid for the lead come
--    from p_participants -> 0 and live ONLY on the participant row now.
create or replace function record_conversation(
    p_user_id        uuid,
    p_captured_location text,
    p_notes          text,
    p_participants   jsonb,
    p_extra_tags     text[] default '{}'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_interaction_id   uuid;
    v_participant_ids  uuid[] := '{}';
    v_lead             jsonb;
    v_part             jsonb;
    v_participant_id   uuid;
    v_matched_ncids    text[] := '{}';
    v_a                text;
    v_b                text;
    v_lead_tags        text[];
    i                  int;
    j                  int;
begin
    if p_user_id is null or p_user_id <> auth.uid() then
        raise exception 'unauthorized: user mismatch' using errcode = '42501';
    end if;
    if p_participants is null or jsonb_array_length(p_participants) = 0 then
        raise exception 'at least one participant required' using errcode = '22023';
    end if;

    v_lead := p_participants -> 0;
    v_lead_tags := coalesce(
        (select array_agg(value::text) from jsonb_array_elements_text(v_lead -> 'tags')), '{}'
    ) || coalesce(p_extra_tags, '{}');

    -- Encounter-only fields on interactions now.
    insert into interactions (
        user_id, captured_name, captured_location, notes
    ) values (
        p_user_id,
        coalesce(v_lead ->> 'captured_name', '(no name)'),
        nullif(p_captured_location, ''),
        nullif(p_notes, '')
    )
    returning id into v_interaction_id;

    for i in 0 .. jsonb_array_length(p_participants) - 1 loop
        v_part := p_participants -> i;
        insert into interaction_participants (
            interaction_id, voter_ncid, captured_name, relationship,
            sentiment, issues, tags, notes, match_confidence, is_primary
        ) values (
            v_interaction_id,
            nullif(v_part ->> 'voter_ncid', ''),
            coalesce(v_part ->> 'captured_name', '(no name)'),
            nullif(v_part ->> 'relationship', ''),
            nullif(v_part ->> 'sentiment', ''),
            coalesce((select array_agg(value::text) from jsonb_array_elements_text(v_part -> 'issues')), '{}'),
            -- Lead participant inherits the wants-yard-sign / volunteer-interest
            -- tags so those event-level signals stay searchable on /people.
            case when i = 0 then v_lead_tags
                 else coalesce(
                    (select array_agg(value::text) from jsonb_array_elements_text(v_part -> 'tags')), '{}'
                 )
            end,
            nullif(v_part ->> 'notes', ''),
            nullif(v_part ->> 'match_confidence', '')::numeric,
            coalesce((v_part ->> 'is_primary')::boolean, i = 0)
        )
        returning id into v_participant_id;
        v_participant_ids := v_participant_ids || v_participant_id;

        if (v_part ->> 'voter_ncid') is not null and (v_part ->> 'voter_ncid') <> '' then
            v_matched_ncids := v_matched_ncids || (v_part ->> 'voter_ncid');
        end if;
    end loop;

    if array_length(v_matched_ncids, 1) >= 2 then
        for i in 1 .. array_length(v_matched_ncids, 1) - 1 loop
            for j in i + 1 .. array_length(v_matched_ncids, 1) loop
                if v_matched_ncids[i] = v_matched_ncids[j] then continue; end if;
                if v_matched_ncids[i] < v_matched_ncids[j] then
                    v_a := v_matched_ncids[i]; v_b := v_matched_ncids[j];
                else
                    v_a := v_matched_ncids[j]; v_b := v_matched_ncids[i];
                end if;
                insert into household_links (user_id, voter_a, voter_b, source_interaction_id)
                values (p_user_id, v_a, v_b, v_interaction_id)
                on conflict (user_id, voter_a, voter_b) do nothing;
            end loop;
        end loop;
    end if;

    return jsonb_build_object(
        'interaction_id', v_interaction_id,
        'participant_ids', v_participant_ids
    );
end $$;

grant execute on function record_conversation(uuid, text, text, jsonb, text[]) to authenticated;

-- 3) Drop the mirror columns. Cascade only takes the FK constraint on
--    interactions.voter_ncid (-> voters.ncid); no other object depends on it.
alter table interactions drop column if exists voter_ncid;
alter table interactions drop column if exists sentiment;
alter table interactions drop column if exists issues;
alter table interactions drop column if exists tags;
alter table interactions drop column if exists match_confidence;

-- 4) Drop the now-orphaned index on interactions.voter_ncid (was created in
--    schema.sql). DROP INDEX IF EXISTS is idempotent.
drop index if exists interactions_voter;
