-- Priority = Turnout × Persuasion × Recency, scaled 0-100.
-- Mid-propensity voters (Gerber/Green) + undecided sentiment + recent contact = highest.
create or replace function voter_priority(p_ncid text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
    with t as (
        select coalesce(generals_voted, 0) as g
        from voter_turnout
        where ncid = p_ncid
    ),
    i as (
        select sentiment, created_at as last_contact
        from interactions
        where voter_ncid = p_ncid
        order by created_at desc
        limit 1
    )
    select round(
        -- Turnout score (0-1): peaks at 3 generals voted, drops off on either side.
        greatest(0.0, 1.0 - abs(coalesce((select g from t), 0) - 3) / 5.0) *
        -- Persuasion score (0-1): based on latest interaction sentiment.
        case coalesce((select sentiment from i), 'unknown')
            when 'undecided'           then 1.0
            when 'leaning_supportive'  then 0.7
            when 'leaning_opposed'     then 0.7
            when 'supportive'          then 0.4
            when 'opposed'             then 0.0
            else 0.3
        end *
        -- Recency score (0-1): decays with time since last contact.
        case
            when (select last_contact from i) is null then 0.5
            when now() - (select last_contact from i) < interval '3 days'  then 1.0
            when now() - (select last_contact from i) < interval '14 days' then 0.7
            when now() - (select last_contact from i) < interval '30 days' then 0.4
            else 0.2
        end * 100
    , 1);
$$;

grant execute on function voter_priority(text) to authenticated;

-- Top N pending reminders for the current user, ranked by priority.
create or replace function top_priority_actions(p_limit int default 3)
returns table (
    id          uuid,
    voter_ncid  text,
    first_name  text,
    last_name   text,
    res_city    text,
    message     text,
    due_at      timestamptz,
    sentiment   text,
    priority    numeric
)
language sql
stable
security invoker
set search_path = public
as $$
    select
        r.id,
        r.voter_ncid,
        v.first_name,
        v.last_name,
        v.res_city,
        r.message,
        r.due_at,
        (
            select i.sentiment
            from interactions i
            where i.voter_ncid = r.voter_ncid
            order by i.created_at desc
            limit 1
        ) as sentiment,
        voter_priority(r.voter_ncid) as priority
    from reminders r
    left join voters v on v.ncid = r.voter_ncid
    where r.user_id = auth.uid()
      and r.status = 'pending'
    order by voter_priority(r.voter_ncid) desc nulls last, r.due_at asc
    limit p_limit;
$$;

grant execute on function top_priority_actions(int) to authenticated;
