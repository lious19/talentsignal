# How to present TalentSignal — a script you can actually follow

Ali's note: **explain what the project IS before jumping into what you built.** This script does
exactly that. The first four minutes have no tech, no "R0/R1", no jargon — just the problem and
the idea, in plain words. Only after the room understands the project do you show the work.

Read it out loud a few times. You don't have to say it word-for-word — but if you blank, these
words are safe to fall back on.

---

## The golden rule of this presentation
**Nobody in the room knows this project except you and Ali.** So you start from zero. Assume the
person listening has never heard the words "staffing agency" or "TalentSignal." Bring them up
slowly. The moment you say "R2" or "the audit trigger" before they understand the project, you
lose them — that's what happened last time, and it's the only thing you need to fix.

---

## PART 1 — The setup (≈3–4 min, NO technology)

**Slide 1 (title).** Don't rush off it. Say:
> "Before I show you anything I built, I want to explain in plain words what this project even is —
> because it only makes sense once you understand the problem it solves. Give me two minutes."

That one sentence buys you the room's patience. Then go slow.

**Slide 2 — what's a staffing agency.** Ask the room, genuinely:
> "Quick question — does everyone know what a staffing agency does? It's a company whose whole job
> is connecting businesses that need workers with people looking for jobs. Think of it like a
> dating app, but for jobs. They make money every time they successfully place someone."

**Slide 3 — the problem.** Slow down on the word *last*:
> "Here's their problem. Today, an agency finds out a company needs staff only when that company
> posts the job publicly. But by then, every rival agency has seen the exact same posting — so
> they're all fighting over the same opening, competing on price. The agency that hears about it
> *first* is the one that wins."

**Slide 4 — the one sentence.** Say it once, clearly, then pause:
> "So here's what I built: a tool that spots which companies are about to need to hire — before
> they even post the job — so the agency can reach out first."

Pause. Let it land. That sentence is the whole project.

**Slide 5 — before/after.** Make it real:
> "Without it, you see a public posting, so did five rivals, you cold-call and compete on price.
> With TalentSignal, you get an early heads-up before the posting — you call first, warm, while
> it's still uncrowded."

**Slide 6 — the one rule (your hook).** This is what makes it special:
> "And it has one strict safety rule built into it. The tool can suggest, score, and even write
> the outreach message — but it can never send anything on its own. A human always reviews and
> approves first. Like your phone suggesting a text: it writes the words, but only you press send.
> The AI does the typing — a person always owns the send."

**By now the room fully understands the project.** *Now* you've earned the right to show the work.

---

## PART 2 — What you built (≈4–5 min, now you can go deeper)

**Slide 7 — the whole machine.** Walk the six boxes left to right, plainly:
> "Here's how it works end to end. A hint comes in that a company might need people. The tool spots
> the demand, finds the best-fit candidates, scores how promising it is, tracks it through the
> sales process, and drafts the outreach. Then — a human reviews and sends. Never the machine."

**Slide 8 — real code.** Quick, 30 seconds:
> "This isn't slides or a mockup — it's a real, working app. Three parts: the screen you click,
> the brain that thinks, and the memory that stores everything. The outside data is simulated for
> now, like learning to drive in an empty parking lot — real car, no traffic yet."

**Slide 9 — the four layers.** Frame it as building safely, in order:
> "I built it in four layers, each one something you can watch run. The foundation, then the
> smarts, then the human-in-charge rule, and now the manager's dashboard. Twelve of twenty pieces
> done, on schedule."

**Slide 10 — the tamper-proof record.** Your proudest point, plainly:
> "One thing I'm proud of: every important action is recorded permanently — who, when, what. And
> nobody, not even an admin, can edit or delete it. Like a WhatsApp group where you can add
> messages but never delete the old ones. I proved it with a test that tries to change a record
> and the database refuses."

**Slide 11 — your actual job.** The answer to "did you build this?":
> "People ask — did you build this, or did the AI? The AI wrote most of the code. My job was to
> decide whether it was right, and I turned plenty down. One example: a safety limit was
> accidentally applied to the whole app instead of just the login — a couple of refreshes would
> have frozen everything, live. Every test passed. I only caught it by clicking through the real
> app myself."

**Slide 12 — honest limits.** Say them before anyone asks:
> "To be honest about what I haven't proven yet: the outside data is simulated, the scoring numbers
> are my proposal waiting on sign-off, full permissions aren't enforced yet, and nothing's online
> yet. I'd rather tell you that than guess."

**Slide 13 — close:**
> "So in one line: find the demand first, and the AI drafts while a human always sends. Happy to
> take questions."

Then **stop talking** and take questions.

---

## Delivery tips (the "how", not just the "what")

- **Slow down.** When nervous you speed up. The first four minutes especially — go slower than
  feels natural. Pauses feel long to you and normal to them.
- **Watch faces on slides 2–4.** If people look lost there, you've gone too fast — back up. If
  they're nodding, you can pick up pace.
- **One idea per slide.** Don't add detail the slide doesn't have. The slide is your outline.
- **If you blank,** reach for the green picture on the slide — dating app, phone text, WhatsApp,
  parking lot. The analogy will restart your sentence.
- **If Ali stops you again,** don't panic — ask "where did I lose you?" and back up to that point.
  That's a strong, calm move, not a weakness.

---

## Two other things Ali suggested — worth doing

1. **NotebookLM video/audio.** Upload `TalentSignal-revision-guide.pdf` (the plain-language one)
   into NotebookLM and generate an Audio Overview or video. Because that PDF is already written in
   simple words, the generated version will explain the project well — good to share so it's not
   "only you and Ali who understand it."
2. **Practice the first 4 minutes only.** You don't need to rehearse the whole thing — nail the
   opening (slides 1–6). If the setup lands, the rest is easy. Say it out loud three times before
   the next presentation.
