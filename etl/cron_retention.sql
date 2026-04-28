-- Enable pg_cron and schedule the two retention jobs idempotently. If the
-- extension is already enabled, the create-extension call is a no-op. The
-- unschedule calls let us re-run this migration to update schedules.
create extension if not exists pg_cron;

-- Drop any prior schedules with the same names so this script is rerunnable.
do $$
declare
    r record;
begin
    for r in select jobid from cron.job
              where jobname in ('purge-audit-log','purge-request-log')
    loop
        perform cron.unschedule(r.jobid);
    end loop;
end $$;

-- Daily at 03:00 UTC: purge audit_log rows older than 90 days.
select cron.schedule(
    'purge-audit-log',
    '0 3 * * *',
    $$select purge_audit_log(90)$$
);

-- Every 15 minutes: prune request_log to the last 24 hours.
select cron.schedule(
    'purge-request-log',
    '*/15 * * * *',
    $$select purge_request_log()$$
);
