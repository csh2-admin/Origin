# Origin — Cryogenic Pump Test System Tracker

## Quick Reference

- **Stack**: Flask backend (Python 3.13) + React/TypeScript frontend (Vite)
- **Database**: TimescaleDB on Timescale Cloud, driver: pg8000 (pure Python, SSL)
- **Deploy**: Docker single-container on DigitalOcean droplet (167.99.170.39:8000)
- **Repo**: github.com/csh2-admin/Origin
- **Auth**: Users log in with their own database credentials; sessions stored in-memory (lost on restart)

## Deploy Flow

```bash
# On local machine:
git add <files> && git commit && git push

# On server (167.99.170.39):
cd /opt/origin && git pull && docker compose build --no-cache && docker compose up -d --force-recreate
```

Always commit and push BEFORE telling the user to rebuild on the server.

## Database Tables

Actual table names — use these, not abbreviations:

| Table | Purpose |
|-------|---------|
| `positions` | Reference table of 14 pump component positions |
| `parts_catalog` | Valid part numbers per position |
| `change_events` | Append-only change log (TimescaleDB hypertable) |
| `test_runs` | Test execution tracking (steps, checklist, completion) |
| `memo_log` | Engineer voice memos and observations (**NOT** `memos`) |
| `action_items` | Action items parsed from memos (**NOT** `actions`) |
| `feedback` | User feedback submissions |
| `component_photos` | Photos attached to change events |
| `assembly_instructions` | Editable step lists per procedure sub-page |
| `assembly_runs` | One run per sub-page per pump head |
| `assembly_step_logs` | Per-step completion within a run |
| `position_limits` | Cycle or hour limits per position |
| `motor_speed_data` | Time-series process data (external/SCADA) |
| `procdatatagtable` | Tag index for process data (external/SCADA) |

Tables in `db/init.sql`: positions, parts_catalog, change_events, assembly_instructions, assembly_runs, assembly_step_logs, position_limits. The rest were created via ad-hoc migrations.

## Key Constants

- `ADMIN_USERS = {"engineer1", "edwardyoun", "anthonyku", "jimmyli"}` — controls who can edit usage limits
- `GITHUB_REPO = "csh2-admin/Origin"` — for auto-created feedback issues
- `EXEMPT_POSITIONS = {"inline_dcv"}` — exempt from asset model verification

## Environment Variables (in `backend/.env`, loaded via docker-compose `env_file`)

- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SSLMODE` — database connection
- `GITHUB_TOKEN` — GitHub API token for issue creation
- `ANTHROPIC_API_KEY` — for Claude AI features (Weebo Ask, memo extraction)

## Backend Notes

- **All routes** are in `backend/app/routes.py` (~1700+ lines)
- **Use `logging.getLogger(__name__)`** for log output — gunicorn does NOT capture raw `print()` from workers
- **Single gunicorn worker** — daemon threads get killed before completing; always make external API calls synchronously
- `require_db` decorator handles auth and provides `conn` parameter; does NOT catch exceptions
- `_serialize()` converts db rows to JSON-safe dicts
- `_dict_rows(cur)` / `_dict_row(cur)` convert cursor results to dicts

## Frontend Notes

- API client: `frontend/src/api/client.ts` — all endpoints go through `request<T>()` helper
- Types: `frontend/src/types/index.ts`
- Styles: `frontend/src/styles/app.css` (single file)
- Dev server: `npm run dev` on port 5179 (configured in `.claude/launch.json`)

## Common Pitfalls

- **Table names**: The API routes use `/memos` and `/actions` as URL paths, but the actual database tables are `memo_log` and `action_items`. Always grep for `FROM` / `INTO` patterns in routes.py before writing new queries.
- **Gunicorn + print**: `print()` output from gunicorn workers doesn't appear in `docker compose logs`. Use Python `logging` module instead.
- **Gunicorn + threads**: Daemon threads are killed when the request completes. Don't use `threading.Thread(daemon=True)` for external API calls.
- **Session loss**: In-memory sessions are lost on container restart. Users need to log in again after every deploy.
- **CSS variables**: Use `var(--accent)`, `var(--border)`, `var(--bg)`, `var(--text)`, `var(--text-secondary)`, `var(--surface-alt)`, `var(--radius)`.
