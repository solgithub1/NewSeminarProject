"""
Feature pipelines for the two feature regimes.

  triage      : ONLY information available at admission time.
                demographics + admission metadata + ED passage + first care-unit
                + the free-text admitting diagnosis. NO ICD-9 codes, NO diagnosis
                count (both are finalised at discharge -> leakage for a real-time
                model).

  full        : triage + the retrospective ICD-9 signal:
                multi-hot of the top-N codes (CountVectorizer, fit on train only)
                + total diagnosis count.

Every transformer that learns vocabulary (One-Hot categories, TF-IDF terms,
ICD-9 codes) is fit *inside* the Pipeline on the training fold only, so the
train/test split is honoured with no vocabulary leakage.
"""
from __future__ import annotations

import numpy as np
import scipy.sparse as sp
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer, CountVectorizer
from sklearn.preprocessing import FunctionTransformer, OneHotEncoder


def _to_dense(X):
    """Densify + downcast. Defined here (a stable, importable module) so the
    pickled pipelines can always resolve it -- not in the __main__ training script."""
    return X.toarray().astype(np.float32) if sp.issparse(X) else np.asarray(X, np.float32)


def make_densifier() -> FunctionTransformer:
    return FunctionTransformer(_to_dense, accept_sparse=True)

NUMERIC_TRIAGE = ["age", "ed_los_hours", "is_newborn"]
NUMERIC_FULL = NUMERIC_TRIAGE + ["n_diagnoses"]

# Known at hospital-admission time -> safe for the triage regime.
CATEGORICAL_TRIAGE = [
    "gender", "admission_type", "admission_location", "insurance",
    "marital_status", "ethnicity", "religion", "language", "came_via_ed",
]
# first_careunit is assigned at ICU intake (can be days after admission) and its
# mere presence signals that an ICU stay occurred -> outcome proxy. Full only.
CATEGORICAL_FULL_EXTRA = ["first_careunit"]

TEXT_COL = "adm_diagnosis"   # admitting free-text diagnosis (available at admission)
ICD9_COL = "icd9_str"        # space-joined ICD-9 codes (retrospective)


def build_preprocessor(feature_set: str = "triage",
                       text_features: int = 300,
                       icd9_features: int = 400) -> ColumnTransformer:
    if feature_set not in ("triage", "full"):
        raise ValueError(feature_set)

    numeric = NUMERIC_FULL if feature_set == "full" else NUMERIC_TRIAGE
    categorical = (CATEGORICAL_TRIAGE + CATEGORICAL_FULL_EXTRA
                   if feature_set == "full" else CATEGORICAL_TRIAGE)

    transformers = [
        ("num", "passthrough", numeric),
        ("cat", OneHotEncoder(handle_unknown="ignore", min_frequency=20,
                              sparse_output=True), categorical),
        ("txt", TfidfVectorizer(max_features=text_features, ngram_range=(1, 2),
                                min_df=10, stop_words="english"), TEXT_COL),
    ]

    if feature_set == "full":
        # token_pattern keeps ICD-9 codes intact (alphanumeric, e.g. "V3000", "E8798").
        transformers.append(
            ("icd9", CountVectorizer(max_features=icd9_features, binary=True,
                                     min_df=10, token_pattern=r"[A-Za-z0-9]+"),
             ICD9_COL)
        )

    return ColumnTransformer(transformers, sparse_threshold=1.0, remainder="drop")
