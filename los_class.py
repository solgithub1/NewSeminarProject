"""
ICU length-of-stay as a 3-class problem: short (<=2d) / medium (2-7d) / long (>7d).

This is the honest, actionable framing: the regressor's exact-day output is noisy
(ICU LOS is mostly determined by post-admission events), but the *category* is
predictable and is what capacity planning actually needs.

    .venv/bin/python -m src.los_class
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import (balanced_accuracy_score, classification_report,
                             confusion_matrix)
from sklearn.pipeline import Pipeline

from .data import build_dataset, patient_split
from .features import build_preprocessor, make_densifier

BINS = [-0.01, 2, 7, 1e9]
LABELS = ["short (<=2d)", "medium (2-7d)", "long (>7d)"]


def _bucket(days):
    return pd.cut(days, BINS, labels=LABELS)


def run(feature_set="full"):
    df = build_dataset().dropna(subset=["icu_los_days"])
    tr, te = patient_split(df, test_size=0.2, seed=42)
    y_tr = _bucket(tr["icu_los_days"].values)
    y_te = _bucket(te["icu_los_days"].values)

    pipe = Pipeline([
        ("prep", build_preprocessor(feature_set)),
        ("dense", make_densifier()),
        ("clf", HistGradientBoostingClassifier(
            max_iter=300, learning_rate=0.07, max_leaf_nodes=31,
            l2_regularization=1.0, class_weight="balanced",
            early_stopping=True, random_state=42)),
    ])
    pipe.fit(tr, y_tr)
    pred = pipe.predict(te)

    acc = (pred == y_te).mean()
    print(f"\n========== ICU-LOS buckets — {feature_set} model (test n={len(te)}) ==========")
    print(f"accuracy {acc:.3f}   balanced-accuracy {balanced_accuracy_score(y_te, pred):.3f}")
    print("\nper-class precision / recall:")
    print(classification_report(y_te, pred, labels=LABELS, digits=3, zero_division=0))

    cm = confusion_matrix(y_te, pred, labels=LABELS)
    cmp = (cm / cm.sum(1, keepdims=True) * 100).round(1)
    print("confusion matrix (rows=ACTUAL, cols=PREDICTED, % of each actual row):")
    print(pd.DataFrame(cmp, index=[f"actual {l}" for l in LABELS],
                       columns=[f"pred {l}" for l in LABELS]).to_string())
    return pipe


if __name__ == "__main__":
    run("full")
    run("triage")
