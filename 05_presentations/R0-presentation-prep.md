# R0 Presentation Prep — S-01 to S-03
For Tuesday. Everything you need to build slides and defend them live.

---

# PART 1 — The story you're telling

## The strategic choice
Do **not** present this as "here is what got built." Present it as **"here is what I
caught."** Every person in that room is silently asking whether you did anything or
whether the AI did it. Answer that in your first ninety seconds, on your own terms,
before anyone raises a hand.

You are the reviewer. R0 is the proof that review caught real defects — eight of them,
several in work that had already been reported as complete.

## The arc — five beats

**1. Tension (30 sec)**
A staffing salesperson finds out a client needs people when the client calls and asks.
By then, three other agencies got the same call. You're competing on price for work you
found out about last. TalentSignal exists to find the demand *before* the ask.

**2. The move (1 min)**
R0 doesn't build any of that intelligence. R0 builds the spine and proves it works:
a browser talks to an API talks to a database, one command starts all three, every
request is traceable, and one mocked market signal becomes one scored opportunity on
screen. Nothing smart. Everything observable.

**3. Evidence (2 min)**
Live demo. Not slides of code — the actual running system.

**4. Trust (1.5 min)**
This project runs on "Trust Before Intelligence": the platform earns the right to be
smart by first being safe, transparent and reversible. Show what that means concretely —
every score carries its confidence, its reasons, and its source; no password reaches a
log; nothing is asserted as certain.

**5. Honesty (1 min)**
What's mocked, what's unproven, what's still pending. Naming your own gaps pre-empts the
hardest question in the room and is the single most credible thing you can do.

## The line to land
> "The AI wrote most of this code. My job was to decide whether it was right. Three times
> it told me a story was done when it wasn't."

Say it early. It reframes everything after it.

---

# PART 2 — What each story actually did

## S-01 — Walking skeleton
**One sentence:** one command starts a React app, an Express API, and a PostgreSQL
database, wired together and proven to talk to each other.

**Why it exists first.** A "walking skeleton" is the thinnest possible slice through
every layer of a system, with no features in it. If you build features first and the
plumbing is shaky, every bug becomes "is this my feature, the network, Docker, or the
database?" Proving the skeleton first means every later bug has one fewer place to hide.

**What's in it**
- `docker compose up` starts three containers on one network.
- `/api/health` returns green — and `db: ok` is a *real query round-trip*, not just
  "the Postgres process is alive."
- Every request emits one structured JSON log line with a correlation id, route, method,
  status, and duration.
- A migrations runner applies `.sql` files in order and records what it applied.

**The trust scenario:** structured logs exist from commit one, so failures are observable
rather than silent.

---

## S-02 — Authentication
**One sentence:** you can register and log in; the API gives you a signed token proving
who you are; your password is never stored or logged in readable form.

**What's in it**
- `users` table: id, email (unique), password_hash, role, timestamps.
- Passwords hashed with bcrypt at cost factor 12.
- Login returns a JWT valid for one hour, carrying your user id and role.
- Registration always creates a `sales` user. An admin is created separately at boot from
  environment variables.
- Rate limit: 10 requests per 15 minutes per IP on auth routes.
- Login and register screens in React.

**The trust scenario:** only a bcrypt hash reaches the database, and the raw password
appears nowhere in the logs.

---

## S-03 — First vertical slice
**One sentence:** a mocked job-board signal flows through an adapter, gets scored, is
saved, and appears on screen with its confidence, its reasons, and where it came from.

**What's in it**
- A provider *interface* with a mocked job-board implementation behind it.
- A 5-second timeout on the provider call.
- An `opportunities` table with a uniqueness constraint on (source, signal id).
- A transparent scoring function — a weighted sum, no machine learning.
- A React list showing confidence, reasons and source together.
- Both endpoints require a valid login.

**The trust scenario:** confidence and source are always shown together. Never a bare
number.

---

# PART 3 — The eight defects you caught

**This is your presentation's centre of gravity.** Pick three or four to tell in detail;
list the rest.

### 1. The cold-start race (S-01) — the best one to lead with
The first plan started all three containers at once. Postgres takes a few seconds to
accept connections, so the API would come up, try to connect, and fail. Docker's
`depends_on` only waits for a container to *start*, not to be *ready* — a distinction
that isn't obvious and bites almost everyone.

The acceptance criterion said "Given a fresh clone," meaning a genuinely cold start. It
would have failed on exactly the scenario it was written for.

Fix: a health check on Postgres (`pg_isready`) plus `depends_on: condition: service_healthy`.

### 2. No tests (S-01)
The plan had zero tests. The project's definition of done requires happy path, failure,
and idempotency coverage. The story literally could not have passed its own bar.

### 3. The logger went silent on aborted requests (S-01)
The logger listened for the `finish` event, which fires when a response completes
normally. If a user closes the tab mid-request, `finish` never fires — **no log line at
all.** The trust scenario says *any* request produces a log line. An aborted request was
invisible, which is the exact silence structured logging exists to prevent.

Fix: also listen for `close`, and use `writableEnded` to tell a completed request from an
aborted one.

### 4. A test that depended on the outside world (S-01)
`migrate.test.ts` asserted the database started un-migrated. That made it pass or fail
depending on whether something else had run first — a coin flip in CI. Fixed by giving
the test its own throwaway schema.

**Worth noting out loud:** I suggested just deleting the offending assertion. Claude Code
pushed back — that assertion is what catches a migration runner silently regressing into
a no-op — and isolated the test instead. Its reasoning was better than mine.

### 5. Privilege escalation (S-02) — the most serious
The plan had registration accept a `role` from the request body. Anyone could have POSTed
`{"role": "admin"}` and made themselves an administrator. Role-based access control is
scheduled for S-14 — and it would have been decorative, because users would have handed
themselves admin at signup.

Fix: registration hardcodes `sales`. Admin is bootstrapped from environment variables.

### 6. The documented API path returned 404 (S-03)
The acceptance criteria say `POST /api/auth/login`. The server actually served
`/auth/login`. It only worked in a browser because the dev server quietly rewrote the URL.
Curl the path from the spec and you got 404 — and it would have broken entirely at
deployment, where no dev server exists to do the rewriting.

### 7. Dead security middleware (S-03)
S-02 wrote a `requireAuth` middleware and never applied it to anything. The new endpoints
exposing company data would have been open to anyone who could reach the port.

### 8. A story reported complete that wasn't (S-03)
S-02's build note said "register/login React screens." They were never built — which is
why viewing the app required pasting a token into browser storage by hand. S-02 had been
marked complete on Basecamp. **I corrected it publicly rather than folding it in quietly.**

---

# PART 4 — Explaining the technical parts

For each: what it is, why it matters, and a Python-shaped way to think about it.

### Structured logging + correlation IDs
Instead of `print("GET /health took 20ms")`, every log line is a JSON object with the same
fields. Machines can query it; humans can grep it. Each request gets a unique id, so you
can trace one request through everything it touched.

*Python analogy:* `logging` with a JSON formatter and a request id in the `extra` dict.

**The subtle part worth explaining:** duration can't be measured right after handing the
request onward, because the handler is asynchronous — that call returns almost
immediately, long before the response is actually sent. So you register a callback that
runs when the response finishes. The function is *defined* now and *runs* later.

*Python analogy:* attaching a callback, or a `finally` block that runs whenever the work
actually ends.

### Why bcrypt is deliberately slow
Normal hashing is fast. Password hashing must be slow. If an attacker steals your database,
their attack is guessing passwords and hashing each guess. A fast hash lets them try
billions per second; bcrypt at cost 12 takes about a quarter second per guess.

The cost factor is exponential — 13 is twice as slow as 12.

**Say this out loud:** it conflicts with our own requirement REQ-017 (95% of responses
under 200ms). Bcrypt at cost 12 exceeds that by itself. That's not a bug — the slowness
*is* the security. I flagged it for Ali rather than quietly weakening it.

### JWTs are signed, not encrypted
A JWT is three base64 parts. **Anyone can read the payload.** What they can't do is change
it, because the signature would stop matching, and producing a valid signature requires
the server's secret. It proves *not tampered with*, not *secret*.

Common misconception, so it's a likely question.

### User enumeration and the timing attack
If "no such email" and "wrong password" return different messages, anyone can script
through email addresses and learn which ones are real accounts — on a staffing agency's
sales tool, that's a list of your staff.

Both return an identical 401. Same body, same length.

**The subtler half:** identical text isn't enough. If an unknown email skips the password
check entirely, it comes back measurably faster, leaking the same information through
timing. So both paths run a bcrypt comparison — against a dummy hash when there's no user.

*Claude Code caught this one unprompted. Worth saying so.*

### The race condition on duplicate emails
The naive approach: check whether the email exists, then insert if not. Two simultaneous
registrations can both pass the check before either inserts — and you get two rows.

Only the database can settle this. A `UNIQUE` constraint means both inserts go to
Postgres, one wins, the other fails with error code `23505`, which the app turns into a
409 response.

*Verified by firing two registrations simultaneously: exactly one 201, one 409, one row.*

*Python analogy:* same as any check-then-act race — the fix is to let the database be the
arbiter instead of your code.

### The adapter seam
The route doesn't import the job-board provider. It receives it as an argument. Swapping
the mock for a real job board changes exactly one line in the startup file — the route,
the scoring function and the tests don't change at all.

*Python analogy:* a Protocol or abstract base class with two implementations, passed in
rather than imported.

**This is the project's rule 5:** ship a transparent heuristic now, behind a boundary a
trained model can replace later without touching callers.

### Upsert
`INSERT ... ON CONFLICT ... DO UPDATE`. Analyzing the same signal twice updates the score
in place instead of creating a duplicate. Rejecting the second call would have been worse
— you'd see a stale score with no way to know it was stale.

*This one's straight SQL — comfortable ground for you.*

### The confidence score — say the honest thing
| Factor | Weight | Why |
|---|---|---|
| Base | 0.20 | A real posting existing is itself weak evidence |
| Reposted role | 0.32 | They tried once and failed to fill it |
| Days open (capped at 30) | 0.32 | The longer it sits, the more they need help |
| No salary range | 0.16 | Correlates with less structured hiring |

**Say plainly: these weights are mine, not the client's.** The spec says not to invent
them, so I asked, didn't get an answer before the deadline, and shipped a documented
proposal marked "pending approval" rather than missing the date or hiding that I'd guessed.
Every number lives in one config object — his answer is a one-line change.

**Why the base score exists:** without it, a job posted yesterday scores 0.0 — zero
confidence that a company hiring might need staffing help. That's indefensible, so I
added a floor. *This is a good thing to volunteer; it shows you interrogated the model
rather than accepting it.*

---

# PART 5 — Demo script

**Before you present:** `docker compose down -v` then `docker compose up --build`.
Wipes accumulated test junk. Do this early — the build takes a few minutes.

**Know this:** rate limiting is 10 auth requests per 15 minutes. If you fumble the login a
few times live, you can lock yourself out. `docker compose restart backend` clears it.

1. **One command.** Show `docker compose up` and the services coming up in order —
   database healthy, then API, then frontend. *"Nothing starts before what it depends on
   is actually ready."*
2. **Health.** `/api/health` → `{"status":"ok","db":"ok"}`. *"That db:ok is a real query,
   not a process check."*
3. **Register and log in** in the browser.
4. **The trust moment.** Search the logs for the password you just typed. Nothing.
   *"That's the trust scenario — I'm searching for the failure and not finding it."*
5. **What's stored.** `select email, role, left(password_hash,20) from users;` — show the
   `$2b$12$` prefixes. *"That's bcrypt at cost 12. The password itself isn't in there."*
6. **Analyze.** Show the opportunity appear with confidence, reasons, source.
7. **Break it.** Stop the database container, reload. Health reports the failure honestly.
   *"It tells you it's broken instead of pretending."*

Step 4 and step 7 are your best moments. Step 7 especially — deliberately breaking your
own demo is the most confident thing you can do on stage.

---

# PART 6 — Questions you will get

**"Did you write this, or did the AI?"**
> The AI wrote most of the code. I specified, reviewed, and approved it — and rejected
> plenty. Three times it reported a story done when it wasn't. Catching that is the job.

**"Why does the UI look like that?"**
> Deliberately. It's a walking skeleton. Styling it would mean I'd built something before
> proving the layers underneath work. It'll get a real interface once there's real
> functionality to wrap.

**"Where did the confidence weights come from?"**
> Me. They're a documented proposal marked pending approval, not client-approved numbers.
> The spec says these are a business decision I shouldn't invent, so I asked. I didn't get
> an answer before the deadline, so I shipped a transparent proposal rather than miss it
> or hide the guess.

**"So a job posted yesterday is 20% likely to be an opportunity?"**
> Not a probability — a relative confidence score. 0.20 is the floor, meaning a real
> posting is weak evidence on its own. Without a floor a brand-new posting scores zero,
> which would say a company actively hiring definitely doesn't need help. That's wrong,
> so I put a floor in.

**"How do you know the password isn't logged?"**
> A test registers with a distinctive password, captures everything written to the log
> during that request, and asserts the string appears nowhere. Full-text search, not a
> field-by-field check — so it also catches leaks through error messages and stack traces.

**"Is this secure?"**
> Authentication yes — hashed passwords, expiring tokens, rate limiting, no user
> enumeration. Authorization no, not yet: roles are stored but nothing enforces them.
> That's S-14. And nothing's deployed, so it hasn't faced the internet.

**"Can it handle 1000 concurrent users?"**
> No idea. That's S-18 and I haven't measured it. I'd rather say that than guess.

**"What's real and what's mocked?"**
> The stack is real — real Postgres, real API, real browser, real tokens. The job-board
> feed is mocked, behind an interface, so swapping in a real one is a one-line change.

**"Why one-hour tokens with no refresh?"**
> A deliberate tradeoff. A refresh flow means a second token type, rotation and
> revocation — real scope I'd rather build once, properly. The cost is that a stolen token
> stays valid up to an hour and can't be revoked. It's logged as decision 002.
>
> *Worth admitting: I originally argued for 15 minutes plus refresh. Claude Code made the
> better argument and I changed my mind.*

**"What would you do differently?"**
> Install Docker before starting. That cost me half a day and S-01 shipped a day late.

---

# PART 7 — Slide skeleton

1. **Title** — TalentSignal Revenue Engine, R0
2. **The problem** — finding out about demand last
3. **What R0 is** — the spine, not the intelligence. Why prove plumbing first
4. **The architecture** — one diagram: browser → API → database, with the mocked provider
   hanging off the side
5. **Trust Before Intelligence** — the seven rules, and which three R0 makes real
6. **DEMO** *(no slide — go to the screen)*
7. **What review caught** — the eight defects. Your strongest slide
8. **Decisions I had to make** — TypeScript, bcrypt cost vs REQ-017, JWT lifetime,
   confidence weights. Show that these were arguments, not defaults
9. **What's unproven** — mocked provider, weights pending approval, no RBAC, no
   deployment, no load testing
10. **Next** — R1: real hidden-demand analysis, clients and candidates, matchmaking

Slide 7 is the one to spend your preparation on.

---

# PART 8 — Three things to remember

**Lead with the review, not the build.** The interesting story isn't that an AI wrote
code. It's that a person checked it and found eight real problems.

**Volunteer your gaps before you're asked.** "The weights are mine and unapproved" and
"S-02 was reported done before it was" are far stronger coming from you than extracted
from you.

**Don't claim what you haven't measured.** Not "it's fast" or "it's secure" — "p95 is
S-18 and I haven't measured it." Precision about the limits of your own knowledge is what
makes the rest of your claims believable.
