import { useState, type FormEvent } from 'react';
import type { Admission } from './admission.js';
import { generateAdmissionId, calculateAge } from './admissions-service.js';
import styles from './add-admission-modal.module.css';

export type AddAdmissionModalProps = {
  /** Called with the completed admission after a successful save. */
  onSave: (admission: Admission) => Promise<void>;
  /** Called when the user closes or cancels the modal. */
  onClose: () => void;
};

type FormFields = {
  fullName: string;
  subjectId: string;
  dateOfBirth: string;
  gender: string;
  admissionType: string;
  mainDiagnosis: string;
  icuUnit: string;
};

const EMPTY: FormFields = {
  fullName: '',
  subjectId: '',
  dateOfBirth: '',
  gender: '',
  admissionType: '',
  mainDiagnosis: '',
  icuUnit: '',
};

const DIAGNOSIS_OPTIONS = [
  { group: 'Cardiac', options: ['Coronary Artery Disease', 'Congestive Heart Failure', 'Chest Pain', 'Atrial Fibrillation', 'Myocardial Infarction', 'Cardiac Arrest', 'Aortic Stenosis'] },
  { group: 'Respiratory', options: ['Pneumonia', 'Respiratory Failure', 'Chronic Obstructive Pulmonary Disease', 'Pulmonary Edema', 'Asthma', 'Pleural Effusion'] },
  { group: 'Infection / Sepsis', options: ['Septicemia', 'Sepsis', 'Bacteremia', 'Urinary Tract Infection', 'Cellulitis', 'Meningitis'] },
  { group: 'Neurological', options: ['Intracranial Hemorrhage', 'Stroke', 'Altered Mental Status', 'Seizure', 'Subdural Hematoma', 'Syncope'] },
  { group: 'Gastrointestinal', options: ['Gastrointestinal Bleed', 'Pancreatitis', 'Bowel Obstruction', 'Liver Failure', 'Hepatic Encephalopathy'] },
  { group: 'Surgical', options: ['Coronary Artery Bypass Graft', 'Hip Fracture', 'Abdominal Surgery', 'Aortic Aneurysm', 'Trauma'] },
  { group: 'Metabolic / Other', options: ['Kidney Failure', 'Diabetic Ketoacidosis', 'Overdose', 'Hyponatremia', 'Alcohol Withdrawal'] },
];

const OTHER_VALUE = '__other__';

/** Today's date in YYYY-MM-DD format — used as max for Date of Birth. */
const TODAY = new Date().toISOString().split('T')[0];

/**
 * Add New Admission modal form.
 * Validates Patient ID (9 digits), Date of Birth (not future),
 * and all required clinical fields before saving to Firestore.
 */
export function AddAdmissionModal({ onSave, onClose }: AddAdmissionModalProps) {
  const [form, setForm] = useState<FormFields>(EMPTY);
  const [diagnosisSelect, setDiagnosisSelect] = useState('');
  const [customDiagnosis, setCustomDiagnosis] = useState('');
  const [otherDiagnoses, setOtherDiagnoses] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormFields, string>>>({});

  const set = (key: keyof FormFields, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const handleDiagnosisSelect = (value: string) => {
    setDiagnosisSelect(value);
    if (value !== OTHER_VALUE && value !== '') {
      set('mainDiagnosis', value);
      setCustomDiagnosis('');
    } else if (value === '') {
      set('mainDiagnosis', '');
      setCustomDiagnosis('');
    } else {
      set('mainDiagnosis', '');
    }
  };

  const handleCustomDiagnosis = (value: string) => {
    setCustomDiagnosis(value);
    set('mainDiagnosis', value);
  };

  const handlePatientId = (value: string) => {
    const digitsOnly = value.replace(/\D/g, '').slice(0, 9);
    set('subjectId', digitsOnly);
  };

  const updateOther = (i: number, value: string) =>
    setOtherDiagnoses((prev) => prev.map((d, idx) => (idx === i ? value : d)));

  const addOther = () => setOtherDiagnoses((prev) => [...prev, '']);

  const removeOther = (i: number) =>
    setOtherDiagnoses((prev) => prev.filter((_, idx) => idx !== i));

  const filledOther = otherDiagnoses.filter((d) => d.trim() !== '');
  // diagnosisCount = mainDiagnosis (1 if set) + filled other diagnoses
  const totalDiagnosisCount = (form.mainDiagnosis.trim() ? 1 : 0) + filledOther.length;

  /** Validates all required fields. Returns true if valid. */
  const validate = (): boolean => {
    const errs: Partial<Record<keyof FormFields, string>> = {};
    if (!form.fullName.trim()) errs.fullName = 'Patient Full Name is required.';
    if (!/^\d{9}$/.test(form.subjectId)) errs.subjectId = 'Patient ID must be exactly 9 digits.';
    if (!form.dateOfBirth) {
      errs.dateOfBirth = 'Date of Birth is required.';
    } else if (form.dateOfBirth > TODAY) {
      errs.dateOfBirth = 'Date of Birth cannot be in the future.';
    }
    if (!form.gender) errs.gender = 'Gender is required.';
    if (!form.admissionType) errs.admissionType = 'Admission Type is required.';
    if (!form.mainDiagnosis.trim()) errs.mainDiagnosis = 'Main Diagnosis is required.';
    if (!form.icuUnit) errs.icuUnit = 'ICU Unit is required.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const admission: Admission = {
      admissionId: generateAdmissionId(),
      fullName: form.fullName.trim(),
      subjectId: form.subjectId.trim(),
      dateOfBirth: form.dateOfBirth,
      gender: form.gender as Admission['gender'],
      admissionType: form.admissionType as Admission['admissionType'],
      mainDiagnosis: form.mainDiagnosis.trim(),
      icuUnit: form.icuUnit as Admission['icuUnit'],
      otherDiagnoses: filledOther,
      age: calculateAge(form.dateOfBirth),
      diagnosisCount: totalDiagnosisCount,
      admissionDateTime: now,
      icuAdmissionDateTime: now,
      createdAt: Date.now(),
    };
    try {
      await onSave(admission);
      setSaved(true);
      setTimeout(() => onClose(), 1800);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>Add New Admission</h2>
        <p className={styles.subHeading}>ICU Decision-Support System — New Patient Admission</p>

        {saved && <div className={styles.successBanner}>✅ Admission saved successfully!</div>}

        <form onSubmit={handleSubmit} noValidate>
          {/* ── Patient Information ── */}
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Patient Information</p>
            <div className={styles.grid}>
              <div className={`${styles.field} ${styles.gridFull}`}>
                <label className={styles.label}>Patient Full Name *</label>
                <input className={`${styles.input} ${errors.fullName ? styles.inputError : ''}`}
                  value={form.fullName} onChange={(e) => set('fullName', e.target.value)}
                  placeholder="e.g. John Doe" />
                {errors.fullName && <span className={styles.errorMsg}>{errors.fullName}</span>}
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Patient ID * <span className={styles.autoNote}>(9 digits)</span></label>
                <input className={`${styles.input} ${errors.subjectId ? styles.inputError : ''}`}
                  value={form.subjectId} onChange={(e) => handlePatientId(e.target.value)}
                  placeholder="e.g. 123456789" inputMode="numeric" maxLength={9} />
                {errors.subjectId && <span className={styles.errorMsg}>{errors.subjectId}</span>}
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Date of Birth * <span className={styles.autoNote}>— Age auto-calculated</span></label>
                <input className={`${styles.input} ${errors.dateOfBirth ? styles.inputError : ''}`}
                  type="date" value={form.dateOfBirth} max={TODAY}
                  onChange={(e) => set('dateOfBirth', e.target.value)} />
                {errors.dateOfBirth && <span className={styles.errorMsg}>{errors.dateOfBirth}</span>}
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Gender *</label>
                <select className={`${styles.select} ${errors.gender ? styles.inputError : ''}`}
                  value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                  <option value="">Select gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
                {errors.gender && <span className={styles.errorMsg}>{errors.gender}</span>}
              </div>
            </div>
          </div>

          {/* ── Admission Information ── */}
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Admission Information</p>
            <div className={styles.grid}>
              <div className={styles.field}>
                <label className={styles.label}>Admission Type *</label>
                <select className={`${styles.select} ${errors.admissionType ? styles.inputError : ''}`}
                  value={form.admissionType} onChange={(e) => set('admissionType', e.target.value)}>
                  <option value="">Select type</option>
                  <option value="Emergency">Emergency</option>
                  <option value="Urgent">Urgent</option>
                  <option value="Elective">Elective</option>
                  <option value="Newborn">Newborn</option>
                </select>
                {errors.admissionType && <span className={styles.errorMsg}>{errors.admissionType}</span>}
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Main Diagnosis *</label>
                <select className={`${styles.select} ${errors.mainDiagnosis ? styles.inputError : ''}`}
                  value={diagnosisSelect} onChange={(e) => handleDiagnosisSelect(e.target.value)}>
                  <option value="">Select diagnosis</option>
                  {DIAGNOSIS_OPTIONS.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </optgroup>
                  ))}
                  <option value={OTHER_VALUE}>✏️ Other — type your own</option>
                </select>
                {diagnosisSelect === OTHER_VALUE && (
                  <input className={`${styles.input} ${styles.otherInput}`}
                    value={customDiagnosis} onChange={(e) => handleCustomDiagnosis(e.target.value)}
                    placeholder="Type the diagnosis here…" autoFocus />
                )}
                {form.mainDiagnosis && (
                  <span className={styles.diagnosisPreview}>✅ {form.mainDiagnosis}</span>
                )}
                {errors.mainDiagnosis && <span className={styles.errorMsg}>{errors.mainDiagnosis}</span>}
              </div>
            </div>
          </div>

          {/* ── ICU Information ── */}
          <div className={styles.section}>
            <p className={styles.sectionTitle}>ICU Information</p>
            <div className={styles.grid}>
              <div className={styles.field}>
                <label className={styles.label}>ICU Unit *</label>
                <select className={`${styles.select} ${errors.icuUnit ? styles.inputError : ''}`}
                  value={form.icuUnit} onChange={(e) => set('icuUnit', e.target.value)}>
                  <option value="">Select ICU unit</option>
                  <option value="MICU">MICU — Medical ICU</option>
                  <option value="SICU">SICU — Surgical ICU</option>
                  <option value="CCU">CCU — Cardiac Care Unit</option>
                  <option value="CSRU">CSRU — Cardiac Surgery Recovery Unit</option>
                  <option value="TSICU">TSICU — Trauma/Surgical ICU</option>
                </select>
                {errors.icuUnit && <span className={styles.errorMsg}>{errors.icuUnit}</span>}
              </div>
            </div>
          </div>

          {/* ── Other Diagnoses ── */}
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Other Diagnoses</p>
            {otherDiagnoses.map((diag, i) => (
              <div className={styles.diagnosisRow} key={i}>
                <input className={styles.diagnosisInput} value={diag}
                  onChange={(e) => updateOther(i, e.target.value)}
                  placeholder={`Other diagnosis #${i + 1}`} />
                {otherDiagnoses.length > 1 && (
                  <button type="button" className={styles.removeDiagBtn}
                    onClick={() => removeOther(i)} aria-label="Remove">✕</button>
                )}
              </div>
            ))}
            <button type="button" className={styles.addDiagBtn} onClick={addOther}>
              + Add Another Diagnosis
            </button>
            <span className={styles.diagCount}>
              Number of Diagnoses: {totalDiagnosisCount}
              {form.mainDiagnosis && (
                <span className={styles.diagCountNote}>
                  {' '}(Main: {form.mainDiagnosis.length > 25 ? form.mainDiagnosis.slice(0, 25) + '…' : form.mainDiagnosis}
                  {filledOther.length > 0 ? ` + ${filledOther.length} other` : ''})
                </span>
              )}
            </span>
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.cancelButton} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.saveButton} disabled={saving || saved}>
              {saving ? 'Saving…' : 'Save Admission'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
