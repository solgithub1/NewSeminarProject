/**
 * Represents a single patient record in the registry.
 */
export type Patient = {
  /** Full name of the patient. */
  fullName: string;
  /** Unique patient identifier. */
  id: string;
  /** Patient age in years. */
  age: string;
  /** Patient gender. */
  gender: string;
  /** Heart rate in beats per minute. */
  heartRate: string;
  /** Blood pressure reading (e.g. "120/80"). */
  bloodPressure: string;
  /** Oxygen saturation percentage. */
  oxygenSaturation: string;
  /** Body temperature. */
  temperature: string;
};
