# MIMIC-III risk & length-of-stay predictors

Two predictors built from four MIMIC-III tables (`ADMISSIONS`, `PATIENTS`,
`ICUSTAYS`, `DIAGNOSES_ICD`):

1. **Risk** — in-hospital mortality (binary classifier → Low / Medium / High risk tiers).
2. **Length of stay** — ICU length of stay in **days** (regression).

Each is trained under **two feature regimes** so you can see exactly how much
the diagnosis codes contribute:

| Regime | What it may use | Honest interpretation |
|---|---|---|
| **triage** | Only admission-time info: demographics, admission type/location, insurance, ED passage, first ICU care-unit, free-text admitting diagnosis. **No ICD-9 codes.** | A model you could actually run when the patient arrives. |
| **full** | triage **+** the coded ICD-9 diagnoses (multi-hot of top codes) + diagnosis count. | Retrospective / case-mix. ICD-9 codes are finalised at discharge, so this "sees the future" relative to admission. |

## Why this is set up so carefully (leakage)

The targets are outcomes known only at/after discharge, so it is very easy to
accidentally train on the answer. This project removes the traps explicitly:

- **Hard leakage dropped:** `DEATHTIME`, `DISCHTIME`, `DISCHARGE_LOCATION`
  (`= "DEAD/EXPIRED"` ⇒ mortality), `DOD`, `EXPIRE_FLAG`, the LOS target itself.
- **Patient-level split:** 16% of patients have multiple admissions, so the
  train/test split is by `SUBJECT_ID` (`GroupShuffleSplit`) — the same person
  never appears on both sides. The runner asserts disjointness.
- **No vocabulary leakage:** one-hot categories, TF-IDF terms and ICD-9 code
  vocabularies are all fit *inside* the pipeline on the training fold only.
- **Age de-obfuscation:** MIMIC shifts the DOB of patients >89 by ~300 years;
  these ages are capped to 90.
- **ICD-9 = retrospective by design:** the codes only enter the `full` regime,
  never `triage`, because they are not known at admission.

> Note: physiology (vitals/labs from `CHARTEVENTS`/`LABEVENTS`) is **not** in this
> dataset, so the risk model has no SOFA/APACHE-style severity signal. Expect
> solid-but-moderate discrimination, not state-of-the-art ICU mortality numbers.

## Layout

```
src/data.py       load + clean + cohort + targets + patient split
src/features.py   triage vs full feature pipelines (ColumnTransformer)
src/train.py      train + evaluate the 4 variants; writes outputs/
outputs/          metrics.json, *.joblib models, *.png plots
```

## Run

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m src.train          # ~a few minutes; writes outputs/
```

## Models

Gradient-boosted trees (`HistGradientBoostingClassifier` / `Regressor`).
Mortality uses `class_weight="balanced"` for the 9.9% prevalence; LOS is fit on
`log1p(days)` (via `TransformedTargetRegressor`) to handle the heavy right skew.

## Metrics reported

- **Risk:** AUROC, AUPRC (vs prevalence baseline), Brier score, risk-tier table
  (observed mortality per Low/Med/High bin), confusion matrix, PR + calibration plots.
- **LOS:** MAE / median-AE / RMSE / R² in days (vs median baseline), MAE by
  true-LOS bucket, predicted-vs-actual plot.

See `RESULTS.md` for the numbers from the latest run.
