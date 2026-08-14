import { collection, addDoc, onSnapshot, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase.js';
import type { Admission } from './admission.js';

/** Firestore collection name for admissions. */
const ADMISSIONS_COLLECTION = 'admissions';

/**
 * Generates a unique admission ID using a timestamp + random suffix.
 * @returns a string like "ADM-1718200000000-A3F".
 */
export function generateAdmissionId(): string {
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `ADM-${Date.now()}-${rand}`;
}

/**
 * Calculates a patient's age in whole years from their date of birth.
 * @param dateOfBirth - ISO date string (e.g. "1980-05-14").
 * @returns age in years, or null if dateOfBirth is empty/invalid.
 */
export function calculateAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

/**
 * Saves a new admission to the Firestore "admissions" collection.
 * Stores all fields including calculated ones (age, diagnosisCount, etc).
 * @param admission - the full admission record to persist.
 */
export async function saveAdmission(admission: Admission): Promise<void> {
  const doc = {
    admissionId: admission.admissionId,
    patientId: admission.subjectId,
    fullName: admission.fullName,
    age: admission.age,
    dateOfBirth: admission.dateOfBirth,
    gender: admission.gender,
    admissionType: admission.admissionType,
    mainDiagnosis: admission.mainDiagnosis,
    otherDiagnoses: admission.otherDiagnoses ?? [],
    diagnosisCount: admission.diagnosisCount,
    icuUnit: admission.icuUnit,
    admissionDateTime: admission.admissionDateTime,
    icuAdmissionDateTime: admission.icuAdmissionDateTime,
    createdAt: admission.createdAt,
    // Keep subjectId for backward-compat
    subjectId: admission.subjectId,
  };
  await addDoc(collection(db, ADMISSIONS_COLLECTION), doc);
}

/**
 * Writes prediction result fields back to the Firestore admission document
 * so the AI assistant can read them as part of the admission context.
 * @param admissionId - the admission's own ID (admissionId field).
 * @param prediction - fields to persist: riskLevel, icuLosDays, deathProbability, decisionNote.
 */
export async function updateAdmissionPrediction(
  admissionId: string,
  prediction: { riskLevel: string; icuLosDays: number; deathProbability: number; decisionNote: string }
): Promise<void> {
  // Firestore query: find the doc whose admissionId field equals our ID
  const q = query(
    collection(db, ADMISSIONS_COLLECTION),
    where('admissionId', '==', admissionId)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return;
  const docRef = doc(db, ADMISSIONS_COLLECTION, snapshot.docs[0].id);
  await updateDoc(docRef, {
    riskLevel: prediction.riskLevel,
    icuLosDays: prediction.icuLosDays,
    deathProbability: prediction.deathProbability,
    decisionNote: prediction.decisionNote,
  });
}

/**
 * Subscribes to real-time updates of the "admissions" collection.
 * Fires immediately with the current list, then on every change.
 * @param onChange - called with the latest list of admissions.
 * @param onError - called if the listener errors.
 * @returns an unsubscribe function.
 */
export function subscribeToAdmissions(
  onChange: (admissions: Admission[]) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    collection(db, ADMISSIONS_COLLECTION),
    (snapshot) => {
      const admissions = snapshot.docs.map((doc) => doc.data() as Admission);
      admissions.sort((a, b) => b.createdAt - a.createdAt);
      onChange(admissions);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

/**
 * Fetches all previous admissions for a given Patient ID,
 * sorted newest-first by admissionDateTime.
 * @param subjectId - the patient's 9-digit ID.
 * @returns sorted list of admissions for that patient.
 */
export async function fetchAdmissionsByPatientId(subjectId: string): Promise<Admission[]> {
  const q = query(
    collection(db, ADMISSIONS_COLLECTION),
    where('subjectId', '==', subjectId)
  );
  const snapshot = await getDocs(q);
  const results = snapshot.docs.map((doc) => doc.data() as Admission);
  results.sort((a, b) =>
    new Date(b.admissionDateTime).getTime() - new Date(a.admissionDateTime).getTime()
  );
  return results;
}
