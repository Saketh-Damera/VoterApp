-- Fuzzy match voters by name using pg_trgm word-similarity.
-- Uses word_similarity so partial queries like "John Smith" match "JOHN A SMITH" etc.
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
security definer
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

-- Compact voter profile: voter + turnout stats + household siblings.
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
            from voters h
            left join voter_turnout ht on ht.ncid = h.ncid
            where h.res_street_address = v.res_street_address
              and h.res_city = v.res_city
              and h.ncid <> v.ncid
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
