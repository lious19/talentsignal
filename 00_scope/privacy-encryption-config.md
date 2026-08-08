# Encryption config (S-15, REQ-013)

Ali's build note says "encryption at rest/in transit — config." This is that config,
documented honestly: what's actually turned on today, what isn't, and what a production
deployment needs that this demo doesn't build. See `06_decisions/023` for the reasoning.

## At rest

Infrastructure-level, not application code — no hand-rolled column encryption exists
anywhere in this codebase, and none should be added (CLAUDE.md: no fake/hand-rolled
crypto).

- **Today (demo):** `postgres:16-alpine` in Docker Compose, writing to a named volume
  (`db_data`), with **no disk/volume-level encryption configured.**
- **Production would need one of:**
  - A managed Postgres offering with encryption-at-rest on by default (e.g. a cloud
    provider's managed database), or
  - LUKS/dm-crypt (or equivalent) under the container's storage volume if self-hosting
    Postgres on a VM.

  Neither is built here — both are infrastructure choices outside this application's
  code, and the specific provider isn't decided yet (see S-20 note below).

## In transit

Two separate hops, at different levels of maturity:

### App ↔ Postgres

- **Today (demo):** plain TCP over the Docker Compose private bridge network
  (`backend` talks to `db:5432` — see `docker-compose.yml`). This traffic never leaves
  the Docker host, so it isn't exposed the way a connection over the public internet
  would be, but it is genuinely unencrypted on the wire.
- **Config added:** `backend/src/db/pool.ts`'s `createPool()` reads a `DATABASE_SSL` env
  var (unset/`"false"` by default). Set `DATABASE_SSL=true` to enable TLS
  (`{ rejectUnauthorized: true }`) when connecting to a Postgres instance that requires
  or accepts it — e.g. a managed database reachable over a network that isn't already
  private. **This flag being present in the code is not a claim that transit encryption
  is running in the demo** — it's off by default, on purpose, because the demo's DB
  isn't actually network-separated from the app.

### Client ↔ backend (public internet)

This is the hop that genuinely needs TLS in any real deployment, but *how* it's
terminated (a reverse proxy, a platform-managed certificate, etc.) is a decision that
belongs to the deployment story (S-20), which does not exist yet as of this writing (no
`00_scope/stories/S-20.md`). Not guessed at or configured here — flagged as S-20's
responsibility.

## What's demo-scoped vs production, at a glance

| | Demo (today) | Production |
|---|---|---|
| At rest | Not encrypted | Managed Postgres w/ encryption, or LUKS/dm-crypt |
| App ↔ Postgres | Plain TCP (private Docker network) | `DATABASE_SSL=true` once DB is network-separated |
| Client ↔ backend | N/A (not deployed) | TLS termination — S-20's decision, not yet made |
