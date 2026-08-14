/**
 * Represents a full hospital admission record in the ICU decision-support system.
 */
export type Admission = {
  /** Auto-generated unique admission ID. */
  admissionId: string;

  // --- Patient Information ---
  /** Full name of the patient. */
  fullName: string;
  /** Patient ID (exactly 9 digits). */
  subjectId: string;
  /** Date of birth (ISO date string e.g. "1980-05-14") — stored internally only. */
  dateOfBirth: string;
  /** Patient gender. */
  gender: 'Male' | 'Female' | '';

  // --- Admission Information ---
  /** Type of admission. */
  admissionType: 'Emergency' | 'Urgent' | 'Elective' | 'Newborn' | '';
  /** Main diagnosis selected or typed by the clinician. */
  mainDiagnosis: string;

  // --- ICU Information ---
  /** ICU unit. */
  icuUnit: 'MICU' | 'SICU' | 'CCU' | 'CSRU' | 'TSICU' | '';

  // --- Other Diagnoses ---
  /** Additional diagnoses entered by the clinician (free text). */
  otherDiagnoses: string[];

  // --- Auto-calculated fields ---
  /** Age in years, calculated from dateOfBirth at save time. */
  age: number | null;
  /**
   * Total diagnosis count = 1 (mainDiagnosis) + otherDiagnoses.length.
   * Always at least 1 when mainDiagnosis is set.
   */
  diagnosisCount: number;
  /** Admission date/time — set automatically to current time on save. */
  admissionDateTime: string;
  /** ICU admission date/time — set automatically to current time on save. */
  icuAdmissionDateTime: string;
  /** Unix timestamp (ms) when the record was created. */
  createdAt: number;

  // Legacy field kept for backward-compat with older Firestore documents.
  diagnoses?: string[];

  // --- Prediction fields (written back to Firestore after prediction runs) ---
  /** Risk tier returned by the prediction API: "Low" | "Medium" | "High" */
  riskLevel?: string;
  /** Predicted ICU length of stay in days. */
  icuLosDays?: number;
  /** Death probability 0–1 returned by the prediction API. */
  deathProbability?: number;
  /** Human-readable decision support note from the prediction API. */
  decisionNote?: string;
};
