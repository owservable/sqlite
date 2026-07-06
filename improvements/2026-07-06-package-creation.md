# Package Creation
**Date:** July 6, 2026
**Project:** @owservable/sqlite
**Version:** 3.0.0

Fourth member of the owservable family (core + mongodb + postgres + sqlite), created from the postgres repo as template. Full design rationale: `owservable/improvements/2026-07-02-postgresql-backend-design.md` in the owservable repo (section "Adapter candidate — @owservable/sqlite").

## Why it exists

Live UIs over SQLite files that **other processes** write to — the motivating case is a Vue console reacting to mastra.ai agents/workflows writing their storage (memory threads, traces, workflow snapshots) into SQLite/libsql. Also serves desktop/electron tools and local-first apps.

## Design vs the postgres adapter

| Concern | postgres | sqlite |
|---|---|---|
| Change capture | trigger → `pg_notify` (push) | trigger → `_owservable_changes` journal table (pull) |
| Change transport | `PostgresListener`, one LISTEN connection | `SqliteJournalPoller`, interval poll (default 250 ms), prune after consumption |
| Cross-process writes | native (server-side NOTIFY) | native (SQLite triggers fire for every writer connection) — **the reason this design was chosen** over ORM flush events or per-connection update hooks, which are blind to external writers |
| Changed columns | `to_jsonb(OLD)` vs `to_jsonb(NEW)` diff in trigger | generated per-column `CASE WHEN OLD."c" IS NOT NEW."c"` comparisons in trigger |
| Concurrency prerequisites | none | WAL mode + busy_timeout (set automatically by the connector) |
| Everything downstream | identical — `SqliteBackend` mirrors `PostgresBackend`, same enrichment, same stores, same wire protocol | |

## Testing

- Unit suite: jest, mocked ORM (MikroORM v7 is ESM-only and jest cannot load it), 100% coverage enforced.
- Integration: `pnpm integration` — ts-node harness against a **temp-file** database with a second raw better-sqlite3 connection acting as the external writer (the mastra role). No machine dependencies of any kind. `:memory:` deliberately not used — it is per-connection and cannot exercise the cross-process path.
