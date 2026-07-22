# Getting started with Claude Code on R0 — exact steps
Written 2026-07-22.

---

## First: you cannot give Claude Code the Basecamp link

Basecamp is behind a login. Claude Code has no session cookie for it, so fetching that URL
returns a login page, not your stories. Pasting the link produces a confident-looking
agent that has read nothing.

**The local files are the mechanism.** The story detail is now in `00_scope/stories/`.
Claude Code reads those from disk, no auth needed. When Ali changes something in Basecamp,
ask me (Cowork, which does have your browser session) to re-pull it into these files.

The one link that *does* work is the raw Build Guide markdown, if you download it from
Basecamp yourself and drop it in `00_scope/`.

---

## Machine check (run 2026-07-22)

| Tool | Status |
|---|---|
| Node | ✅ v24.14.0 |
| npm | ✅ |
| git | ✅ 2.53.0 |
| Claude Code | ✅ 2.1.212 |
| **Docker** | ❌ **NOT INSTALLED** |
| Docker Desktop | ❌ not present |

**Docker is the blocker.** S-01's entire acceptance criterion is `docker compose up`
bringing up three services. You cannot pass that scenario without Docker.

Docker Desktop on Windows needs WSL2 and a reboot. Budget 45–90 minutes, and do it
*before* opening Claude Code. Install from docker.com, enable WSL2 when prompted, reboot,
then confirm with `docker --version` and `docker compose version`.

---

## Step 0 — initialize the repo (5 min, do it yourself)

```powershell
cd "C:\Users\megan\OneDrive\Desktop\Internship_project"
git init
git branch -M main
```

Then delete the stale folders from the old data-analysis assumption — `01_data`,
`02_src`, `03_notebooks`, `04_deliverables`. They will confuse Claude Code about what
kind of project this is.

⚠️ **OneDrive + Docker + `node_modules` is a genuinely bad combination.** OneDrive will
try to sync tens of thousands of dependency files and Docker bind-mounts get slow and
flaky on synced folders. Strongly consider moving the repo to `C:\dev\talentsignal`
before you start. If you keep it here, at minimum add `node_modules/` to `.gitignore`
immediately and exclude the folder from OneDrive sync.

---

## Step 1 — start Claude Code

```powershell
cd "C:\Users\megan\OneDrive\Desktop\Internship_project"
claude
```

It reads `CLAUDE.md` automatically on launch. That file already carries your rules of
engagement — explain-before-build, explain the JS, one story at a time, no silent
assumptions. You don't need to restate them each session.

---

## Step 2 — the first prompt (paste verbatim)

Do **not** open with "build S-01." Open with a plan you can interrogate. This is the
difference between approving code and rubber-stamping it.

```
Read CLAUDE.md, 00_scope/scope.md, and 00_scope/stories/S-01.md.

Do not write any code yet. Give me:
1. A plain-English description of what the walking skeleton does and why it exists
   before any feature.
2. The file tree you intend to create, and one sentence per file on its job.
3. The three or four decisions in this story that are actually choices, with your
   recommendation and the tradeoff for each.
4. Which parts of this I should expect to struggle to explain in class, given that
   I read Python fluently and JavaScript less so.

Then stop and wait for my approval.
```

Read the answer. Ask about anything you can't restate in your own words. *Then*:

```
Approved. Build it. Explain each JS/TS file as you write it — especially the Express
middleware and the correlation-id logger, since those are the trust scenario.
```

---

## Step 3 — verify, don't assume

Claude Code will tell you it's done. Prove it yourself:

```powershell
docker compose up --build
```

Then check both acceptance scenarios by hand:

1. **Stack boots clean** — React loads in the browser, `curl http://localhost:PORT/health`
   returns green for api *and* db.
2. **🛡 Structured logs** — hit any endpoint, watch stdout. You need a JSON line with a
   correlation id, route, and duration. If it's a plain-text log, the trust scenario
   fails and the story is not done.

Then break it on purpose: stop the postgres container and hit `/health` again. It should
report the db as unhealthy, not crash or silently return ok. That's the kind of thing
you'll be asked about.

---

## Step 4 — close the loop

- Check S-01 off in Basecamp *only* after both scenarios pass.
- Log any decision Claude Code made for you into `06_decisions/`, in your own words.
- If it slipped, say so in Basecamp the same day. Silent slippage is the thing that
  actually damages you here.

---

## Realistic plan for this week

You are one story behind and Docker isn't installed. Honest sequencing:

| When | What |
|---|---|
| **Today AM** | Install Docker Desktop (reboot). Send Ali the open questions. |
| **Today PM** | Git init, clean stale folders, S-01 via Claude Code, verify both scenarios. |
| **Thu** | S-02 auth. Blocked-ish on Ali's JWT lifetime answer — pick 15 min + refresh, log it, revise if he disagrees. |
| **Fri** | S-03 vertical slice. **Blocked on Ali** for the confidence-score factors and weights. |

S-03 has a real dependency on Ali. Ask today, not Friday morning.

---

## Ask Ali today (six questions, all in `00_scope/scope.md`)

The two that block code this week:

1. **S-03 confidence score** — what factors, what weights? This is a business decision and
   the spec explicitly says don't invent it.
2. **TypeScript or JavaScript?** The definition of done says "tsc clean," which implies
   TypeScript, but the build notes just say React/Node. Expensive to reverse at week 3.

Plus: the phase-gate dates contradict the story dates, who provisions
`talentsignal-demo.colaberry.dev` and do you have deploy credentials, is REQ-017's 1000
concurrent users measured or estimated, and is REQ-012 scoped to compliance-shaped
features rather than actual certification.
