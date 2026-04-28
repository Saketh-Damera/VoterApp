-- =============================================================================
-- Audit phase 1: security + correctness + performance fixes from the audit.
-- Idempotent. Apply via etl/apply.py.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- H1: SECURITY DEFINER on match_voters and get_voter_profile bypassed RLS,
-- letting an authenticated user read voters from another user's private list.
-- Switch to SECURITY INVOKER so the voters_read policy applies. The trigram
-- indexes work fine under invoker.
-- ---------------------------------------------------------------------------
create or replace function match_voters(q text, max_results int default 10)
returns table (
    ncid              text,
    first_name        text,
    middle_name       text,
    last_name         text,
    res_street_address text,
    res_city          text,
    party_cd          text,
    birth_year        smallint,
    precinct_desc     text,
    confidence        real
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
    perform set_limit(0.25);
    return query
    select
        v.ncid,
        v.first_name,
        v.middle_name,
        v.last_name,
        v.res_street_address,
        v.res_city,
        v.party_cd,
        v.birth_year,
        v.precinct_desc,
        word_similarity(q, v.full_name) as confidence
    from voters v
    where v.full_name %> q
    order by v.full_name <<-> q
    limit max_results;
end;
$$;

grant execute on function match_voters(text, int) to authenticated;

create or replace function get_voter_profile(p_ncid text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
    select jsonb_build_object(
        'voter',    to_jsonb(v.*),
        'turnout',  to_jsonb(t.*),
        'household', coalesce((
            select jsonb_agg(jsonb_build_object(
                'ncid', h.ncid,
                'first_name', h.first_name,
                'last_name', h.last_name,
                'age', h.age,
                'party_cd', h.party_cd,
                'elections_voted', ht.elections_voted
            ))
            from (
                select h.*
                  from voters h
                 where h.res_street_address is not null
                   and h.res_street_address = v.res_street_address
                   and h.res_city = v.res_city
                   and lower(coalesce(h.last_name, '')) = lower(coalesce(v.last_name, ''))
                   and h.ncid <> v.ncid
                 limit 12
            ) h
            left join voter_turnout ht on ht.ncid = h.ncid
        ), '[]'::jsonb),
        'talked_to_with', coalesce((
            select jsonb_agg(jsonb_build_object(
                'ncid', tw.ncid,
                'first_name', tw.first_name,
                'last_name', tw.last_name,
                'age', tw.age,
                'party_cd', tw.party_cd,
                'elections_voted', twt.elections_voted,
                'relationship', hl.relationship,
                'source_interaction_id', hl.source_interaction_id
            ))
            from household_links hl
            join voters tw on tw.ncid = case
                                          when hl.voter_a = v.ncid then hl.voter_b
                                          else hl.voter_a
                                        end
            left join voter_turnout twt on twt.ncid = tw.ncid
            where hl.user_id = auth.uid()
              and (hl.voter_a = v.ncid or hl.voter_b = v.ncid)
        ), '[]'::jsonb),
        'recent_votes', coalesce((
            select jsonb_agg(to_jsonb(x.*) order by x.election_date desc)
            from (
                select election_date, election_desc, voting_method
                from vote_history
                where ncid = v.ncid
                order by election_date desc
                limit 10
            ) x
        ), '[]'::jsonb)
    )
    from voters v
    left join voter_turnout t on t.ncid = v.ncid
    where v.ncid = p_ncid;
$$;

grant execute on function get_voter_profile(text) to authenticated;

-- ---------------------------------------------------------------------------
-- H6: Unique partial index for the per-user "Manual entries" list so a race
-- between concurrent /api/participants/[id]/create-voter calls cannot create
-- two of them.
-- ---------------------------------------------------------------------------
create unique index if not exists voter_lists_one_manual_per_user
    on voter_lists (user_id) where name = 'Manual entries';

-- ---------------------------------------------------------------------------
-- P1: ILIKE with leading wildcard cannot use the existing trigram GIN index
-- on full_name because of the lower() wrapper plus the substring match shape
-- find_voters_by_name uses. Add functional GIN trigram indexes that match the
-- exact predicate shape.
-- ---------------------------------------------------------------------------
create index if not exists voters_first_name_lower_trgm
    on voters using gin (lower(first_name) gin_trgm_ops);
create index if not exists voters_last_name_lower_trgm
    on voters using gin (lower(last_name) gin_trgm_ops);
create index if not exists voters_middle_name_lower_trgm
    on voters using gin (lower(middle_name) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- P5: audit triggers fire on UPDATE even when nothing actually changed (e.g.,
-- repeated PATCH with the same sentiment). Skip the no-op writes by checking
-- DISTINCT FROM. Also stop logging the trigger row itself if NEW = OLD.
-- ---------------------------------------------------------------------------
create or replace function audit_interactions_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_who text;
begin
    if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
        return new;
    end if;
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

create or replace function audit_participants_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_user_id uuid;
    v_who     text;
begin
    if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
        return new;
    end if;
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

create or replace function audit_voter_lists_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
        return new;
    end if;
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
    if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
        return new;
    end if;
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
    if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
        return new;
    end if;
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

-- ---------------------------------------------------------------------------
-- SEC6: 90-day audit_log retention. Caller passes p_days; default 90.
-- Run via cron / a periodic job (Supabase pg_cron or a Vercel Cron job).
-- ---------------------------------------------------------------------------
create or replace function purge_audit_log(p_days int default 90)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count int;
begin
    delete from audit_log
     where created_at < now() - (p_days || ' days')::interval;
    get diagnostics v_count = row_count;
    return v_count;
end $$;

revoke all on function purge_audit_log(int) from public;
-- Only the service role / scheduled job should be able to run this.

-- ---------------------------------------------------------------------------
-- Atomic conversation recording. Replaces the multi-step JS code in
-- /api/debrief and /people/new. Inserts the parent interaction, every
-- participant, and every household_links edge in one transaction. Returns
-- the interaction_id and an array of participant ids.
-- ---------------------------------------------------------------------------
create or replace function record_conversation(
    p_user_id        uuid,
    p_captured_location text,
    p_notes          text,
    p_participants   jsonb,    -- [{captured_name, voter_ncid?, relationship?, sentiment?, issues?, tags?, notes?, match_confidence?, is_primary?}]
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

    insert into interactions (
        user_id, voter_ncid, captured_name, captured_location,
        notes, issues, sentiment, tags, match_confidence
    ) values (
        p_user_id,
        nullif(v_lead ->> 'voter_ncid', ''),
        coalesce(v_lead ->> 'captured_name', '(no name)'),
        nullif(p_captured_location, ''),
        nullif(p_notes, ''),
        coalesce((select array_agg(value::text) from jsonb_array_elements_text(v_lead -> 'issues')), '{}'),
        nullif(v_lead ->> 'sentiment', ''),
        coalesce((select array_agg(value::text) from jsonb_array_elements_text(v_lead -> 'tags')), '{}')
            || coalesce(p_extra_tags, '{}'),
        nullif(v_lead ->> 'match_confidence', '')::numeric
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
            coalesce((select array_agg(value::text) from jsonb_array_elements_text(v_part -> 'tags')), '{}'),
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

    -- household_links: every pair of matched participants
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

-- ---------------------------------------------------------------------------
-- Rate limiting: lightweight per-user per-route counter table. Each request
-- inserts a row; route handlers count the last hour to enforce a cap.
-- ---------------------------------------------------------------------------
create table if not exists request_log (
    id          bigserial primary key,
    user_id     uuid not null references auth.users(id) on delete cascade,
    route       text not null,
    created_at  timestamptz not null default now()
);

create index if not exists request_log_user_route_time
    on request_log (user_id, route, created_at desc);

alter table request_log enable row level security;
drop policy if exists request_log_owner_read on request_log;
create policy request_log_owner_read on request_log for select using (auth.uid() = user_id);
drop policy if exists request_log_owner_insert on request_log;
create policy request_log_owner_insert on request_log for insert with check (auth.uid() = user_id);

-- Keep request_log small. 24h sliding window covers all reasonable rate limits.
create or replace function purge_request_log()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
    delete from request_log where created_at < now() - interval '24 hours';
    get diagnostics v_count = row_count;
    return v_count;
end $$;

revoke all on function purge_request_log() from public;
