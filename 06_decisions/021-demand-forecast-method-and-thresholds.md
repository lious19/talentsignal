# 021 — Demand forecast method, confidence interval, and outlier threshold (S-13)

**Date:** 2026-08-06
**Story:** S-13
**Requirement:** REQ-007
**Decided by:** Megan — PROPOSED, pending Ali's approval, same framing as decisions 007 and
020: these are business/statistical judgment calls the spec explicitly leaves open
("a judgment call — propose, log"), not something to invent silently per CLAUDE.md rule 4.

## The question

S-13 needs four things nobody specified: which historical series counts as "demand," what
forecasting method to run over it, how wide the confidence band should be, and how far from
trend counts as an outlier. All four are logged together here, the same way decision 007
bundled every `confidenceConfig.ts` constant into one entry rather than one per constant.

## What "historical demand" means

**Chosen:** the exact same series decision 020 already defined as "placements per month" —
every `sales_pipeline_audit` row where `to_stage = 'closed'`, grouped by the calendar month
of `changed_at`. No new definition of demand is introduced.

**Why:** S-13's forecast chart sits next to S-12's KPI bar chart on the same dashboard.
Reusing the identical series is what makes the two charts visually comparable, and it costs
nothing — the query already exists and is already trusted (it's covered by
`analytics.pii.integration.test.ts`'s aggregate-only guarantee).

**What would make this wrong:** if Ali wants the forecast to run over a different notion of
demand (e.g. `opportunities` volume, or a client-weighted count), this is a different query
against different tables, not a tweak to this one — and it would also imply decision 020's
"placements per month" isn't the right demand signal, which is a bigger conversation.

## Forecast method

**Chosen: ordinary least-squares linear regression** over the monthly series (x = month
index 0..n-1, y = count), extended forward for the forecast horizon.

### Options considered
1. **Simple moving average** — forecast = average of the last N months, held flat going
   forward.
2. **Simple exponential smoothing (SES)** — a weighted average favoring recent months, also
   flat going forward (no trend term without moving to double/Holt smoothing).
3. **OLS linear trend** — fit a straight line through history, extend it.

### What we chose, and why
Option 3. This is a capacity-planning forecast — the whole point is to show whether demand
is trending up or down, which options 1 and 2 cannot do; both degenerate to a flat
continuation of wherever history currently sits. A trend line is also the simplest method
that produces real residuals for free, which the confidence band and outlier flag both need
anyway — one fit, three outputs (forecast, band, outliers), instead of a separate mechanism
for each.

Config lives in `backend/src/scoring/forecastConfig.ts`, marked PROPOSED, same one-object
discipline as `confidenceConfig.ts`:
```ts
export const FORECAST_CONFIG = {
  version: "forecast-021-v1",
  method: "linear-trend" as const,
  horizonMonths: 3,
  bandWidthStdDevs: 2,
  outlierStdDevs: 2,
  minHistoryMonths: 3,
};
```

### What this rests on
That agency demand grows or shrinks roughly linearly over the few months this forecast
looks ahead — a reasonable assumption at this scale, not a claim about long-run behavior.

### What would make this wrong
If demand is actually seasonal (e.g. hiring surges every January) or has an obvious
non-linear shape once real data accumulates, a straight line will systematically mispredict
in a visible, checkable way — that observation is exactly what should trigger swapping in a
stronger model behind this same boundary, per the story's own trust primer.

## Confidence interval — the formula and the constant

```
fitted_i    = m * x_i + b                        (OLS fit over all historical points)
residual_i  = actual_i - fitted_i
residualStd = sqrt( Σ residual_i² / (n - 2) )    (n-2: two fitted parameters, slope + intercept)
predicted_f = m * x_f + b                        (x_f = a future month index)
band        = predicted_f ± FORECAST_CONFIG.bandWidthStdDevs * residualStd
```

**Chosen constant: `bandWidthStdDevs = 2`** (~95% coverage under a normal-residuals
assumption). Chosen over the more precise 1.96 because a round, easy-to-defend number was
explicitly asked for over false precision.

**Named simplification — stated honestly, not glossed over:** this is a **constant-width**
band, not a textbook OLS prediction interval, which widens the further a forecast month
sits from the mean of the historical x-values. A true prediction interval is more
statistically correct but adds a second formula and a second thing to defend in class for a
story whose explicit brief is "keep it simple." The band shown here is still honest — it
comes directly from how much history actually varied, not an invented number — it just
doesn't grow with forecast distance the way a more rigorous interval would.

### What this rests on
That residuals are roughly symmetric and not wildly non-normal at the sample sizes this app
will actually have (a handful of months). With very few historical points, "95%" is a loose
label, not a precise guarantee — flagged here rather than asserted as exact.

### What would make this wrong
If the historical series is long enough that the flat-vs-widening distinction becomes
visibly wrong in the deployed demo (predictions many months out looking falsely as
confident as next month's), that's the trigger to move to a real widening prediction
interval — an additive change to `demandForecast.ts`, not a redesign.

## Outlier threshold

**Chosen: `outlierStdDevs = 2`** — a historical month is flagged `isOutlier: true` when
`|residual_i| > FORECAST_CONFIG.outlierStdDevs * residualStd`. Deliberately **the same
constant** as the band width, not a separate one — one number doing two jobs, logged here as
a simplicity trade-off. A future refinement could split them (e.g. a stricter 3σ outlier
threshold against a looser 2σ band) if that turns out to matter; not needed to ship this
story.

**Outliers stay in the OLS fit.** There is no second pass that removes or re-weights them —
the line is fit once, over every historical point, outliers included. This is what "flagged,
not smoothed" means concretely: an outlier's real value is never altered, replaced with the
fitted value, or dropped from the trend calculation; it comes back from `demandForecast.ts`
exactly as recorded, with an extra `isOutlier: true` field attached.

**Honest consequence, stated plainly:** because the outlier stays in the fit, it *does* pull
the slope a little — that is what least-squares does with any included point, by
construction. This was almost asserted the other way in an early draft of this story's test
plan ("slope stays close to the non-outlier points") and caught as a contradiction: a design
that keeps outliers in the fit cannot also claim the fit ignores them. The trustworthy,
checkable claim instead is that an outlier **widens the band** — a noisier history should
produce a wider, less-confident interval, and that widening is the actual mechanism by which
"flagged, not smoothed" becomes visible and testable, not a slope-stability claim this design
doesn't support.

### What this rests on
That showing the true (pulled) trend plus a wider band is more honest to a viewer than
hiding the outlier's influence via robust regression would be. Robust regression (excluding
outliers from the fit entirely) was considered and rejected for this reason and for
simplicity — noted here as a future option, not built now.

### What would make this wrong
If Ali or a future reviewer decides a forecast should be robust to one-off historical spikes
(e.g. a one-time data migration artifact shouldn't drag the trend), that's a real case for
excluding flagged outliers from the fit — a defensible design change, but a different one
than what's built here, and it should be a deliberate choice, not a silent one.
