"""
Train + evaluate the four model variants:

    mortality x {triage, full}      -> binary classifier (risk)
    icu_los   x {triage, full}      -> regressor (days)

Run:  python -m src.train        (from the project root, inside the venv)

Writes models, metrics.json, importances and plots to ./outputs/.
"""
from __future__ import annotations

import json
import os
import warnings

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.compose import TransformedTargetRegressor
from sklearn.ensemble import (HistGradientBoostingClassifier,
                              HistGradientBoostingRegressor)
from sklearn.inspection import permutation_importance
from sklearn.metrics import (average_precision_score, brier_score_loss,
                             confusion_matrix, mean_absolute_error,
                             mean_squared_error, precision_recall_curve,
                             r2_score, roc_auc_score)
from sklearn.pipeline import Pipeline

from .data import build_dataset, patient_split
from .features import build_preprocessor, make_densifier

warnings.filterwarnings("ignore", category=UserWarning)

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "outputs")
os.makedirs(OUT, exist_ok=True)
SEED = 42

_DENSIFY = make_densifier()


# --------------------------------------------------------------------------- #
# Mortality (risk)                                                            #
# --------------------------------------------------------------------------- #
def train_mortality(tr: pd.DataFrame, te: pd.DataFrame, feature_set: str) -> dict:
    # No class_weight: it inflates predicted probabilities (decalibration). AUROC/
    # AUPRC are ranking metrics and unaffected; we instead CALIBRATE the output so
    # the probabilities and risk tiers are trustworthy.
    base = Pipeline([
        ("prep", build_preprocessor(feature_set)),
        ("dense", _DENSIFY),
        ("clf", HistGradientBoostingClassifier(
            max_iter=300, learning_rate=0.07, max_leaf_nodes=31,
            l2_regularization=1.0,
            early_stopping=True, validation_fraction=0.1, random_state=SEED)),
    ])
    clf = CalibratedClassifierCV(base, method="isotonic", cv=3)

    # Patient-grouped validation fold (from train only) to pick the operating
    # threshold without peeking at the test set.
    tr_fit, tr_val = patient_split(tr, test_size=0.15, seed=SEED)
    y_fit, y_val, y_te = tr_fit["mortality"].values, tr_val["mortality"].values, te["mortality"].values
    clf.fit(tr_fit, y_fit)
    p = clf.predict_proba(te)[:, 1]
    p_val = clf.predict_proba(tr_val)[:, 1]

    prevalence = float(y_te.mean())
    metrics = {
        "feature_set": feature_set,
        "n_train": int(len(tr_fit)), "n_val": int(len(tr_val)), "n_test": int(len(te)),
        "prevalence": round(prevalence, 4),
        "auroc": round(roc_auc_score(y_te, p), 4),
        "auprc": round(average_precision_score(y_te, p), 4),
        "auprc_baseline": round(prevalence, 4),
        "brier": round(brier_score_loss(y_te, p), 4),
        "brier_baseline_prevalence": round(prevalence * (1 - prevalence), 4),
    }
    # Risk tiers + observed mortality per tier (calibrated probs -> tiers are meaningful).
    tiers = pd.cut(p, [-0.01, 0.05, 0.20, 1.01], labels=["Low", "Medium", "High"])
    tier_tbl = (pd.DataFrame({"tier": tiers, "y": y_te})
                .groupby("tier", observed=False)
                .agg(n=("y", "size"), observed_mortality=("y", "mean")).round(4))
    metrics["risk_tiers"] = json.loads(tier_tbl.reset_index().to_json(orient="records"))

    # Operating point: smallest threshold on the validation fold reaching recall>=0.80.
    thr = _threshold_for_recall(y_val, p_val, target_recall=0.80)
    yhat = (p >= thr).astype(int)
    cm = confusion_matrix(y_te, yhat).ravel()  # tn, fp, fn, tp
    tn, fp, fn, tp = (int(x) for x in cm)
    metrics["operating_point"] = {
        "threshold": round(float(thr), 4),
        "tn_fp_fn_tp": [tn, fp, fn, tp],
        "recall": round(tp / (tp + fn + 1e-9), 3),
        "precision": round(tp / (tp + fp + 1e-9), 3),
        "specificity": round(tn / (tn + fp + 1e-9), 3),
    }
    # Calibration curve points (so quality is auditable from metrics.json, not just the plot).
    frac_pos, mean_pred = calibration_curve(y_te, p, n_bins=10, strategy="quantile")
    metrics["calibration_curve"] = {
        "mean_predicted": [round(float(x), 4) for x in mean_pred],
        "observed_freq": [round(float(x), 4) for x in frac_pos],
    }

    _plot_mortality(y_te, p, feature_set)
    metrics["top_features"] = _perm_importance(clf, te, y_te, "roc_auc")
    joblib.dump(clf, os.path.join(OUT, f"mortality_{feature_set}.joblib"))
    return metrics


def _threshold_for_recall(y, p, target_recall=0.80):
    """Smallest probability threshold whose recall >= target (max precision at that recall)."""
    prec, rec, thr = precision_recall_curve(y, p)
    # thr has len-1 vs prec/rec; align to the points that have a threshold.
    ok = np.where(rec[:-1] >= target_recall)[0]
    if len(ok) == 0:
        return 0.5
    return float(thr[ok[-1]])  # highest threshold (=> highest precision) still meeting recall


# --------------------------------------------------------------------------- #
# ICU length of stay                                                          #
# --------------------------------------------------------------------------- #
def train_los(tr: pd.DataFrame, te: pd.DataFrame, feature_set: str) -> dict:
    tr = tr.dropna(subset=["icu_los_days"])
    te = te.dropna(subset=["icu_los_days"])
    reg = TransformedTargetRegressor(
        regressor=HistGradientBoostingRegressor(
            max_iter=400, learning_rate=0.06, max_leaf_nodes=31,
            l2_regularization=1.0, early_stopping=True,
            validation_fraction=0.1, random_state=SEED),
        func=np.log1p, inverse_func=np.expm1)
    pipe = Pipeline([
        ("prep", build_preprocessor(feature_set)),
        ("dense", _DENSIFY),
        ("reg", reg),
    ])
    y_tr, y_te = tr["icu_los_days"].values, te["icu_los_days"].values
    pipe.fit(tr, y_tr)
    pred = np.clip(pipe.predict(te), 0, None)

    # Baseline: always predict the train median.
    base = np.full_like(y_te, np.median(y_tr), dtype=float)
    metrics = {
        "feature_set": feature_set,
        "n_train": int(len(tr)), "n_test": int(len(te)),
        "mae_days": round(mean_absolute_error(y_te, pred), 3),
        "median_ae_days": round(float(np.median(np.abs(y_te - pred))), 3),
        "rmse_days": round(float(np.sqrt(mean_squared_error(y_te, pred))), 3),
        "r2": round(r2_score(y_te, pred), 4),
        "mae_baseline_median": round(mean_absolute_error(y_te, base), 3),
    }
    # Error by true-LOS bucket.
    buck = pd.cut(y_te, [-0.01, 2, 5, 10, 1e9], labels=["0-2d", "2-5d", "5-10d", "10d+"])
    err = (pd.DataFrame({"b": buck, "ae": np.abs(y_te - pred)})
           .groupby("b", observed=False).agg(n=("ae", "size"), mae=("ae", "mean")).round(3))
    metrics["mae_by_bucket"] = json.loads(err.reset_index().to_json(orient="records"))

    # Operationally-relevant range (most ICU stays are <=10d; the tail dominates RMSE/R2).
    m10 = y_te <= 10
    metrics["within_0_10d"] = {
        "n": int(m10.sum()),
        "mae_days": round(mean_absolute_error(y_te[m10], pred[m10]), 3),
        "r2": round(r2_score(y_te[m10], pred[m10]), 4),
    }

    _plot_los(y_te, pred, feature_set)
    imp = _perm_importance(pipe, te, y_te, "neg_mean_absolute_error")
    metrics["top_features"] = imp
    joblib.dump(pipe, os.path.join(OUT, f"icu_los_{feature_set}.joblib"))
    return metrics


# --------------------------------------------------------------------------- #
# Shared helpers                                                              #
# --------------------------------------------------------------------------- #
def _perm_importance(pipe, te, y, scoring, top=12):
    """Permutation importance at the *raw feature* level (only ~16 columns)."""
    X = te.drop(columns=["mortality", "icu_los_days", "SUBJECT_ID", "HADM_ID"])
    r = permutation_importance(pipe, X, y, scoring=scoring, n_repeats=4,
                               random_state=SEED, n_jobs=1)
    order = np.argsort(r.importances_mean)[::-1][:top]
    return [{"feature": X.columns[i], "importance": round(float(r.importances_mean[i]), 4)}
            for i in order]


def _plot_mortality(y, p, fs):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from sklearn.calibration import calibration_curve
    from sklearn.metrics import precision_recall_curve
    fig, ax = plt.subplots(1, 2, figsize=(11, 4.2))
    prec, rec, _ = precision_recall_curve(y, p)
    ax[0].plot(rec, prec); ax[0].axhline(y.mean(), ls="--", c="grey")
    ax[0].set(xlabel="Recall", ylabel="Precision", title=f"PR curve ({fs})")
    frac_pos, mean_pred = calibration_curve(y, p, n_bins=10, strategy="quantile")
    ax[1].plot(mean_pred, frac_pos, "o-"); ax[1].plot([0, 1], [0, 1], ls="--", c="grey")
    ax[1].set(xlabel="Predicted prob.", ylabel="Observed freq.", title="Calibration")
    fig.tight_layout(); fig.savefig(os.path.join(OUT, f"mortality_{fs}.png"), dpi=110)
    plt.close(fig)


def _plot_los(y, pred, fs):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(5.2, 5))
    m = min(len(y), 4000)
    idx = np.random.RandomState(SEED).choice(len(y), m, replace=False)
    ax.scatter(y[idx], pred[idx], s=6, alpha=0.25)
    lim = np.percentile(y, 99)
    ax.plot([0, lim], [0, lim], c="red", ls="--")
    ax.set(xlim=(0, lim), ylim=(0, lim), xlabel="Actual ICU LOS (days)",
           ylabel="Predicted", title=f"ICU LOS pred vs actual ({fs})")
    fig.tight_layout(); fig.savefig(os.path.join(OUT, f"icu_los_{fs}.png"), dpi=110)
    plt.close(fig)


def main():
    print("Building dataset ...")
    df = build_dataset()
    tr, te = patient_split(df, test_size=0.2, seed=SEED)
    assert set(tr["SUBJECT_ID"]).isdisjoint(set(te["SUBJECT_ID"])), "patient leak!"
    print(f"  rows={len(df)}  train={len(tr)}  test={len(te)}  "
          f"(patients tr={tr.SUBJECT_ID.nunique()} te={te.SUBJECT_ID.nunique()})")

    results = {"mortality": {}, "icu_los": {}}
    for fs in ("triage", "full"):
        print(f"[mortality/{fs}] training ...")
        results["mortality"][fs] = train_mortality(tr, te, fs)
        print("   ", {k: results["mortality"][fs][k] for k in ("auroc", "auprc")})
        print(f"[icu_los/{fs}] training ...")
        results["icu_los"][fs] = train_los(tr, te, fs)
        print("   ", {k: results["icu_los"][fs][k] for k in ("mae_days", "r2")})

    with open(os.path.join(OUT, "metrics.json"), "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nWrote {os.path.join(OUT, 'metrics.json')} and plots/models to {OUT}")
    return results


if __name__ == "__main__":
    main()
