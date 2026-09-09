**S-23 — Measured role-family scarcity shipped ✅**

**What's being done:** `roleScarcity` (0.60 of the hard-to-fill score) no longer relies
solely on decision 026's curated keyword list. Free-text titles now classify into role
families, and each family's real median `days_open` on Greenhouse is measured against
the dataset's global median — a family running ~2x the median scores as objectively
scarce. The curated list stays as fallback where a family lacks enough observations,
and every score names which basis — measured or curated — actually produced it.

**Real numbers** (one live scoring run, 995 real opportunities — 232 Greenhouse/GitLab,
763 Lever/gopuff):

| basis | count |
|---|---|
| measured | 139 |
| curated | 8 |
| none (in scope, no match) | 87 |
| source-excluded (Lever) | 761 |

| family | Greenhouse count | measured? |
|---|---|---|
| engineering-swe | 56 | yes |
| ml-ai | 10 | yes (exactly at threshold) |
| support-cs | 35 | yes |
| sales-bizdev | 38 | yes |
| security | 9 | no — 1 short |
| cloud-infra | 4 | no |
| data-analytics | 0 (3 real rows, all Lever) | no |
| retail-ops | 0 (530 real rows, all Lever) | no, structurally |

**Trust guarantees:**
- Ticket asked for "days-to-close"; that field doesn't exist in this schema. Built on
  `days_open` instead (an honest, survivorship-biased proxy), named as such everywhere.
- Lever is excluded from every median computation, deliberately. Its real median
  (~1,169d vs. Greenhouse's ~33d) looks like a field-semantics problem with `createdAt`,
  not real scarcity — flagged for S-24, not assumed fixed.
- The `family_key` backfill does **not** rescore existing opportunities. Old rows keep
  their v1 score; only new scoring runs produce `hard-to-fill-026-v2` results.

**Named limits, not hidden:**
- `ml-ai` sits at exactly n=10 — one atypical row moves its median materially.
- `security` is at n=9, one real posting from flipping into measured.
- "Senior Product Designer, AI" classifies as `ml-ai` via the bare "ai" token — a real
  false positive, kept as-is; validating basis accuracy is S-25's job, not this story's.
- `general-other` (leadership/management titles) is excluded from measurement outright —
  a blended median across it would be worse than not measuring it.

**Links:** [decision 046](../06_decisions/046-role-family-scarcity.md) ·
[artifact](https://claude.ai/code/artifact/cb64f2c4-3b85-45b4-b3eb-464aaf818fca) ·
[exploration](./S-23-exploration.md)

**Next:** S-24 — H-1B LCA + federal awards, due Sep 16.
