import type { Admission } from './admission.js';

const API_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

export type PredictionResult = {
  /** Predicted ICU length of stay in days. */
  icuLosDays: number;
  /** Death probability 0–1. */
  deathProbability: number;
  /** Risk tier: "Low" | "Medium" | "High" */
  riskLevel: string;
  /** Human-readable decision support note. */
  note: string;
};

/**
 * Builds a fallback note when the API doesn't return one.
 */
function buildNote(risk: string, los: number): string {
  if (risk === 'High') {
    return `This patient is at HIGH mortality risk with a predicted ICU stay of ${los.toFixed(1)} days. Immediate intensive resource allocation and close monitoring are recommended.`;
  }
  if (risk === 'Medium') {
    return `This patient may require medium ICU resource planning based on a predicted stay of ${los.toFixed(1)} days and a medium mortality risk level.`;
  }
  return `This patient has a LOW mortality risk with a predicted ICU stay of ${los.toFixed(1)} days. Standard ICU monitoring protocols are recommended.`;
}

/**
 * Sends an admission to the real prediction API and returns structured results.
 * @param admission - the patient admission record from Firestore.
 */
export async function runPrediction(admission: Admission): Promise<PredictionResult> {
  const otherDiagnoses = admission.otherDiagnoses ?? admission.diagnoses ?? [];

  const payload = {
    subject_id: 0,
    hadm_id: 0,
    age: admission.age ?? 0,
    gender: (admission.gender || 'UNKNOWN').toUpperCase(),
    admission_type: (admission.admissionType || 'EMERGENCY').toUpperCase(),
    adm_diagnosis: (admission.mainDiagnosis || 'UNKNOWN').toUpperCase(),
    main_diagnosis: (admission.mainDiagnosis || 'UNKNOWN').toUpperCase(),
    first_careunit: admission.icuUnit || 'MICU',
    // Array of other diagnoses — Colab counts them with len()
    diagnosis_codes: otherDiagnoses,
    // Total count = mainDiagnosis + otherDiagnoses
    n_diagnoses: admission.diagnosisCount ?? (1 + otherDiagnoses.length),
    ed_los_hours: 0,
    is_newborn: admission.admissionType === 'Newborn' ? 1 : 0,
    admission_location: 'UNKNOWN',
    insurance: 'UNKNOWN',
    marital_status: 'UNKNOWN',
    ethnicity: 'UNKNOWN',
    religion: 'UNKNOWN',
    language: 'UNKNOWN',
    came_via_ed: 'UNKNOWN',
  };

  const response = await fetch(`${API_URL}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Prediction API error: ${response.status}`);
  }

  const data = await response.json() as {
    predicted_icu_los_days?: number;
    mortality_probability?: number;
    mortality_risk_level?: string;
    decision_support_note?: string;
    error?: string;
  };

  if (data.error) throw new Error(`Model error: ${data.error}`);

  const los = data.predicted_icu_los_days ?? 0;
  const deathProb = data.mortality_probability ?? 0;
  const risk = data.mortality_risk_level ?? 'Low';
  const note = data.decision_support_note || buildNote(risk, los);

  return { icuLosDays: los, deathProbability: deathProb, riskLevel: risk, note };
}
