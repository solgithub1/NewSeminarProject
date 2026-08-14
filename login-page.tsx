import { useState, type FormEvent } from 'react';
import { ensureAuthenticated } from './firebase.js';
import { useNavigate } from 'react-router-dom';
import { verifyDoctor } from './patients-service.js';
import styles from './login-page.module.css';

const DOCTORS_IMG =
  'https://storage.googleapis.com/bit-generated-images/images/image_flat_vector_illustration_of_a__0_1781535276029.png';
const CLIPBOARD_IMG =
  'https://storage.googleapis.com/bit-generated-images/images/image_flat_icon_of_a_medical_clipboa_0_1781535333331.png';

/**
 * Login screen for the Clinical Patient Analysis System.
 * Collects a doctor's full name and 9-digit ID and verifies them against the
 * Firestore "doctors" collection before allowing access to the registry.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // The form is valid once a name is present and the ID is exactly 9 digits.
  const isValid = fullName.trim().length > 0 && /^\d{9}$/.test(doctorId);

  /**
   * Restricts the Doctor ID input to digits only, max 9 characters.
   * @param value - the raw input value.
   */
  const handleDoctorIdChange = (value: string) => {
    const digitsOnly = value.replace(/\D/g, '').slice(0, 9);
    setDoctorId(digitsOnly);
  };

  /**
   * Validates the doctor against Firestore and navigates on success.
   * @param e - the form submit event.
   */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValid || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      // Authenticate anonymously with Firebase BEFORE reading the protected
      // Doctors collection — required now that Firestore rules require auth.
      await ensureAuthenticated();

      const exists = await verifyDoctor(fullName.trim(), doctorId);

      if (exists) {
        navigate('/patients');
      } else {
        setError('Doctor not found. Please check your name and ID.');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Login check failed:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Clinical Patient Analysis System</h1>

        <div className={styles.body}>
          <div className={styles.illustration}>
            <img src={DOCTORS_IMG} alt="Medical team" />
          </div>

          <form className={styles.formArea} onSubmit={handleSubmit}>
            <h2 className={styles.welcome}>WELCOME BACK!</h2>

            <input
              className={styles.input}
              type="text"
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <input
              className={styles.input}
              type="text"
              inputMode="numeric"
              placeholder="ID"
              value={doctorId}
              onChange={(e) => handleDoctorIdChange(e.target.value)}
            />

            {error && <p className={styles.error}>{error}</p>}

            <button
              className={styles.loginButton}
              type="submit"
              disabled={!isValid || submitting}
            >
              {submitting ? 'Checking…' : 'Login'}
            </button>
          </form>
        </div>

        <div className={styles.footer}>
          <img src={CLIPBOARD_IMG} alt="Patient data and predictions" />
          <p className={styles.footerText}>
            Login to view patient
            <br />
            data and predictions
          </p>
        </div>
      </div>
    </div>
  );
}
