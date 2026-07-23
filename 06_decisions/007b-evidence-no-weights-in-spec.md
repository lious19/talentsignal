# 007b — Evidence: the confidence-score weights are not specified anywhere in the spec
**Date:** 2026-07-22 · **Supports:** decision 007 (confidence-score factors, PROPOSED)

## Why this exists
Before proposing my own scoring weights, I needed to confirm the spec truly doesn't
provide them — so I could show Ali evidence rather than just assert it. I searched every
project document and the canonical source.

## What I searched
- All six project documents (Docs Index, Requirements, Architecture, Trust Primer, Build
  Guide walkthrough, Traceability Matrix) — read in full.
- All 20 story to-dos on Basecamp.
- The canonical **source Build Guide v1** (160 KB, 11 chapters) — the document every other
  doc is derived from.

## What I found
1. **The word "weight" appears ZERO times** in the entire 160 KB source Build Guide.
2. The "Key Factors Contributing to Hidden Demand" section lists *business-problem* factors
   (lack of communication, market dynamics, data silos, inefficient processes) — not
   scoring inputs with values.
3. Every concrete number in the document is an **example API response** showing the JSON
   shape, e.g. `{ "company": "XYZ Inc", "confidence_score": 0.85 }`. None is a defined weight.
4. The scoring sections describe **ML methodology** for the *eventual* model — time series
   (Pandas/Statsmodels), MAPE/RMSE, precision/recall/F1 — not the heuristic to ship now.
5. The derived Requirements doc states REQ-003 as "score each detected opportunity 0..1
   from **transparent factors**" — it names the property (transparent, bounded 0..1) but
   never the factors or their weights.

## Conclusion
The heuristic's factors and weights are a **genuine gap** in the spec, not an oversight I
can look up. The Build Guide defines what the eventual ML model should achieve and what
properties the score must have (bounded, transparent, explainable), but the concrete
heuristic — which the build notes explicitly ask to ship *before* any ML — has to be
authored by someone. There is no source to copy from.

## What this means for the decision
This makes decision 007 the only way forward, not an overreach: someone must author these
numbers, and the spec's own rule is "heuristic first, transparent, swappable." So I
proposed a transparent starting point, put every constant in one config object, and marked
it PROPOSED. Ali's choice is simply: author his own weights, or approve/adjust mine. Either
way is a one-line change to `confidenceConfig.ts`.
