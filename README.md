![owservable](https://avatars0.githubusercontent.com/u/87773159?s=75)

# @owservable/sqlite

[📖 API Docs](https://owservable.github.io/sqlite/docs/) · [✅ Coverage](https://owservable.github.io/sqlite/coverage/)

SQLite backend adapter for [@owservable/core](https://github.com/owservable/core): live data via journal-table triggers over MikroORM entities — **including changes made by other processes** writing to the same database file.

Built for scenarios like a live UI over a SQLite file that backend processes (e.g. [mastra.ai](https://mastra.ai/) agents and workflows) write to, desktop/electron tools, and local-first apps.

## 🚀 Features

- **SqliteBackend**: implements `IObservableBackend` over a MikroORM entity — change feed, queries with Mongo-style operators, relation population
- **Journal-table change capture**: `installSqliteTriggers` attaches `AFTER INSERT/UPDATE/DELETE` triggers writing to a `_owservable_changes` journal — SQLite triggers fire **regardless of which connection or process writes**, so external writers are fully visible
- **SqliteJournalPoller**: reads the journal on a short interval (default 250 ms, an indexed range scan on a usually-empty table), emits normalized change events, prunes consumed rows
- **Changed-column tracking**: the update trigger records exactly which columns changed (generated per-column comparisons), so stores keep their field-intersection reload optimizations
- **SqliteObservableTable**: PK-refetch enrichment and column→property mapping — change events are shaped exactly like MongoDB change streams
- **`updateSchema: false` mode**: map entities over tables owned by another tool (e.g. mastra's storage schema) — the connector attaches triggers and registers backends without touching DDL
- **SqliteConnector**: MikroORM init, WAL + busy_timeout pragmas, optional `updateSchema({safe: true})`, trigger install, poller and backend registration in one call

## 📦 Installation

```bash
npm install @owservable/core @owservable/sqlite @mikro-orm/core @mikro-orm/sqlite
```

or

```bash
pnpm add @owservable/core @owservable/sqlite @mikro-orm/core @mikro-orm/sqlite
```

## ⚠️ Operational requirements

- **WAL mode** is set automatically and is mandatory for the multi-process case (external writer + owservable reader on the same file)
- **Local file databases only** — remote libsql (Turso/sqld) has no shared file to watch
- Update latency equals the poll interval (default 250 ms)
- Triggers on externally-owned tables are additive and safe, but external migrations that drop/recreate tables remove them — the idempotent bootstrap re-installs on every boot

## 📄 License

Unlicense — see [LICENSE](LICENSE).
