-- Zedu Preflight: results storage (FRD section 4.1).
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- Who can do what:
--   * The results API (dashboard/api/results.js) writes through ingest_run() with the secret key.
--   * Signed-in dashboard users can only read.
--   * Anonymous visitors can't see anything.

create table if not exists public.runs (
  id             bigint generated always as identity primary key,
  project        text        not null,
  environment    text        not null,
  ci_run_id      text        not null,            -- GitHub Actions run id
  attempt        int         not null default 1,  -- GitHub "re-run" attempt
  repo           text,
  branch         text,
  commit_sha     text,
  commit_message text,
  trigger        text,                            -- push | pull_request | workflow_dispatch | schedule
  url            text,                            -- link to the GitHub Actions run (evidence lives there)
  verdict        text        not null check (verdict in ('Ready', 'Ready with warnings', 'Not Ready')),
  reason         text,
  total          int         not null default 0,
  passed         int         not null default 0,
  failed         int         not null default 0,
  flaky          int         not null default 0,
  skipped        int         not null default 0,
  runner_errors  jsonb       not null default '[]',
  started_at     timestamptz,
  duration_ms    int,
  created_at     timestamptz not null default now(),
  unique (project, ci_run_id, attempt)            -- a retried upload updates the same run
);

create table if not exists public.test_results (
  id              bigint generated always as identity primary key,
  run_id          bigint not null references public.runs (id) on delete cascade,
  name            text   not null,
  file            text,
  line            int,
  browser         text,
  feature         text,
  priority        text,
  tags            text[] not null default '{}',
  status          text   not null check (status in ('passed', 'failed', 'flaky', 'skipped')),
  duration_ms     int,
  retries         int    not null default 0,
  error           jsonb,                          -- { reason, message, stack, location }
  screenshot_path text,
  trace_path      text
);

create index if not exists runs_project_created_idx on public.runs (project, created_at desc);
create index if not exists test_results_run_idx on public.test_results (run_id);

-- Read-only for signed-in users.
alter table public.runs enable row level security;
alter table public.test_results enable row level security;

drop policy if exists "Signed-in users can read runs" on public.runs;
create policy "Signed-in users can read runs" on public.runs
  for select to authenticated using (true);

drop policy if exists "Signed-in users can read test results" on public.test_results;
create policy "Signed-in users can read test results" on public.test_results
  for select to authenticated using (true);

revoke all on public.runs, public.test_results from anon;
revoke insert, update, delete on public.runs, public.test_results from authenticated;

-- Save one results payload (from scripts/process-results.mjs) in a single transaction.
-- Sending the same run again replaces its earlier results, so upload retries are safe.
create or replace function public.ingest_run(payload jsonb)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  r jsonb := payload -> 'run';
  c jsonb := coalesce(payload -> 'counts', '{}');
  saved_id bigint;
begin
  insert into runs (
    project, environment, ci_run_id, attempt, repo, branch, commit_sha, commit_message, trigger, url,
    verdict, reason, total, passed, failed, flaky, skipped, runner_errors, started_at, duration_ms
  ) values (
    r ->> 'project',
    r ->> 'environment',
    r ->> 'id',
    coalesce((r ->> 'attempt')::int, 1),
    nullif(r ->> 'repo', ''),
    nullif(r ->> 'branch', ''),
    nullif(r ->> 'commit', ''),
    nullif(r ->> 'commitMessage', ''),
    nullif(r ->> 'trigger', ''),
    nullif(r ->> 'url', ''),
    payload ->> 'verdict',
    payload ->> 'reason',
    coalesce((c ->> 'total')::int, 0),
    coalesce((c ->> 'passed')::int, 0),
    coalesce((c ->> 'failed')::int, 0),
    coalesce((c ->> 'flaky')::int, 0),
    coalesce((c ->> 'skipped')::int, 0),
    coalesce(payload -> 'runnerErrors', '[]'),
    nullif(r ->> 'startedAt', '')::timestamptz,
    round((r ->> 'durationMs')::numeric)::int
  )
  on conflict (project, ci_run_id, attempt) do update set
    verdict = excluded.verdict, reason = excluded.reason,
    total = excluded.total, passed = excluded.passed, failed = excluded.failed,
    flaky = excluded.flaky, skipped = excluded.skipped,
    runner_errors = excluded.runner_errors, started_at = excluded.started_at,
    duration_ms = excluded.duration_ms
  returning id into saved_id;

  delete from test_results where run_id = saved_id;

  insert into test_results (
    run_id, name, file, line, browser, feature, priority, tags, status,
    duration_ms, retries, error, screenshot_path, trace_path
  )
  select
    saved_id,
    t ->> 'name',
    nullif(t ->> 'file', ''),
    (t ->> 'line')::int,
    nullif(t ->> 'project', ''),
    t ->> 'feature',
    t ->> 'priority',
    coalesce(array(select jsonb_array_elements_text(coalesce(t -> 'tags', '[]')))::text[], '{}'),
    t ->> 'status',
    round((t ->> 'durationMs')::numeric)::int,
    coalesce((t ->> 'retries')::int, 0),
    nullif(t -> 'error', 'null'::jsonb),
    t ->> 'screenshotPath',
    t ->> 'tracePath'
  from jsonb_array_elements(coalesce(payload -> 'tests', '[]')) as t;

  return saved_id;
end;
$$;

-- Only the server (secret / service_role key) may write results.
revoke execute on function public.ingest_run(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_run(jsonb) to service_role;
