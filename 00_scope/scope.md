# TalentSignal Revenue Engine — Scope (captured from Basecamp 2026-07-22)

Source: https://app.basecamp.com/3945211/buckets/24865175/todolists/10116038052
Author of spec: Ali Muwwakkil (Jul 21) · Builder: Megan · Approver: Ali (3 phase gates)

## What it is
A cloud web application for **staffing agencies**. It detects latent/hidden demand for
talent from market signals *before a client asks*, scores the opportunity, ranks best-fit
candidates with a rationale, forecasts upcoming demand, surfaces warm relationships for
intros, and drafts opportunity packages — **which a human must explicitly release**.

**This is not a data-analysis project. It is a full-stack product build.**

## Stack (fixed, not negotiable)
React front end · Node/Express REST API · PostgreSQL (system of record) · Docker Compose ·
GitHub Actions CI · deployed to https://talentsignal-demo.colaberry.dev
Secrets from environment only. External data providers **mocked behind adapter seams**.
Heavy ML sits behind service boundaries — **ship a transparent heuristic now**, swap a
trained model in later without touching callers.

## The rule that overrides everything
> The AI drafts and suggests; a human reviews and releases anything that would leave the
> platform or write to a client CRM. **Enforced in code (REQ-020), not by convention.**

## Trust Before Intelligence (TBI) — 7 rules, every story carries a trust scenario
1. Human in the loop on anything outbound (REQ-020, S-09).
2. Show confidence + source. No black-box assertions (S-03, S-04, S-06, S-13).
3. Append-only audit — enforced by DB constraint, not app code (S-15).
4. Least privilege — every route checks session, role, resource ownership; the
   unauthorized path is **tested**, not assumed (S-14).
5. Idempotent and reversible writes, especially CRM-bound (S-16).
6. Uncertainty shown, not hidden — forecasts ship with intervals (S-13, S-17).
7. Privacy by construction — PII tagged from the first migration (S-05, S-15).

## Requirement catalog
| ID | Pri | Requirement |
|---|---|---|
| REQ-001 | must | Hidden Demand Analysis — latent needs from market signals + confidence score |
| REQ-002 | must | Client Matchmaking — ranked, explained candidate list for a job |
| REQ-003 | must | Opportunity Scoring — 0..1 from transparent factors |
| REQ-004 | must | Sales Pipeline Management — stages in real time |
| REQ-005 | must | Automated Opportunity Package Generation — AI drafts, human releases |
| REQ-006 | should | Warm Relationship Identification |
| REQ-007 | should | Predictive Analysis — demand forecast with confidence interval |
| REQ-008 | should | Recommendation Engine — rationale + feedback loop |
| REQ-009 | must | Reporting & Analytics — KPI dashboard (placements/month, time-to-hire) |
| REQ-010 | must | User Authentication — register/login, JWT, MFA-ready |
| REQ-011 | must | RBAC — admin, sales, recruiter, per route and resource |
| REQ-012 | must | Data Privacy — GDPR/CCPA, consent, encryption, access/erasure |
| REQ-013 | must | Audit Trail — append-only |
| REQ-014 | should | CRM Pollution Prevention — dedupe, guard writes, rollback |
| REQ-015 | could | Client Segmentation & Targeting |
| REQ-016 | could | Predictive Revenue Outcome Analysis — anomaly detection + alerting |
| REQ-017 | must | Performance — p95 <200ms normal / <500ms peak; 1000 concurrent target |
| REQ-018 | must | Deployment — Docker, GitHub Actions CI, public demo URL |
| REQ-019 | must | Data Ingestion — job-board/market signals via mocked provider adapters |
| REQ-020 | must | Human-in-the-loop control |

Other NFRs: hidden-demand accuracy ≥70%. Every outbound HTTP/DB/queue call has an
explicit timeout. Structured JSON logs with correlation ids.

## Data model (Ch7)
- `Users` (user_id, email, password_hash, role[admin|sales|recruiter], timestamps)
- `Clients` (client_id, name, contact_info JSONB, timestamps)
- `Candidates` (candidate_id, name, skills TEXT[], experience, availability, timestamps)
- `Job_Openings` (job_id, client_id FK, title, description, requirements TEXT[], timestamps)
- `Sales_Pipeline` (pipeline_id, client_id FK, status[prospecting|contacted|negotiation|closed], timestamps)
- `Analytics` (analytics_id, client_id FK, date, demand_score, placement_rate)
- Added by this build: `Opportunities`, `AuditLog` (append-only), `PackageDraft`,
  `PrivacyRequest`, relationship edges.

## Bounded contexts → owner agents
| Agent | Owns |
|---|---|
| PlatformAgent | REQ-017, REQ-018 — repo, Docker, migrations, CI, deploy, observability |
| IdentityAgent | REQ-010, REQ-011 — auth, RBAC |
| SignalAgent | REQ-019, REQ-001 — ingestion, hidden-demand |
| MatchAgent | REQ-002, REQ-008 — clients, candidates, matching, recommendations |
| ScoringAgent | REQ-003, REQ-007, REQ-016, REQ-015 — scoring, forecast, anomaly, segmentation |
| PipelineAgent | REQ-004, REQ-006 — pipeline, warm relationships |
| PackageAgent | REQ-005, REQ-020 — drafted packages under human release |
| InsightAgent | REQ-009 — reporting KPIs |
| ComplianceAgent | REQ-012, REQ-013, REQ-014 — privacy, audit, CRM guard |

Request path: React → Express (auth + RBAC middleware, correlation id, JSON logging) →
domain service → PostgreSQL. Every client-affecting mutation passes the human-release
boundary and the audit log.

## Release / story schedule (20 stories + 3 gates)

### R0 — Walking skeleton
| Story | Agent | Due | Status |
|---|---|---|---|
| S-01 Walking-skeleton monorepo on Docker Compose | PlatformAgent | Tue Jul 21 | **OVERDUE** |
| S-02 Secure authentication (register/login, JWT) | IdentityAgent | Wed Jul 22 | **DUE TODAY** |
| S-03 First vertical slice: one signal → one opportunity | SignalAgent | Thu Jul 23 | |

### R1 — Core intelligence surfaces
| S-04 Hidden Demand Analysis service | SignalAgent | Mon Jul 27 |
| S-05 Clients & candidates: data model + management | MatchAgent | Tue Jul 28 |
| S-06 Client Matchmaking (ranked candidates for a job) | MatchAgent | Wed Jul 29 |
| S-07 Opportunity Scoring System | ScoringAgent | Thu Jul 30 |

### R2 — Pipeline and human-in-the-loop
| S-08 Sales Pipeline Management | PipelineAgent | Fri Jul 31 |
| S-09 AI-drafted opportunity packages under human release | PackageAgent | Tue Aug 4 |
| S-10 Warm Relationship Identification | PipelineAgent | Wed Aug 5 |
| S-11 Recommendation Engine with feedback loop | MatchAgent | Thu Aug 6 |

### R3 — Analytics, trust and compliance
| 🧑 S-12 Reporting and Analytics dashboard | InsightAgent | Fri Aug 7 |
| S-13 Predictive Analysis (demand forecast) | ScoringAgent | Tue Aug 11 |
| S-14 Role-Based Access Control | IdentityAgent | Wed Aug 12 |
| 🧑 S-15 Data Privacy Compliance and Audit Trail | ComplianceAgent | Thu Aug 13 |
| S-16 CRM Pollution Prevention | ComplianceAgent | Fri Aug 14 |
| S-17 Revenue anomaly detection + client segmentation | ScoringAgent | Mon Aug 17 |

### R4 — Launch readiness
| S-18 Performance and load validation | PlatformAgent | Wed Aug 19 |
| S-19 End-to-end tests, seed data, and CI | PlatformAgent | Thu Aug 20 |
| 🧑 S-20 Deploy to public demo URL with onboarding docs | PlatformAgent | Fri Aug 21 |

### Milestone approvals — Ali
- Phase 1 (R0 + R1): Tue Jul 21
- Phase 2 (R2 + R3): Fri Jul 31
- Phase 3 (R4): Tue Aug 11

⚠️ **The gate dates do not line up with the story dates.** Phase 1 gate is dated Jul 21
but R1 stories run to Jul 30. Phase 2 gate is Jul 31 but R3 runs to Aug 17. Phase 3 gate
is Aug 11 but R4 runs to Aug 21. **Ask Ali to confirm the gate dates.**

## Definition of done (every story)
Acceptance scenarios pass **including the trust scenario** · tests cover happy + failure
+ idempotency · tsc/lint clean · no secrets in repo · **feature runs in the deployed demo**.

## Open questions for Ali
1. Gate dates conflict with story dates (above) — which is authoritative?
2. Who owns/provisions the `colaberry.dev` domain and hosting? Do I have deploy credentials?
3. TypeScript or JavaScript? ("tsc clean" in the DoD implies TypeScript — confirm.)
4. REQ-017: is 1000 concurrent users to be *demonstrated under load test*, or estimated?
5. REQ-012 GDPR/CCPA: scope is compliance-*shaped features*, not a legal certification —
   confirm that's the expectation.
6. Are the per-story Gherkin acceptance criteria in each Basecamp to-do? (List view didn't
   show them — need to open each to-do individually.)
