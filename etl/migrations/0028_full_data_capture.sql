-- =============================================================================
-- 0028: comprehensive data capture — voter contact fields, meeting notes,
-- volunteer groups + memberships + invites, created_by tracking on
-- interactions. RLS extended to allow volunteers to operate on candidate data.
-- Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Voter contact fields. Anything an uploaded file might give us — phone,
-- email, occupation, employer, household linkage — gets a typed column so
-- we can index/query on it. Anything still unrecognized continues to land
-- in voters.extra (jsonb) so nothing is lost.
-- ---------------------------------------------------------------------------
alter table voters add column if not exists phone text;
alter table voters add column if not exists phone_secondary text;
alter table voters add column if not exists email text;
alter table voters add column if not exists email_secondary text;
alter table voters add column if not exists website text;
alter table voters add column if not exists occupation text;
alter table voters add column if not exists employer text;
alter table voters add column if not exists household_id text;
alter table voters add column if not exists mailing_address text;
alter table voters add column if not exists mailing_city text;
alter table voters add column if not exists mailing_state text;
alter table voters add column if not exists mailing_zip text;
alter table voters add column if not exists voter_status text;
alter table voters add column if not exists voter_status_reason text;
alter table voters add column if not exists congressional_district text;
alter table voters add column if not exists state_house_district text;
alter table voters add column if not exists state_senate_district text;
alter table voters add column if not exists school_district text;
alter table voters add column if not exists last_updated_in_source date;
alter table voters add column if not exists language_preference text;

create index if not exists voters_email_lower
    on voters (lower(email)) where email is not null;
create index if not exists voters_phone
    on voters (phone) where phone is not null;
create index if not exists voters_household_id
    on voters (household_id) where household_id is not null;

-- ---------------------------------------------------------------------------
-- Meeting notes — separate from voter conversations. Free-form notes from
-- coffee chats, debate prep, strategy meetings. Optional attendees list.
-- ---------------------------------------------------------------------------
create table if not exists meeting_notes (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users(id) on delete cascade,
    title         text not null,
    body          text,
    meeting_date  timestamptz,
    duration_min  integer,
    location      text,
    attendees     text[],
    tags          text[],
    created_by    uuid references auth.users(id) on delete set null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index if not exists meeting_notes_user_date
    on meeting_notes (user_id, meeting_date desc nulls last);
alter table meeting_notes enable row level security;

-- ---------------------------------------------------------------------------
-- Volunteer groups. A candidate (the "owner") creates a group, invites
-- volunteers via signed link, volunteers sign up with their own email and
-- accept the invite. Volunteers can read the candidate's data and log
-- conversations under it. The candidate sees who logged what via created_by.
-- ---------------------------------------------------------------------------
create table if not exists volunteer_groups (
    id          uuid primary key default gen_random_uuid(),
    owner_id    uuid not null references auth.users(id) on delete cascade,
    name        text not null,
    description text,
    created_at  timestamptz not null default now()
);
create unique index if not exists volunteer_groups_owner_name
    on volunteer_groups (owner_id, lower(name));
alter table volunteer_groups enable row level security;

create table if not exists volunteer_memberships (
    id        uuid primary key default gen_random_uuid(),
    group_id  uuid not null references volunteer_groups(id) on delete cascade,
    user_id   uuid not null references auth.users(id) on delete cascade,
    role      text not null default 'volunteer'
        check (role in ('volunteer', 'admin')),
    joined_at timestamptz not null default now(),
    unique (group_id, user_id)
);
create index if not exists volunteer_memberships_user
    on volunteer_memberships (user_id);
alter table volunteer_memberships enable row level security;

create table if not exists volunteer_invites (
    id          uuid primary key default gen_random_uuid(),
    group_id    uuid not null references volunteer_groups(id) on delete cascade,
    email       text,
    invite_code text not null unique default encode(gen_random_bytes(12), 'hex'),
    accepted_at timestamptz,
    accepted_by uuid references auth.users(id) on delete set null,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null default (now() + interval '14 days')
);
create index if not exists volunteer_invites_code on volunteer_invites (invite_code);
alter table volunteer_invites enable row level security;

-- ---------------------------------------------------------------------------
-- Track who logged each conversation. Default to the row owner for the
-- backfill. interaction_participants gets the same column so per-person
-- edits know who made the change.
-- ---------------------------------------------------------------------------
alter table interactions
    add column if not exists created_by uuid references auth.users(id) on delete set null;
update interactions set created_by = user_id where created_by is null;

alter table interaction_participants
    add column if not exists created_by uuid references auth.users(id) on delete set null;
update interaction_participants ip
   set created_by = (select user_id from interactions i where i.id = ip.interaction_id)
 where ip.created_by is null;

-- ---------------------------------------------------------------------------
-- RLS update on interactions. Volunteers in any of the row owner's groups
-- can read; they can insert if the row's user_id matches a group they're a
-- member of AND they set created_by = themselves; they can update only
-- rows they themselves logged. Owner retains full access.
-- ---------------------------------------------------------------------------
drop policy if exists interactions_owner on interactions;
drop policy if exists interactions_read on interactions;
drop policy if exists interactions_insert on interactions;
drop policy if exists interactions_update on interactions;
drop policy if exists interactions_delete on interactions;

create policy interactions_read on interactions for select using (
    auth.uid() = user_id
    OR exists (
        select 1 from volunteer_memberships vm
        join volunteer_groups vg on vg.id = vm.group_id
        where vm.user_id = auth.uid()
          and vg.owner_id = interactions.user_id
    )
);

create policy interactions_insert on interactions for insert with check (
    -- Owner inserting their own row (the common path)
    (auth.uid() = user_id AND coalesce(created_by, auth.uid()) = auth.uid())
    -- Volunteer inserting a row under a candidate they're affiliated with
    OR (
        created_by = auth.uid()
        AND exists (
            select 1 from volunteer_memberships vm
            join volunteer_groups vg on vg.id = vm.group_id
            where vm.user_id = auth.uid()
              and vg.owner_id = interactions.user_id
        )
    )
);

create policy interactions_update on interactions for update using (
    auth.uid() = user_id
    OR (
        created_by = auth.uid()
        AND exists (
            select 1 from volunteer_memberships vm
            join volunteer_groups vg on vg.id = vm.group_id
            where vm.user_id = auth.uid()
              and vg.owner_id = interactions.user_id
        )
    )
);

create policy interactions_delete on interactions for delete using (
    auth.uid() = user_id
);

-- ---------------------------------------------------------------------------
-- Same shape on interaction_participants. Reads/writes follow the parent
-- interaction's policy.
-- ---------------------------------------------------------------------------
drop policy if exists ip_owner on interaction_participants;
drop policy if exists ip_read on interaction_participants;
drop policy if exists ip_write on interaction_participants;

create policy ip_read on interaction_participants for select using (
    exists (
        select 1 from interactions i
        where i.id = interaction_participants.interaction_id
          and (
              auth.uid() = i.user_id
              OR exists (
                  select 1 from volunteer_memberships vm
                  join volunteer_groups vg on vg.id = vm.group_id
                  where vm.user_id = auth.uid()
                    and vg.owner_id = i.user_id
              )
          )
    )
);

create policy ip_write on interaction_participants for all
    using (
        exists (
            select 1 from interactions i
            where i.id = interaction_participants.interaction_id
              and (
                  auth.uid() = i.user_id
                  OR (
                      coalesce(interaction_participants.created_by, auth.uid()) = auth.uid()
                      AND exists (
                          select 1 from volunteer_memberships vm
                          join volunteer_groups vg on vg.id = vm.group_id
                          where vm.user_id = auth.uid()
                            and vg.owner_id = i.user_id
                      )
                  )
              )
        )
    )
    with check (
        exists (
            select 1 from interactions i
            where i.id = interaction_participants.interaction_id
              and (
                  auth.uid() = i.user_id
                  OR (
                      coalesce(interaction_participants.created_by, auth.uid()) = auth.uid()
                      AND exists (
                          select 1 from volunteer_memberships vm
                          join volunteer_groups vg on vg.id = vm.group_id
                          where vm.user_id = auth.uid()
                            and vg.owner_id = i.user_id
                      )
                  )
              )
        )
    );

-- ---------------------------------------------------------------------------
-- RLS for the new tables.
-- ---------------------------------------------------------------------------
drop policy if exists meeting_notes_read on meeting_notes;
drop policy if exists meeting_notes_write on meeting_notes;
create policy meeting_notes_read on meeting_notes for select using (
    auth.uid() = user_id
    OR exists (
        select 1 from volunteer_memberships vm
        join volunteer_groups vg on vg.id = vm.group_id
        where vm.user_id = auth.uid() and vg.owner_id = meeting_notes.user_id
    )
);
create policy meeting_notes_write on meeting_notes for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists vg_owner_all on volunteer_groups;
drop policy if exists vg_member_read on volunteer_groups;
create policy vg_owner_all on volunteer_groups for all
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);
create policy vg_member_read on volunteer_groups for select using (
    exists (
        select 1 from volunteer_memberships vm
        where vm.group_id = volunteer_groups.id
          and vm.user_id = auth.uid()
    )
);

drop policy if exists vm_owner_all on volunteer_memberships;
drop policy if exists vm_self_read on volunteer_memberships;
create policy vm_owner_all on volunteer_memberships for all
    using (
        exists (
            select 1 from volunteer_groups vg
            where vg.id = volunteer_memberships.group_id and vg.owner_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from volunteer_groups vg
            where vg.id = volunteer_memberships.group_id and vg.owner_id = auth.uid()
        )
    );
create policy vm_self_read on volunteer_memberships for select using (
    auth.uid() = user_id
);

drop policy if exists vi_owner_all on volunteer_invites;
create policy vi_owner_all on volunteer_invites for all
    using (
        exists (
            select 1 from volunteer_groups vg
            where vg.id = volunteer_invites.group_id and vg.owner_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from volunteer_groups vg
            where vg.id = volunteer_invites.group_id and vg.owner_id = auth.uid()
        )
    );

-- ---------------------------------------------------------------------------
-- Update record_conversation to populate created_by on participants.
-- ---------------------------------------------------------------------------
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
    v_actor            uuid := auth.uid();
    i                  int;
    j                  int;
begin
    -- Authorize: caller must either own the campaign or be a volunteer in
    -- one of the owner's groups.
    if v_actor is null then
        raise exception 'unauthorized: no auth context' using errcode = '42501';
    end if;
    if v_actor <> p_user_id then
        if not exists (
            select 1 from volunteer_memberships vm
            join volunteer_groups vg on vg.id = vm.group_id
            where vm.user_id = v_actor and vg.owner_id = p_user_id
        ) then
            raise exception 'unauthorized: not a volunteer of campaign'
                using errcode = '42501';
        end if;
    end if;
    if p_participants is null or jsonb_array_length(p_participants) = 0 then
        raise exception 'at least one participant required' using errcode = '22023';
    end if;

    v_lead := p_participants -> 0;
    v_lead_tags := coalesce(
        (select array_agg(value::text) from jsonb_array_elements_text(v_lead -> 'tags')), '{}'
    ) || coalesce(p_extra_tags, '{}');

    insert into interactions (
        user_id, captured_name, captured_location, notes, created_by
    ) values (
        p_user_id,
        coalesce(v_lead ->> 'captured_name', '(no name)'),
        nullif(p_captured_location, ''),
        nullif(p_notes, ''),
        v_actor
    )
    returning id into v_interaction_id;

    for i in 0 .. jsonb_array_length(p_participants) - 1 loop
        v_part := p_participants -> i;
        insert into interaction_participants (
            interaction_id, voter_ncid, captured_name, relationship,
            sentiment, issues, tags, notes, match_confidence, is_primary, created_by
        ) values (
            v_interaction_id,
            nullif(v_part ->> 'voter_ncid', ''),
            coalesce(v_part ->> 'captured_name', '(no name)'),
            nullif(v_part ->> 'relationship', ''),
            nullif(v_part ->> 'sentiment', ''),
            coalesce((select array_agg(value::text) from jsonb_array_elements_text(v_part -> 'issues')), '{}'),
            case when i = 0 then v_lead_tags
                 else coalesce(
                    (select array_agg(value::text) from jsonb_array_elements_text(v_part -> 'tags')), '{}'
                 )
            end,
            nullif(v_part ->> 'notes', ''),
            nullif(v_part ->> 'match_confidence', '')::numeric,
            coalesce((v_part ->> 'is_primary')::boolean, i = 0),
            v_actor
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

-- ---------------------------------------------------------------------------
-- Cohort SQL compiler. Takes a JSON filter spec and returns matching voter
-- ncids. Lets the cohort builder run user-described queries safely without
-- the route layer ever building raw SQL from natural language.
-- ---------------------------------------------------------------------------
create or replace function build_cohort(p_filter jsonb, p_limit int default 5000)
returns table (
    ncid               text,
    first_name         text,
    middle_name        text,
    last_name          text,
    res_street_address text,
    res_city           text,
    res_zip            text,
    party_cd           text,
    age                int,
    birth_year         smallint,
    phone              text,
    email              text,
    precinct_desc      text,
    municipality_desc  text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
    v_age_min      int;
    v_age_max      int;
    v_party        text;
    v_city         text;
    v_zip          text;
    v_precinct     text;
    v_municipality text;
    v_status       text;
    v_state        text;
    v_voted_in     text;        -- election_desc fragment (ILIKE)
    v_voted_party  text;        -- voted_party_cd
    v_voted_after  date;
    v_voted_before date;
    v_min_total    int;         -- minimum total votes
    v_min_relevant int;         -- minimum elections matching voted_in
    v_list_id      uuid;        -- restrict to a particular voter list
    v_only_user    boolean;     -- restrict to caller's lists (default true)
begin
    v_age_min      := nullif(p_filter ->> 'age_min', '')::int;
    v_age_max      := nullif(p_filter ->> 'age_max', '')::int;
    v_party        := nullif(upper(p_filter ->> 'party'), '');
    v_city         := nullif(p_filter ->> 'city', '');
    v_zip          := nullif(p_filter ->> 'zip', '');
    v_precinct     := nullif(p_filter ->> 'precinct', '');
    v_municipality := nullif(p_filter ->> 'municipality', '');
    v_status       := nullif(p_filter ->> 'voter_status', '');
    v_state        := nullif(upper(p_filter ->> 'state'), '');
    v_voted_in     := nullif(p_filter ->> 'voted_in', '');
    v_voted_party  := nullif(upper(p_filter ->> 'voted_party'), '');
    v_voted_after  := nullif(p_filter ->> 'voted_after', '')::date;
    v_voted_before := nullif(p_filter ->> 'voted_before', '')::date;
    v_min_total    := nullif(p_filter ->> 'min_total_votes', '')::int;
    v_min_relevant := nullif(p_filter ->> 'min_relevant_votes', '')::int;
    v_list_id      := nullif(p_filter ->> 'list_id', '')::uuid;
    v_only_user    := coalesce((p_filter ->> 'only_my_lists')::boolean, true);

    return query
    with base as (
        select v.*
          from voters v
         where (v_age_min      is null or v.age >= v_age_min)
           and (v_age_max      is null or v.age <= v_age_max)
           and (v_party        is null or v.party_cd = v_party)
           and (v_city         is null or v.res_city ilike v_city)
           and (v_zip          is null or v.res_zip = v_zip)
           and (v_precinct     is null or v.precinct_desc ilike '%' || v_precinct || '%')
           and (v_municipality is null or v.municipality_desc ilike '%' || v_municipality || '%')
           and (v_status       is null or v.voter_status = v_status)
           and (v_list_id      is null or v.list_id = v_list_id
                                       or exists (
                                            select 1 from voter_list_members vlm
                                            where vlm.voter_ncid = v.ncid
                                              and vlm.list_id = v_list_id
                                       ))
           and (
               not v_only_user
               or v.list_id is null
               or exists (
                   select 1 from voter_lists vl where vl.id = v.list_id
                     and (vl.user_id = auth.uid() or vl.is_sample = true)
               )
               or exists (
                   select 1 from voter_list_members vlm
                   join voter_lists vl on vl.id = vlm.list_id
                   where vlm.voter_ncid = v.ncid
                     and (vl.user_id = auth.uid() or vl.is_sample = true)
               )
           )
    ),
    with_state as (
        select b.*
          from base b
         where v_state is null
            or exists (
                select 1 from voter_lists vl
                where vl.id = b.list_id and vl.state = v_state
            )
            or exists (
                select 1 from voter_list_members vlm
                join voter_lists vl on vl.id = vlm.list_id
                where vlm.voter_ncid = b.ncid and vl.state = v_state
            )
    ),
    vote_filter as (
        select b.*,
               (select count(*)::int from vote_history vh
                  where vh.ncid = b.ncid) as total_votes,
               (select count(*)::int from vote_history vh
                  where vh.ncid = b.ncid
                    and (v_voted_in     is null or vh.election_desc ilike '%' || v_voted_in || '%')
                    and (v_voted_party  is null or vh.voted_party_cd = v_voted_party)
                    and (v_voted_after  is null or vh.election_date >= v_voted_after)
                    and (v_voted_before is null or vh.election_date <= v_voted_before)
               ) as relevant_votes
          from with_state b
    )
    select
        f.ncid,
        f.first_name,
        f.middle_name,
        f.last_name,
        f.res_street_address,
        f.res_city,
        f.res_zip,
        f.party_cd,
        f.age::int,
        f.birth_year,
        f.phone,
        f.email,
        f.precinct_desc,
        f.municipality_desc
    from vote_filter f
    where (v_min_total    is null or f.total_votes    >= v_min_total)
      and (v_min_relevant is null or f.relevant_votes >= v_min_relevant)
    order by f.last_name nulls last, f.first_name nulls last
    limit p_limit;
end $$;

grant execute on function build_cohort(jsonb, int) to authenticated;
