-- Two related fixes:
--
-- 1) get_voter_profile.household used to match anyone at the same street
--    address. In an apartment building that returned 33 strangers as a
--    "household". We now also require a shared last_name and cap the result
--    at 12, which keeps real families together (Dasguptas at #4 stay grouped)
--    while excluding everyone else in the building.
--
-- 2) find_voters_by_name lets the assistant answer "the Dasgupta family" or
--    "are there any Smiths in Tenafly" by tokenizing the question and
--    fuzzy-matching tokens against voter names, returning every match the
--    user is allowed to see (RLS handles list ownership).

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

-- Token-based fuzzy voter search. Splits the input into lowercase tokens of
-- length >= 3, drops common stopwords, strips trailing 's' (so "dasguptas"
-- matches "dasgupta"), then ranks voters by how many of those tokens appear
-- in their first/middle/last name.
create or replace function find_voters_by_name(q text, max_results int default 30)
returns table (
    ncid               text,
    first_name         text,
    middle_name        text,
    last_name          text,
    res_street_address text,
    res_city           text,
    party_cd           text,
    birth_year         smallint,
    match_count        int
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
    tokens text[];
    stopwords text[] := array[
        'the','and','any','all','show','list','find','tell','give','for','from','with','about',
        'who','what','where','when','how','why','this','that','these','those','they','them','their',
        'his','her','our','your','you','our','have','has','had','was','were','are','can','could',
        'would','should','will','want','need','please','thanks','thank','really','also','jed',
        'voter','voters','people','person','family','families','household','members','member',
        'name','names','last','first','file','files','match','matches','out','off','one','two',
        'three','many','some','few','tell','show','list','find','give','look','find','search','about',
        'pull','present','option','options','direct','ones','say','said','want','wanted','look',
        'recall','same','just','only','already','still','again'
    ];
begin
    select array_agg(distinct t) into tokens
    from (
        select case when right(token, 1) = 's' and length(token) > 3
                    then left(token, length(token) - 1)
                    else token end as t
        from regexp_split_to_table(lower(q), '[^a-z]+') as token
        where length(token) >= 3 and not (token = any(stopwords))
    ) sub;

    if tokens is null or array_length(tokens, 1) = 0 then
        return;
    end if;

    return query
    select
        v.ncid, v.first_name, v.middle_name, v.last_name,
        v.res_street_address, v.res_city, v.party_cd, v.birth_year,
        (
            (case when exists (select 1 from unnest(tokens) tk where lower(coalesce(v.first_name, '')) like '%'||tk||'%') then 1 else 0 end)
          + (case when exists (select 1 from unnest(tokens) tk where lower(coalesce(v.last_name,  '')) like '%'||tk||'%') then 1 else 0 end)
          + (case when exists (select 1 from unnest(tokens) tk where lower(coalesce(v.middle_name,'')) like '%'||tk||'%') then 1 else 0 end)
        ) as match_count
    from voters v
    where exists (
        select 1 from unnest(tokens) tk
        where lower(coalesce(v.first_name, '')) like '%'||tk||'%'
           or lower(coalesce(v.last_name,  '')) like '%'||tk||'%'
           or lower(coalesce(v.middle_name,'')) like '%'||tk||'%'
    )
    order by match_count desc, v.last_name nulls last, v.first_name nulls last
    limit max_results;
end $$;

grant execute on function find_voters_by_name(text, int) to authenticated;
