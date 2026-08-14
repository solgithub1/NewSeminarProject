import { useState, type FormEvent } from 'react';
import type { Patient } from './patient.js';
import styles from './add-patient-modal.module.css';

export type AddPatientModalProps = {
  /** Called when the user saves a valid patient. May be async. */
  onSave: (patient: Patient) => void | Promise<void>;
  /** Called when the user cancels or closes the modal. */
  onClose: () => void;
};

const EMPTY: Patient = {
  fullName: '',
  id: '',
  age: '',
  gender: '',
  heartRate: '',
  bloodPressure: '',
  oxygenSaturation: '',
  temperature: '',
};

/**
 * Modal form for adding a new patient to the registry.
 * @param props - save and close callbacks.
 */
export function AddPatientModal({ onSave, onClose }: AddPatientModalProps) {
  const [form, setForm] = useState<Patient>(EMPTY);

  /**
   * Updates a single field of the patient form.
   * @param key - the field to update.
   * @param value - the new value.
   */
  const update = (key: keyof Patient, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim() || !form.id.trim()) return;
    onSave(form);
  };

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>Add A New Patient</h2>
        <form onSubmit={handleSubmit}>
          <div className={styles.grid}>
            <div className={`${styles.field} ${styles.fieldFull}`}>
              <label className={styles.label}>Patient Full Name</label>
              <input
                className={styles.input}
                value={form.fullName}
                onChange={(e) => update('fullName', e.target.value)}
                placeholder="e.g. Noa Smith"
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Patient ID</label>
              <input
                className={styles.input}
                value={form.id}
                onChange={(e) => update('id', e.target.value)}
                placeholder="e.g. 123456789"
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Age</label>
              <input
                className={styles.input}
                type="number"
                value={form.age}
                onChange={(e) => update('age', e.target.value)}
                placeholder="e.g. 45"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Gender</label>
              <select
                className={styles.select}
                value={form.gender}
                onChange={(e) => update('gender', e.target.value)}
              >
                <option value="">Select</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Heart Rate (bpm)</label>
              <input
                className={styles.input}
                value={form.heartRate}
                onChange={(e) => update('heartRate', e.target.value)}
                placeholder="e.g. 72"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Blood Pressure</label>
              <input
                className={styles.input}
                value={form.bloodPressure}
                onChange={(e) => update('bloodPressure', e.target.value)}
                placeholder="e.g. 120/80"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Oxygen Saturation (%)</label>
              <input
                className={styles.input}
                value={form.oxygenSaturation}
                onChange={(e) => update('oxygenSaturation', e.target.value)}
                placeholder="e.g. 98"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Temperature</label>
              <input
                className={styles.input}
                value={form.temperature}
                onChange={(e) => update('temperature', e.target.value)}
                placeholder="e.g. 37.0"
              />
            </div>
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.saveButton}>
              Save Patient
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
