"""
Build a 6-panel visual overview of what the trained models predict on the
held-out test set.  Writes outputs/prediction_overview.png

    .venv/bin/python -m src.illustrate
"""
from __future__ import annotations

import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.metrics import roc_auc_score

from .data import build_dataset, patient_split
from .predict import load_models

OUT = "outputs"
C = {"triage": "#1f77b4", "full": "#d62728"}


def main():
    df = build_dataset()
    _, te = patient_split(df, test_size=0.2, seed=42)
    X = te.drop(columns=["mortality", "icu_los_days", "SUBJECT_ID", "HADM_ID"])
    M = load_models()

    y = te["mortality"].values
    pm = {r: M[("mortality", r)].predict_proba(X)[:, 1] for r in ("triage", "full")}

    los_mask = te["icu_los_days"].notna().values
    yl = te["icu_los_days"].values[los_mask]
    pl = {r: np.clip(M[("icu_los", r)].predict(X.iloc[los_mask]), 0, None)
          for r in ("triage", "full")}

    fig, ax = plt.subplots(2, 3, figsize=(17, 9.5))
    fig.suptitle("What the models predict on 11,796 held-out admissions",
                 fontsize=15, fontweight="bold")

    # --- (A) Risk: score separation, survivors vs deaths (full model) ---
    a = ax[0, 0]
    bins = np.linspace(0, 1, 26)
    a.hist(pm["full"][y == 0], bins=bins, density=True, alpha=.6,
           color="#2ca02c", label="survived")
    a.hist(pm["full"][y == 1], bins=bins, density=True, alpha=.6,
           color="#d62728", label="died")
    a.set(title="A. Risk score separates outcomes (full model)",
          xlabel="predicted death probability", ylabel="density")
    a.legend()

    # --- (B) Risk: calibration / reliability ---
    b = ax[0, 1]
    for r in ("triage", "full"):
        fpos, mpred = calibration_curve(y, pm[r], n_bins=10, strategy="quantile")
        b.plot(mpred, fpos, "o-", color=C[r],
               label=f"{r} (AUROC {roc_auc_score(y, pm[r]):.2f})")
    b.plot([0, .6], [0, .6], "--", color="grey")
    b.set(title="B. Calibration: predicted vs observed", xlabel="predicted prob",
          ylabel="observed mortality", xlim=(0, .6), ylim=(0, .6))
    b.legend()

    # --- (C) Risk tiers: observed mortality per tier ---
    c = ax[0, 2]
    edges, labels = [-.01, .05, .20, 1.01], ["Low\n<5%", "Med\n5-20%", "High\n>20%"]
    width = 0.38
    xpos = np.arange(3)
    for i, r in enumerate(("triage", "full")):
        tier = pd.cut(pm[r], edges, labels=["Low", "Med", "High"])
        obs = pd.Series(y).groupby(tier, observed=False).mean().reindex(["Low", "Med", "High"])
        cnt = pd.Series(y).groupby(tier, observed=False).size().reindex(["Low", "Med", "High"])
        bars = c.bar(xpos + (i - .5) * width, obs.values * 100, width,
                     color=C[r], label=r)
        for x, v, n in zip(xpos + (i - .5) * width, obs.values, cnt.values):
            c.text(x, v * 100 + 1, f"n={int(n)}", ha="center", fontsize=7.5)
    c.set(title="C. Observed mortality by risk tier", ylabel="observed mortality (%)",
          xticks=xpos)
    c.set_xticklabels(labels)
    c.legend()

    # --- (D) LOS: predicted vs actual (full model) ---
    d = ax[1, 0]
    cap = float(np.percentile(yl, 99))
    mk = (yl <= cap) & (pl["full"] <= cap)
    hb = d.hexbin(yl[mk], pl["full"][mk], gridsize=40, cmap="viridis", bins="log")
    d.plot([0, cap], [0, cap], "r--", lw=1.5)
    d.set(title="D. ICU LOS predicted vs actual (full)", xlabel="actual LOS (days)",
          ylabel="predicted LOS (days)", xlim=(0, cap), ylim=(0, cap))
    fig.colorbar(hb, ax=d, label="log(count)")

    # --- (E) LOS calibration by predicted decile (both regimes) ---
    e = ax[1, 1]
    for r in ("triage", "full"):
        dec = pd.qcut(pl[r], 10, duplicates="drop")
        g = pd.DataFrame({"pred": pl[r], "act": yl}).groupby(dec, observed=True).mean()
        e.plot(g["pred"], g["act"], "o-", color=C[r], label=r)
    lim = float(np.percentile(yl, 95))
    e.plot([0, lim], [0, lim], "--", color="grey")
    e.set(title="E. LOS calibration (mean pred vs mean actual / decile)",
          xlabel="mean predicted LOS (days)", ylabel="mean actual LOS (days)",
          xlim=(0, lim), ylim=(0, lim))
    e.legend()

    # --- (F) LOS error by true-LOS bucket ---
    f = ax[1, 2]
    buck = pd.cut(yl, [-.01, 2, 5, 10, 1e9], labels=["0-2d", "2-5d", "5-10d", "10d+"])
    xb = np.arange(4)
    for i, r in enumerate(("triage", "full")):
        mae = (pd.DataFrame({"b": buck, "ae": np.abs(yl - pl[r])})
               .groupby("b", observed=False)["ae"].mean()
               .reindex(["0-2d", "2-5d", "5-10d", "10d+"]))
        f.bar(xb + (i - .5) * width, mae.values, width, color=C[r], label=r)
    f.set(title="F. LOS error (MAE) by actual length of stay",
          ylabel="mean abs. error (days)", xticks=xb)
    f.set_xticklabels(["0-2d", "2-5d", "5-10d", "10d+"])
    f.legend()

    fig.tight_layout(rect=[0, 0, 1, 0.97])
    path = os.path.join(OUT, "prediction_overview.png")
    fig.savefig(path, dpi=120)
    print("wrote", path)


if __name__ == "__main__":
    main()
