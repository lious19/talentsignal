# To discuss with Ali when he's back
He's out for a week (as of Jul 22). Proceeding on documented judgment calls; nothing here
blocks building, but each needs his eventual sign-off.

## Decisions made in his absence (need ratification)
1. **Confidence-score weights (decision 007).** Not specified anywhere in the spec —
   confirmed by searching the full Build Guide (evidence in 007b). I authored a transparent
   proposal; every constant is in one config object, so his answer is a one-line change.
   Now load-bearing since S-04 ranks the whole board by them.
2. **TypeScript** chosen over JavaScript (the DoD says "tsc clean"). Confirm.
3. **JWT: 1 hour, no refresh** (decision 002). Tradeoff: a stolen token lives an hour.
4. **REQ-017 vs bcrypt conflict.** The p95 <200ms target and bcrypt cost 12 can't both hold
   on auth endpoints — the slowness is the security. Proposed: scope the p95 target to data
   endpoints, exempt auth. Needs his ruling.

## Questions that will come up in R1
5. **No way to create a recruiter account.** Registration hardcodes `sales`; bootstrap makes
   one admin. S-05 onward is recruiter-facing. Resolving with a documented call (likely:
   admin can create users with roles). Confirm the intended onboarding flow.
6. **PII tagging approach (S-05).** How PII is flagged at the schema level feeds S-15
   compliance. Will propose and log; worth his eye since it's a compliance foundation.

## Process / scope
7. **"Runs in the deployed demo" clause.** Nothing deploys until S-20, so every story is
   "done" against the local stack, not the literal DoD. Reading it as local-now, deploy-later.
8. **Phase-gate dates contradict story dates.** Gate 1 dated Jul 21 but R1 runs to Jul 30;
   Gate 3 Aug 11 but R4 runs to Aug 21. Which is authoritative?
9. **Deploy credentials / hosting for talentsignal-demo.colaberry.dev** — who provisions it,
   and do I have access? Needed well before S-20.
