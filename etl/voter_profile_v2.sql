-- Extend get_voter_profile with talked_to_with: voters this user has spoken
-- to in the same conversation as the focus voter (from household_links).
-- File-based household stays as-is (same address + surname). The page can
-- merge or display the two side-by-side.
create or replace function get_voter_profile(p_ncid text)
returns jsonb
language sql
stable
security definer
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
