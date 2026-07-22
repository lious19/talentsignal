# 001 — Host port mapping for the db service

**Date:** 2026-07-22
**Story:** S-01
**Requirement:** REQ-018
**Decided by:** Megan

## The question
`docker-compose.yml` mapped Postgres to the host as `5432:5432`. Megan's machine
already runs a native PostgreSQL 18 service bound to `127.0.0.1:5432`, which
silently intercepts anything a host-side tool (psql, a GUI client) sends to
`localhost:5432` — it never reaches the container.

## Options considered
1. Leave `5432:5432` and have Megan stop her native Postgres service whenever
   she runs the stack.
2. Map the container to a different host port (`5433:5432`) and leave the
   native service alone.

## What we chose, and why
Option 2. `5433:5432` for the `db` service's host mapping, controlled by a new
`DB_PORT` env var (default `5433` in `.env.example`). Nothing about a
teammate's machine should have to change to run this project's containers.

## What this rests on
Container-to-container traffic (backend → db) goes over the internal Docker
Compose network, addressed as `db:5432` — that's untouched by this change.
Only the host-side published port moved. Any host tool (psql, TablePlus, etc.)
connecting from outside Docker must now target `localhost:5433`, not `5432`.

## What would make this wrong
If the deployed demo environment (S-20) or CI needs a fixed, well-known port
for Postgres that assumes 5432, this default will need to be overridden via
the `DB_PORT` env var there — it's a host-machine convenience, not a contract.
