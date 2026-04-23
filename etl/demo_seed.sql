-- Called by the "Try the demo" flow right after an anonymous Supabase sign-in.
-- Populates the caller's account with a candidate profile and a few sample
-- interactions matched to real NC Durham voters so the dashboard isn't empty.
create or replace function seed_demo()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_election date := current_date + interval '60 days';
    v_maria text;
    v_john  text;
    v_sarah text;
    v_int_id uuid;
begin
    if v_uid is null then
        raise exception 'not authenticated';
    end if;

    -- Candidate profile (upsert)
    insert into candidates (user_id, candidate_name, office, jurisdiction, election_date, fundraising_goal)
    values (v_uid, 'Demo Candidate', 'Durham City Council', 'Ward 2, Durham NC', v_election, 25000)
    on conflict (user_id) do update
    set candidate_name = excluded.candidate_name,
        office = excluded.office,
        jurisdiction = excluded.jurisdiction,
        election_date = excluded.election_date,
        fundraising_goal = excluded.fundraising_goal;

    -- Skip seeding interactions if the demo already has some.
    if exists (select 1 from interactions where user_id = v_uid limit 1) then
        return jsonb_build_object('ok', true, 'seeded', false);
    end if;

    -- Pick three Durham voters by first name to anchor the demos to real rows.
    select ncid into v_maria
    from voters where first_name = 'MARIA' and last_name = 'HERNANDEZ'
    order by ncid limit 1;
    if v_maria is null then
        select ncid into v_maria from voters where first_name = 'MARIA' order by ncid limit 1;
    end if;

    select ncid into v_john
    from voters where first_name = 'JOHN' and last_name = 'SMITH'
    order by ncid limit 1;

    select ncid into v_sarah
    from voters where first_name = 'SARAH' and last_name = 'WILLIAMS'
    order by ncid limit 1;
    if v_sarah is null then
        select ncid into v_sarah from voters where first_name = 'SARAH' order by ncid limit 1;
    end if;

    if v_maria is not null then
        insert into interactions (user_id, voter_ncid, captured_name, captured_location, notes,
                                   issues, sentiment, tags, created_at)
        values (v_uid, v_maria, 'Maria Hernandez', 'Durham farmers market',
                'Cares about property taxes and rezoning near Duke. Teaches 3rd grade. Leaning supportive but worried husband wont vote.',
                array['property-taxes','rezoning']::text[],
                'leaning_supportive',
                array['teacher','pta','spouse-unsure']::text[],
                now() - interval '2 days')
        returning id into v_int_id;

        insert into reminders (user_id, interaction_id, voter_ncid, due_at, message)
        values (v_uid, v_int_id, v_maria, now() + interval '5 days',
                'Text Maria with rezoning update; ask if husband is registered');
    end if;

    if v_john is not null then
        insert into interactions (user_id, voter_ncid, captured_name, captured_location, notes,
                                   issues, sentiment, tags, created_at)
        values (v_uid, v_john, 'John Smith', 'PTA meeting',
                'Wants better funding for public schools. Strong supporter. Offered to host a house party in May.',
                array['public-schools']::text[],
                'supportive',
                array['parent','pta','willing-host']::text[],
                now() - interval '1 day');
    end if;

    if v_sarah is not null then
        insert into interactions (user_id, voter_ncid, captured_name, captured_location, notes,
                                   issues, sentiment, tags, created_at)
        values (v_uid, v_sarah, 'Sarah Williams', 'Coffee shop',
                'Concerned about traffic on Oak Street. Undecided. Works at Duke in admissions.',
                array['traffic','oak-street']::text[],
                'undecided',
                array['duke-staff']::text[],
                now() - interval '4 hours');
    end if;

    -- A couple of todos to populate the agenda column.
    insert into todos (user_id, title, due_date)
    values
        (v_uid, 'Call the Durham Teachers Association', current_date + 2),
        (v_uid, 'Finalize yard-sign design', current_date + 5);

    -- One fundraising prospect
    insert into fundraising_prospects (user_id, full_name, employer, role, estimated_capacity, status, notes)
    values (v_uid, 'Alex Chen', 'Local Chamber of Commerce', 'Board member', 500, 'prospect',
            'Referred by John. Has given to council races before.');

    return jsonb_build_object('ok', true, 'seeded', true);
end $$;

grant execute on function seed_demo() to authenticated;
