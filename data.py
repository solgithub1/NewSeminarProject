"""
Data loading, cleaning, cohort construction and target engineering for the
MIMIC-III predictors.

Two prediction targets are built at the *admission* grain (one row per HADM_ID):

  - mortality   : HOSPITAL_EXPIRE_FLAG  (in-hospital death, binary)
  - icu_los_days: length of stay (days) of the *first* ICU stay of the admission

Patient identity (SUBJECT_ID) is preserved so train/test can be split by patient
and never leak the same person across the split.

Leakage discipline lives here: any column that is only known at/after discharge
(DISCHTIME, DEATHTIME, DISCHARGE_LOCATION, DOD, the LOS target itself, ...) is
*never* exposed as a feature. See FEATURE_COLUMNS in features.py for the
allow-list that the models actually consume.
"""
from __future__ import annotations

import os
import numpy as np
import pandas as pd
from sklearn.model_selection import GroupShuffleSplit

DATA_DIR = os.environ.get("MIMIC_DIR", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Ethnicity has dozens of granular values; collapse to a small, stable set.
_ETH_MAP = {
    "WHITE": "WHITE",
    "BLACK/AFRICAN AMERICAN": "BLACK",
    "HISPANIC OR LATINO": "HISPANIC",
    "ASIAN": "ASIAN",
}


def _collapse_ethnicity(s: pd.Series) -> pd.Series:
    out = s.str.upper().str.strip()
    out = out.where(out.isin(_ETH_MAP.keys()), other=None).map(_ETH_MAP)
    return out.fillna("OTHER/UNKNOWN")


def _collapse_top(s: pd.Series, top_n: int, other: str = "OTHER") -> pd.Series:
    # Fill missing FIRST so NaN becomes an explicit "MISSING" category that can
    # itself rank into the top-N, rather than silently folding into "OTHER".
    s = s.fillna("MISSING")
    top = s.value_counts().head(top_n).index
    return s.where(s.isin(top), other=other)


def load_tables(data_dir: str = DATA_DIR) -> dict[str, pd.DataFrame]:
    adm = pd.read_csv(
        os.path.join(data_dir, "ADMISSIONS.csv"),
        parse_dates=["ADMITTIME", "DISCHTIME", "DEATHTIME", "EDREGTIME", "EDOUTTIME"],
    )
    pat = pd.read_csv(
        os.path.join(data_dir, "PATIENTS.csv"), parse_dates=["DOB", "DOD"]
    )
    icu = pd.read_csv(
        os.path.join(data_dir, "ICUSTAYS.csv"), parse_dates=["INTIME", "OUTTIME"]
    )
    dx = pd.read_csv(os.path.join(data_dir, "DIAGNOSES_ICD.csv"), dtype={"ICD9_CODE": str})
    return {"adm": adm, "pat": pat, "icu": icu, "dx": dx}


def _first_icu_stay(icu: pd.DataFrame) -> pd.DataFrame:
    """One row per HADM_ID: the chronologically first ICU stay (its LOS + unit).

    Use drop_duplicates (not groupby().first()) so LOS and care-unit come from the
    SAME physical row -- groupby().first() takes the first non-null value per column
    independently and can stitch fields from different stays.
    """
    icu = icu.dropna(subset=["INTIME"]).sort_values(["HADM_ID", "INTIME"])
    first = icu.drop_duplicates(subset="HADM_ID", keep="first")
    return first[["HADM_ID", "ICUSTAY_ID", "FIRST_CAREUNIT", "LOS"]].rename(
        columns={"LOS": "icu_los_days", "FIRST_CAREUNIT": "first_careunit"}
    )


def _diagnosis_features(dx: pd.DataFrame) -> pd.DataFrame:
    """Per-admission ICD-9 aggregates (RETROSPECTIVE: codes are finalised at discharge)."""
    g = dx.dropna(subset=["ICD9_CODE"]).groupby("HADM_ID")
    codes = g["ICD9_CODE"].apply(lambda s: " ".join(s.astype(str)))
    ndx = g.size().rename("n_diagnoses")
    out = pd.concat([codes.rename("icd9_str"), ndx], axis=1).reset_index()
    return out


def build_dataset(data_dir: str = DATA_DIR) -> pd.DataFrame:
    """Return the admission-level modelling table with features + both targets."""
    t = load_tables(data_dir)
    adm, pat, icu, dx = t["adm"], t["pat"], t["icu"], t["dx"]

    df = adm.merge(pat[["SUBJECT_ID", "GENDER", "DOB"]], on="SUBJECT_ID", how="left")

    # --- Age at admission. MIMIC shifts DOB ~300y for patients >89 -> cap to 90.
    # Use y/m/d arithmetic: the obscured DOBs overflow a nanosecond timedelta. ---
    age = df["ADMITTIME"].dt.year - df["DOB"].dt.year
    before_bday = ((df["ADMITTIME"].dt.month < df["DOB"].dt.month) |
                   ((df["ADMITTIME"].dt.month == df["DOB"].dt.month) &
                    (df["ADMITTIME"].dt.day < df["DOB"].dt.day)))
    age = age - before_bday.astype(int)
    df["age"] = np.clip(np.where(age >= 120, 90.0, age), 0, None)
    df["is_newborn"] = (df["ADMISSION_TYPE"] == "NEWBORN").astype(int)

    # --- ED passage (known at admission) ---
    ed_h = (df["EDOUTTIME"] - df["EDREGTIME"]).dt.total_seconds() / 3600
    df["ed_los_hours"] = ed_h.fillna(0).clip(lower=0)
    df["came_via_ed"] = df["EDREGTIME"].notna().astype(int).astype(str)

    # --- Cleaned categoricals (all known at admission) ---
    df["gender"] = df["GENDER"].fillna("MISSING")
    df["admission_type"] = df["ADMISSION_TYPE"].fillna("MISSING")
    df["admission_location"] = _collapse_top(df["ADMISSION_LOCATION"], 8)
    df["insurance"] = df["INSURANCE"].fillna("MISSING")
    df["marital_status"] = df["MARITAL_STATUS"].fillna("MISSING")
    df["ethnicity"] = _collapse_ethnicity(df["ETHNICITY"])
    df["religion"] = _collapse_top(df["RELIGION"], 6)
    lang = df["LANGUAGE"].fillna("MISSING")
    df["language"] = np.where(lang.isin(["ENGL", "MISSING"]), lang, "OTHER")
    df["adm_diagnosis"] = df["DIAGNOSIS"].fillna("").str.upper()  # admission free-text

    # --- First ICU stay (LOS target + care-unit feature, known early) ---
    df = df.merge(_first_icu_stay(icu), on="HADM_ID", how="left")
    df["first_careunit"] = df["first_careunit"].fillna("NONE")

    # --- Retrospective ICD-9 features ---
    df = df.merge(_diagnosis_features(dx), on="HADM_ID", how="left")
    df["icd9_str"] = df["icd9_str"].fillna("")
    df["n_diagnoses"] = df["n_diagnoses"].fillna(0)

    # --- Targets ---
    df["mortality"] = df["HOSPITAL_EXPIRE_FLAG"].astype(int)
    # icu_los_days already merged; NaN where no ICU stay.

    keep = [
        "SUBJECT_ID", "HADM_ID",
        # numeric
        "age", "ed_los_hours", "n_diagnoses", "is_newborn",
        # categorical
        "gender", "admission_type", "admission_location", "insurance",
        "marital_status", "ethnicity", "religion", "language", "came_via_ed",
        "first_careunit",
        # text / codes
        "adm_diagnosis", "icd9_str",
        # targets
        "mortality", "icu_los_days",
    ]
    return df[keep].copy()


def patient_split(df: pd.DataFrame, test_size: float = 0.2, seed: int = 42):
    """Split indices by SUBJECT_ID so a patient never appears in both sides."""
    gss = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
    train_idx, test_idx = next(gss.split(df, groups=df["SUBJECT_ID"]))
    return df.iloc[train_idx].copy(), df.iloc[test_idx].copy()


if __name__ == "__main__":
    d = build_dataset()
    print(d.shape)
    print(d.describe(include="all").T.head(40))
