from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="CPAS API", version="1.0.0")

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

MORTALITY_MODEL = joblib.load(BASE_DIR / "mortality_triage.joblib")
LOS_MODEL = joblib.load(BASE_DIR / "icu_los_triage.joblib")


class PredictionInput(BaseModel):
    subject_id: int = 0
    hadm_id: int = 0
    age: float = 0
    gender: str = "UNKNOWN"
    admission_type: str = "EMERGENCY"
    adm_diagnosis: str = "UNKNOWN"
    main_diagnosis: str | None = None
    first_careunit: str = "MICU"
    diagnosis_codes: list[str] = Field(default_factory=list)
    n_diagnoses: int = 0
    ed_los_hours: float = 0
    is_newborn: int = 0
    admission_location: str = "UNKNOWN"
    insurance: str = "UNKNOWN"
    marital_status: str = "UNKNOWN"
    ethnicity: str = "OTHER/UNKNOWN"
    religion: str = "UNKNOWN"
    language: str = "UNKNOWN"
    came_via_ed: str = "UNKNOWN"


class AskAIInput(BaseModel):
    question: str
    admissionsContext: str
    admissionCount: int = 0


def risk_tier(probability: float) -> str:
    if probability < 0.05:
        return "Low"
    if probability < 0.20:
        return "Medium"
    return "High"


def decision_note(risk: str, los: float, mortality_probability: float) -> str:
    pct = mortality_probability * 100
    if risk == "High":
        return (
            f"High predicted mortality risk ({pct:.1f}%) with an expected ICU stay "
            f"of {los:.1f} days. Prioritize close monitoring and ICU resource planning."
        )
    if risk == "Medium":
        return (
            f"Medium predicted mortality risk ({pct:.1f}%) with an expected ICU stay "
            f"of {los:.1f} days. Consider moderate ICU resource planning and monitoring."
        )
    return (
        f"Low predicted mortality risk ({pct:.1f}%) with an expected ICU stay "
        f"of {los:.1f} days. Standard ICU monitoring and resource planning may be appropriate."
    )


def to_model_row(payload: PredictionInput) -> pd.DataFrame:
    # These are exactly the admission-time features used by the saved triage pipelines.
    row = {
        "age": float(payload.age),
        "ed_los_hours": float(payload.ed_los_hours),
        "is_newborn": int(payload.is_newborn),
        "gender": payload.gender or "UNKNOWN",
        "admission_type": payload.admission_type or "UNKNOWN",
        "admission_location": payload.admission_location or "UNKNOWN",
        "insurance": payload.insurance or "UNKNOWN",
        "marital_status": payload.marital_status or "UNKNOWN",
        "ethnicity": payload.ethnicity or "OTHER/UNKNOWN",
        "religion": payload.religion or "UNKNOWN",
        "language": payload.language or "UNKNOWN",
        "came_via_ed": str(payload.came_via_ed or "UNKNOWN"),
        "adm_diagnosis": payload.adm_diagnosis or payload.main_diagnosis or "UNKNOWN",
    }
    return pd.DataFrame([row])


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "ok", "service": "CPAS API"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/predict")
def predict(payload: PredictionInput) -> dict[str, Any]:
    try:
        X = to_model_row(payload)
        mortality_probability = float(MORTALITY_MODEL.predict_proba(X)[0, 1])
        los = float(np.clip(LOS_MODEL.predict(X)[0], 0, None))
        risk = risk_tier(mortality_probability)
        return {
            "predicted_icu_los_days": round(los, 2),
            "mortality_probability": round(mortality_probability, 6),
            "mortality_risk_level": risk,
            "decision_support_note": decision_note(risk, los, mortality_probability),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {exc}") from exc


SYSTEM_INSTRUCTION = """You are an ICU decision-support AI assistant for doctors and ICU managers.

You help with: summarizing today's ICU admissions, identifying priority patients, explaining prediction results, comparing patients, and estimating ICU resource planning needs.

When answering about long-stay patients, compare Expected ICU stay values and identify the highest predicted stays. If prediction data is missing, say the prediction has not been run yet.

For ICU resource planning, consider risk levels, expected stay lengths, emergency admissions, beds, doctors, certified nurses, ventilators, monitors, and isolation rooms when relevant. Always end resource estimates with: \"These are planning estimates based on prediction data, not final medical decisions.\"

High risk, emergency admission, and high mortality probability imply higher urgency. Low risk plus elective/non-emergency admission implies lower urgency.

Only answer questions related to today's ICU admissions, patient data, prediction results, risk levels, expected ICU stay, patient priority, or ICU resource planning. Do not give direct medical treatment instructions. Provide decision-support summaries and operational planning recommendations only."""


@app.post("/api/ask-ai")
def ask_ai(payload: AskAIInput) -> dict[str, str]:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OpenRouter API key is not configured on the server.")

    user_message = (
        f"ICU Admissions Summary ({payload.admissionCount} total):\n\n"
        f"{payload.admissionsContext}\n\n"
        f"Doctor's Question: {payload.question}"
    )

    try:
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            timeout=60,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "X-Title": "ICU Clinical AI Assistant",
            },
            json={
                "model": os.getenv("OPENROUTER_MODEL", "openrouter/auto"),
                "messages": [
                    {"role": "system", "content": SYSTEM_INSTRUCTION},
                    {"role": "user", "content": user_message},
                ],
            },
        )
        if not response.ok:
            raise HTTPException(status_code=502, detail="AI service is temporarily unavailable.")
        result = response.json()
        answer = result.get("choices", [{}])[0].get("message", {}).get("content", "No response from AI.")
        return {"answer": answer}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="AI service is temporarily unavailable.") from exc
