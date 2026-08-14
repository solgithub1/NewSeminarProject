"""
Score admissions with the trained models.

The saved *.joblib files are full pipelines: they take the engineered admission
row (the columns produced by data.build_dataset) and handle all preprocessing
internally. So scoring a new admission is just: build the row -> model.predict.

Usage
-----
    # demo: score a few held-out patients and compare to their real outcome
    .venv/bin/python -m src.predict

    # score specific HADM_IDs
    .venv/bin/python -m src.predict 165315 152223
"""
from __future__ import annotations

import sys
import joblib
import numpy as np
import pandas as pd

from .data import build_dataset, patient_split

OUT = "outputs"
FEATURE_DROP = ["mortality", "icu_los_days", "SUBJECT_ID", "HADM_ID"]


def _risk_tier(p: float) -> str:
    return "Low" if p < 0.05 else ("Medium" if p < 0.20 else "High")


def load_models() -> dict:
    return {
        ("mortality", "triage"): joblib.load(f"{OUT}/mortality_triage.joblib"),
        ("mortality", "full"):   joblib.load(f"{OUT}/mortality_full.joblib"),
        ("icu_los", "triage"):   joblib.load(f"{OUT}/icu_los_triage.joblib"),
        ("icu_los", "full"):     joblib.load(f"{OUT}/icu_los_full.joblib"),
    }


def score(rows: pd.DataFrame, models: dict | None = None) -> pd.DataFrame:
    """Return predictions for each admission row (one row per HADM_ID)."""
    models = models or load_models()
    X = rows.drop(columns=[c for c in FEATURE_DROP if c in rows.columns])
    out = pd.DataFrame({"HADM_ID": rows["HADM_ID"].values})
    for regime in ("triage", "full"):
        p = models[("mortality", regime)].predict_proba(X)[:, 1]
        out[f"death_prob_{regime}"] = p.round(3)
        out[f"risk_{regime}"] = [_risk_tier(v) for v in p]
        out[f"icu_los_pred_{regime}"] = np.clip(
            models[("icu_los", regime)].predict(X), 0, None).round(2)
    return out


def _demo(hadm_ids: list[int] | None):
    df = build_dataset()
    if hadm_ids:
        sample = df[df["HADM_ID"].isin(hadm_ids)].copy()
    else:
        # pick held-out test patients: a couple who died, a couple who survived
        _, te = patient_split(df, test_size=0.2, seed=42)
        te = te.dropna(subset=["icu_los_days"])
        died = te[te["mortality"] == 1].head(2)
        lived = te[te["mortality"] == 0].head(2)
        sample = pd.concat([died, lived])

    preds = score(sample)
    merged = sample[["HADM_ID", "age", "admission_type", "adm_diagnosis",
                     "mortality", "icu_los_days"]].merge(preds, on="HADM_ID")

    for _, r in merged.iterrows():
        print("=" * 72)
        print(f"HADM {int(r.HADM_ID)} | age {int(r.age)} | {r.admission_type} | "
              f"\"{r.adm_diagnosis[:48]}\"")
        print(f"  ACTUAL    : died={int(r.mortality)}   ICU LOS={r.icu_los_days:.2f}d")
        print(f"  RISK      : triage {r.death_prob_triage:.0%} ({r.risk_triage})"
              f"   |  full {r.death_prob_full:.0%} ({r.risk_full})")
        print(f"  ICU LOS   : triage {r.icu_los_pred_triage:.1f}d"
              f"   |  full {r.icu_los_pred_full:.1f}d")


if __name__ == "__main__":
    ids = [int(a) for a in sys.argv[1:]] or None
    _demo(ids)
