# 038 — `DATABASE_SSL_REJECT_UNAUTHORIZED` for Render's self-signed managed Postgres cert

**Date:** 2026-08-28
**Story:** S-20
**Requirement:** REQ context: decision 023 (encryption in transit, off-by-default `DATABASE_SSL`)
**Decided by:** Megan (hotfix, found live on the Render deploy)

## The question

The first live Render deploy failed at DB connect:
`self-signed certificate (DEPTH_ZERO_SELF_SIGNED_CERT)`. `backend/src/db/pool.ts` had
`ssl: { rejectUnauthorized: true }` hardcoded whenever `DATABASE_SSL=true` — correct against a
Postgres with a CA-signed certificate, but Render's managed Postgres presents a self-signed
cert. Strict verification rejects the TLS handshake outright, so the app can never reach its
own database once `DATABASE_SSL=true` is set, which decision 023's own encrypted-in-transit
posture requires turning on for any real deployment.

## Why

Render's managed Postgres instances use a self-signed certificate. `rejectUnauthorized: true`
is the right default for a Postgres reachable over the public internet with an unverified
identity, but Render's managed database sits on Render's own private network, reachable only
via the internal connection string Render itself issues to the paired web service — the
"is this really who I think I'm talking to" question strict cert verification exists to answer
is already answered by Render's network boundary, not by the cert chain. Treating self-signed
as untrusted here would make `DATABASE_SSL=true` — decision 023's own mechanism for turning on
transit encryption — permanently unusable against the one managed Postgres provider this story
actually deploys to.

## What

A new, opt-in env var: `DATABASE_SSL_REJECT_UNAUTHORIZED=false`. Only when explicitly set to
the literal string `"false"` does `rejectUnauthorized` flip to `false`; any other value, or the
var being unset, keeps `rejectUnauthorized: true` — the default stays strict everywhere. Needed
only on Render (set alongside `DATABASE_SSL=true` there). Every other environment — local
Docker Compose (`DATABASE_SSL` unset, `ssl: undefined`, unaffected), or any future deployment
that doesn't set this new var — is unchanged. Backward compatible with decision 023's posture
and with anything already running `DATABASE_SSL=true` without this flag (still gets strict
verification, same as before this change).

```diff
- ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
+ ssl:
+   process.env.DATABASE_SSL === "true"
+     ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
+     : undefined,
```

## What this rests on

That Render's own network boundary (the managed Postgres is reachable only via Render's
internal connection string, not a publicly-routable one an attacker could MITM) is a reasonable
substitute for certificate-chain verification in this specific deployment. Not a claim that
disabling cert verification is safe in general — only that it's an acceptable, disclosed
exception for Render's specific managed-Postgres network topology, same honesty standard
decision 023 already set for this project's encryption posture.

## What would make this wrong

If this app is ever pointed at a Postgres with a real CA-signed certificate (e.g. a
self-hosted cluster fronted by Let's Encrypt, or a different managed provider that doesn't use
a self-signed cert), leave `DATABASE_SSL_REJECT_UNAUTHORIZED` unset — strict verification comes
back automatically, no code change needed. If Render's own managed Postgres later starts
issuing CA-signed certs, the same applies: stop setting the flag, verification resumes.
