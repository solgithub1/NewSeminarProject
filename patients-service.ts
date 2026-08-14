import { collection, addDoc, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from './firebase.js';
import type { Patient } from './patient.js';

/** Name of the Firestore collection storing patient records. */
const PATIENTS_COLLECTION = 'patients';

/**
 * Possible Firestore collection names for doctors. Firestore is
 * case-sensitive, so we try both common conventions.
 */
const DOCTOR_COLLECTIONS = ['Doctors', 'doctors'];

/**
 * Reads a field from a document data object in a case-insensitive way,
 * tolerating different naming conventions (e.g. FullName, fullName, full_name).
 * @param data - the raw document data.
 * @param candidates - possible field names to look for.
 * @returns the first matching value as a trimmed string, or ''.
 */
function readField(
  data: Record<string, unknown>,
  candidates: string[]
): string {
  const wanted = candidates.map((c) => c.toLowerCase().replace(/[_\s]/g, ''));
  for (const key of Object.keys(data)) {
    const normalized = key.toLowerCase().replace(/[_\s]/g, '');
    if (wanted.includes(normalized)) {
      return String(data[key] ?? '').trim();
    }
  }
  return '';
}

/**
 * Subscribes to real-time updates of the "patients" collection.
 * The callback fires immediately with the current list and again on every
 * add, update or delete in Firestore.
 * @param onChange - called with the latest list of patients.
 * @param onError - called if the listener errors.
 * @returns an unsubscribe function to stop listening.
 */
export function subscribeToPatients(
  onChange: (patients: Patient[]) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    collection(db, PATIENTS_COLLECTION),
    (snapshot) => {
      const patients = snapshot.docs.map((doc) => doc.data() as Patient);
      onChange(patients);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

/**
 * Saves a new patient to the Firestore "patients" collection.
 * @param patient - the patient record to persist.
 */
export async function savePatient(patient: Patient): Promise<void> {
  await addDoc(collection(db, PATIENTS_COLLECTION), { ...patient });
}

/**
 * Verifies a doctor's login credentials against the Firestore "doctors"
 * collection. A match requires a document whose fullName equals the provided
 * name and whose ID (stored as `doctorId` or `docId`) equals the provided ID.
 * @param fullName - the doctor's full name.
 * @param doctorId - the doctor's 9-digit ID.
 * @returns true if a matching doctor exists, false otherwise.
 */
export async function verifyDoctor(
  fullName: string,
  doctorId: string
): Promise<boolean> {
  const targetName = fullName.trim().toLowerCase();
  const targetId = doctorId.trim();

  for (const collectionName of DOCTOR_COLLECTIONS) {
    try {
      const snapshot = await getDocs(collection(db, collectionName));
      const match = snapshot.docs.some((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const name = readField(data, ['fullName', 'name']).toLowerCase();
        const id = readField(data, ['doctorId', 'docId', 'id']);
        return name === targetName && id === targetId;
      });
      if (match) return true;
    } catch {
      // Collection may not exist with this name — try the next.
    }
  }
  return false;
}
