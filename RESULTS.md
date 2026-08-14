# Results

Test set = 11,796 admissions / 9,304 patients, split **by patient** from the
58,976-admission cohort. All numbers are on that held-out test set.

## 1. Risk (in-hospital mortality)

Calibrated gradient-boosted trees. Probabilities are isotonic-calibrated, so the
risk tiers and Brier score are trustworthy (predicted ≈ observed in every bin).

| Regime | AUROC | AUPRC (base 0.099) | Brier (base 0.089) |
|---|---|---|---|
| **triage** (admission-time only) | **0.789** | 0.288 | 0.080 |
| **full** (+ retrospective ICD-9) | **0.923** | 0.644 | 0.054 |

**Risk tiers — observed mortality per predicted tier:**

| Tier (predicted prob) | triage | full |
|---|---|---|
| Low (<5%) | 1.8% (n=4,585) | 1.1% (n=7,695) |
| Medium (5–20%) | 10.5% (n=5,353) | 8.9% (n=2,219) |
| High (>20%) | 28.3% (n=1,858) | 47.0% (n=1,882) |

**Operating point** (threshold chosen on a patient-disjoint validation fold for ≥80% recall):

| Regime | Recall | Precision | Specificity |
|---|---|---|---|
| triage | 0.83 | 0.19 | 0.61 |
| full | 0.82 | 0.41 | 0.87 |

Read this as: to catch ~80% of in-hospital deaths, the *triage* model flags a lot
of false alarms (precision 19%); the *full* model is much sharper (precision 41%)
— but that extra power comes from the retrospective diagnosis codes (see §3).

## 2. Length of stay (ICU, days)

Regression on `log1p(days)`. Baseline = always predict the train median.

| Regime | MAE (base 3.89d) | Median AE | RMSE | R² overall | R² within 0–10d |
|---|---|---|---|---|---|
| **triage** | 3.70d | 1.37d | 9.63 | 0.06 | **−0.14** |
| **full** | **2.65d** | 0.99d | 6.26 | **0.60** | **−0.13** |

**MAE by true-LOS bucket (full model):** 0–2d → 0.95d · 2–5d → 1.28d · 5–10d →
3.38d · 10d+ → 13.0d.

⚠️ **Honest caveat:** the headline R²=0.60 (full) is driven almost entirely by the
long tail — the model separates short stays from very-long stays. *Within the
common 0–10 day window R² is negative*, i.e. it barely beats a constant there.
The full model's overall MAE (2.65d vs 3.89d baseline) is a real but modest gain;
the triage model is essentially uninformative for LOS and should not be presented
as actionable on its own.

## 3. triage vs full — the diagnosis codes

The whole point of training both regimes: the gap is the value of the ICD-9 codes.

- Mortality: AUROC **0.79 → 0.92**; LOS: R² **0.06 → 0.60**.
- Permutation importance attributes nearly all of it to `icd9_str` (mortality:
  0.289 vs next feature 0.018; LOS: 1.91 + `n_diagnoses` 0.72 vs age 0.15).

**But ICD-9 codes are finalised at discharge for billing**, so the `full` results
are a *retrospective / case-mix* upper bound, **not** a real-time triage capability.
For deployment-style claims, use the **triage** numbers. (A useful follow-up:
strip death-implying ICD-9 codes and re-measure, to bound how much of the
mortality lift is genuine vs near-tautological.)

## 4. What the adversarial audit changed

A 4-lens audit (leakage / methodology / bugs / results) flagged 19 candidates,
13 confirmed. The material fixes already applied:

1. **Calibration.** `class_weight="balanced"` had decalibrated the probabilities
   (Brier was *worse* than baseline; tiers over-predicted). Removed it and wrapped
   the classifier in `CalibratedClassifierCV` (isotonic). Brier now beats baseline.
2. **Leak removed.** `first_careunit` (assigned at ICU intake, and its presence
   signals an ICU stay occurred) was leaking into the triage regime — now gated to
   `full` only. Triage AUROC barely changed (0.794→0.789): the leak was small.
3. **Operating point.** Replaced the naive 0.5-threshold confusion matrix with a
   threshold picked on a patient-disjoint validation fold for a target recall.
4. **Bugs.** `_first_icu_stay` now takes one physical row (`drop_duplicates`) instead
   of `groupby().first()` (which stitches columns across stays); `_collapse_top`
   fills missing before collapsing so `MISSING` is its own category.
5. **Stratified LOS metric** added (within 0–10d), which is what surfaced the
   negative-R² caveat above.

## 5. Known limitations (by design / data)

- **No physiology.** `CHARTEVENTS`/`LABEVENTS` (vitals, labs) aren't in this folder,
  so there's no SOFA/APACHE-style severity signal — the ceiling for the triage risk
  model is inherently moderate.
- **Admission free-text** (`adm_diagnosis`) is treated as admission-time (per MIMIC
  provenance) and is the #2 triage feature; if you need a strictly-provable
  prospective bound, also try a triage variant without it.
- **`ed_los_hours`** uses ED-disposition time (slightly after the admission instant)
  — a minor look-ahead; `came_via_ed` is clean.
- **Early-stopping** inside the boosting uses a random (not patient-grouped) internal
  validation split; this affects only when training stops, not the clean test metrics.

## Artifacts

`outputs/metrics.json` (all numbers) · `mortality_{triage,full}.png` (PR +
calibration) · `icu_los_{triage,full}.png` (pred vs actual) · `*.joblib` (the
fitted, reusable pipelines).
