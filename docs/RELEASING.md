# Releasing

Nobody releases by hand. Merging to `main` is shipping.

```
pull request ──► Checks (title, typecheck & build, migrations, integration + e2e)
             ──► Review (Claude comments)
             ──► auto-merge (squash; the PR title is the commit)
main ──► Ship: Checks again on the merged code
              → migrate production (supabase db push)
              → deploy to Vercel production
              → smoke test (/api/health names this commit, /login 200, dashboard redirects, unknown /pay 404)
              → on failure: roll back the deploy, open a "Ship failed" issue
              → release: next version, notes, git tag, GitHub release, recorded in the app
```

## Versions

Strict `MAJOR.MINOR.PATCH`, as git tags `vX.Y.Z`. Worked out from the commits
since the last tag (`scripts/release-lib.mjs`):

| Commits include | Release |
|---|---|
| `feat!:` / `fix!:` / `BREAKING CHANGE:` in the body | major |
| `feat:` | minor |
| `fix:`, `perf:`, `refactor:`, `revert:`, `security:` or anything unconventional | patch |
| only `chore:`, `docs:`, `test:`, `ci:`, `build:`, `style:` | none |

## Notes she reads

`scripts/release.mjs` asks Claude (via the Claude Code CLI and
`CLAUDE_CODE_OAUTH_TOKEN`) for a punny title and plain-English notes about only
what she would notice, each linked to a tour stop where one shows it. Tour stops
new since the last tag are offered to it, so a new feature's stop gets a "Show
me". Without the token, or if the answer is malformed, it falls back to a pun
from a fixed list and the feature/fix subjects.

The release is POSTed to `/api/releases` (`RELEASE_SECRET`) and stored in
`ops.releases`. After she next signs in, **What's new** shows what she hasn't
seen, with "Show me" per note and "Show me what's new" touring only those stops.
Help → What's new lists every release, and her own problem reports with "Fixed
in vX.Y.Z" once a release says `Fixes #N` for their issue.

## Migrations

They run against production before the new code deploys, and can't be rolled
back. So: new files only, named `YYYYMMDDHHMMSS_what.sql`, sorting after the
newest on main, and additive — add a column, backfill, switch the code over;
drop the old one in a later release. `scripts/check-migrations.sh` enforces this;
a person can add the `destructive-ok` label to let one through.

## Secrets and settings

| Where | Name | What |
|---|---|---|
| GitHub secret | `CLAUDE_CODE_OAUTH_TOKEN` | Claude for agents, review and release notes (`/install-github-app`) |
| GitHub secret | `BOT_TOKEN` | Fine-grained token: contents, pull requests, issues (read/write) on this repo. Turns on auto-merge — a merge by the workflow's own token would not start Ship |
| GitHub secret | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | Migrating production |
| GitHub secret | `VERCEL_TOKEN` | Deploying production |
| GitHub secret + Vercel env | `RELEASE_SECRET` | Recording releases in the app |
| GitHub secret + Vercel env | `HEALTH_SECRET` | The nightly health check |
| Vercel env | `GITHUB_ISSUES_TOKEN` | Filing her reports as issues (the same token as `BOT_TOKEN` works) |
| GitHub variable | `APP_URL`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | |
| GitHub variable | `SHIP_DEPLOYS` | `true` once the above are set: Ship deploys, and Vercel's own deploy of main is off (`vercel.json` → `git.deploymentEnabled.main`) |

## The agent queue

Issues labelled `queued` are worked one at a time, lowest number first
(`.github/workflows/agent-queue.yml`): when nothing is in progress, the next
gets the `agent` label and Agents picks it up; its merged PR closes the issue
and the next starts. Reorder by renumbering — or take `queued` off an issue to
hold it. Something stuck for three hours with no PR is labelled `needs-human`
and skipped.
