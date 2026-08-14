import { useState } from 'react';
import type { Admission } from './admission.js';
import { runPrediction, type PredictionResult } from './prediction-service.js';
import { fetchAdmissionsByPatientId, updateAdmissionPrediction } from './admissions-service.js';
import styles from './patient-dashboard.module.css';

export type PatientDashboardProps = {
  /** The admission record to display. */
  admission: Admission;
  /** Called when the user closes the dashboard. */
  onClose: () => void;
  /** Called when the user clicks a previous admission to open it. */
  onSelectAdmission: (admission: Admission) => void;
};

/**
 * Formats an ISO datetime string to a readable "DD/MM/YYYY HH:MM" string.
 */
function formatDateTime(dt: string): string {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Returns a CSS class for the risk badge colour. */
function riskColor(risk: string): string {
  if (risk === 'High') return styles.riskHigh;
  if (risk === 'Medium') return styles.riskMedium;
  return styles.riskLow;
}

/**
 * Patient admission dashboard panel.
 * Shows all clinical fields, prediction results, and previous admissions.
 */
export function PatientDashboard({ admission, onClose, onSelectAdmission }: PatientDashboardProps) {
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [predLoading, setPredLoading] = useState(false);
  const [predError, setPredError] = useState('');
  const [prevAdmissions, setPrevAdmissions] = useState<Admission[] | null>(null);
  const [prevLoading, setPrevLoading] = useState(false);

  const otherDiagnoses = admission.otherDiagnoses ?? admission.diagnoses ?? [];
  const totalDiagnoses = admission.diagnosisCount ??
    ((admission.mainDiagnosis ? 1 : 0) + otherDiagnoses.length);

  const handleRunPrediction = async () => {
    setPredError('');
    setPredLoading(true);
    try {
      const result = await runPrediction(admission);
      setPrediction(result);
      // Persist prediction back to Firestore so Ask AI Assistant can read it
      await updateAdmissionPrediction(admission.admissionId, {
        riskLevel: result.riskLevel,
        icuLosDays: result.icuLosDays,
        deathProbability: result.deathProbability,
        decisionNote: result.note,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Prediction failed:', err);
      setPredError('Could not reach the prediction server. Please make sure the API is running.');
    } finally {
      setPredLoading(false);
    }
  };

  const handleViewPrevious = async () => {
    if (prevAdmissions !== null) {
      setPrevAdmissions(null);
      return;
    }
    setPrevLoading(true);
    try {
      const all = await fetchAdmissionsByPatientId(admission.subjectId);
      setPrevAdmissions(all);
    } finally {
      setPrevLoading(false);
    }
  };

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div className={styles.panel} onMouseDown={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <h2 className={styles.patientName}>{admission.fullName}</h2>
            <div className={styles.headerMeta}>
              <span className={styles.metaTag}>Admission ID: {admission.admissionId}</span>
              <span className={styles.metaTag}>Patient ID: {admission.subjectId}</span>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Admission Date & Time — shown once, right below the ID badges */}
        {admission.admissionDateTime && (
          <div className={styles.admissionDateRow}>
            <span className={styles.admissionDateLabel}>Admission Date &amp; Time</span>
            <span className={styles.admissionDateValue}>{formatDateTime(admission.admissionDateTime)}</span>
          </div>
        )}

        {/* Patient Information */}
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Patient Information</p>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Age</span>
              <span className={styles.infoValue}>
                {admission.age != null ? `${admission.age} years` : '—'}
              </span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Gender</span>
              <span className={styles.infoValue}>{admission.gender || '—'}</span>
            </div>
          </div>
        </div>

        {/* Admission Information */}
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Admission Information</p>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Admission Type</span>
              <span className={styles.infoValue}>{admission.admissionType || '—'}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Main Diagnosis</span>
              <span className={styles.infoValue}>{admission.mainDiagnosis || '—'}</span>
            </div>
          </div>
        </div>

        {/* ICU Information */}
        <div className={styles.section}>
          <p className={styles.sectionTitle}>ICU Information</p>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>ICU Unit</span>
              <span className={styles.infoValue}>{admission.icuUnit || '—'}</span>
            </div>
          </div>
        </div>

        {/* Diagnosis Information */}
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Diagnosis Information</p>
          {admission.mainDiagnosis && (
            <span className={styles.diagTag}>{admission.mainDiagnosis}</span>
          )}
          {otherDiagnoses.map((d, i) => (
            <span key={i} className={styles.diagTag}>{d}</span>
          ))}
          <span className={styles.diagCount}>
            Number of Diagnoses: {totalDiagnoses}
          </span>
        </div>

        {/* Run Prediction */}
        <button
          className={styles.runPredBtn}
          disabled={predLoading}
          onClick={handleRunPrediction}
        >
          {predLoading ? '⏳ Running Prediction…' : '🔬 Run Prediction'}
        </button>

        {predError && <div className={styles.predError}>{predError}</div>}

        {prediction && (
          <div className={styles.predictionBox}>
            <p className={styles.predTitle}>🧠 AI Prediction Results</p>
            <div className={styles.predGrid}>
              <div className={styles.predItem}>
                <span className={styles.predLabel}>Predicted ICU Length of Stay</span>
                <span className={styles.predValue}>{prediction.icuLosDays.toFixed(1)} days</span>
              </div>
              <div className={styles.predItem}>
                <span className={styles.predLabel}>Mortality Risk Level</span>
                <span className={styles.predValue}>
                  <span className={`${styles.riskBadge} ${riskColor(prediction.riskLevel)}`}>
                    {prediction.riskLevel}
                  </span>
                </span>
              </div>
              <div className={styles.predItem}>
                <span className={styles.predLabel}>Death Probability</span>
                <span className={styles.predValue}>{(prediction.deathProbability * 100).toFixed(1)}%</span>
              </div>
            </div>
            <div className={styles.predNote}>
              <strong>Decision Support Note:</strong> {prediction.note}
            </div>
          </div>
        )}

        {/* Previous Admissions */}
        <button className={styles.prevBtn} onClick={handleViewPrevious} disabled={prevLoading}>
          {prevLoading ? '⏳ Loading…' : prevAdmissions !== null ? '▲ Hide Previous Admissions' : '📋 View Previous Admissions'}
        </button>

        {prevAdmissions !== null && (
          <div className={styles.prevList}>
            {prevAdmissions.length === 0 ? (
              <p className={styles.prevEmpty}>No previous admissions found for this patient.</p>
            ) : (
              prevAdmissions.map((a) => (
                <div
                  key={a.admissionId}
                  className={styles.prevItem}
                  onClick={() => onSelectAdmission(a)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onSelectAdmission(a)}
                >
                  <div>
                    <span className={styles.prevAdmId}>{a.admissionId}</span>
                    {a.admissionId === admission.admissionId && (
                      <span className={styles.currentBadge}> current</span>
                    )}
                  </div>
                  <span className={styles.prevDate}>{formatDateTime(a.admissionDateTime)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
