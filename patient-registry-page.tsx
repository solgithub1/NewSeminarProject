import { useState, useMemo, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import type { Admission } from './admission.js';
import { AddAdmissionModal } from './add-admission-modal.js';
import { PatientDashboard } from './patient-dashboard.js';
import { subscribeToAdmissions, saveAdmission } from './admissions-service.js';
import styles from './patient-registry-page.module.css';

/** Default avatar SVG used on every patient card. */
function AvatarIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="#f0f0f0" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="24" r="13" />
      <path d="M32 40c-12 0-22 7-22 16v8h44v-8c0-9-10-16-22-16z" />
    </svg>
  );
}

/**
 * Patient Registry — horizontal scrollable row of patient cards with live
 * Firestore sync, search by name or Patient ID, and action buttons.
 */
export function PatientRegistryPage() {
  const navigate = useNavigate();
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [query, setQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<Admission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsubscribe = subscribeToAdmissions(
      (list) => { setAdmissions(list); setLoading(false); },
      (err) => {
        setError('Failed to load admissions. Please try again.');
        setLoading(false);
        // eslint-disable-next-line no-console
        console.error('Firestore error:', err);
      }
    );
    return () => unsubscribe();
  }, []);

  // Search by full name (partial) or Patient ID (partial)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return admissions;
    return admissions.filter(
      (a) =>
        a.fullName.toLowerCase().includes(q) ||
        a.subjectId.toLowerCase().includes(q)
    );
  }, [admissions, query]);

  const handleSave = async (admission: Admission) => {
    await saveAdmission(admission);
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Patient Registry Interface</h1>

      <div className={styles.searchWrap}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            className={styles.searchInput}
            placeholder="Search by name or Patient ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Horizontal scroll row of patient cards */}
      <div className={styles.listWrap}>
        {loading ? (
          <div className={styles.emptyState}>Loading admissions…</div>
        ) : error ? (
          <div className={styles.emptyState}>{error}</div>
        ) : admissions.length === 0 ? (
          <div className={styles.emptyState}>
            No patients registered yet. Click <strong>+ Add New Admission</strong> to create one.
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            No patients match &quot;{query}&quot;.
          </div>
        ) : (
          <div className={styles.cardRow}>
            {filtered.map((a, i) => (
              <div
                className={styles.card}
                key={`${a.admissionId}-${i}`}
                onClick={() => setSelected(a)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setSelected(a)}
              >
                <div className={styles.avatar}><AvatarIcon /></div>
                <p className={styles.cardName}>{a.fullName}</p>
                <p className={styles.cardId}>ID: {a.subjectId}</p>
                {a.icuUnit && <span className={styles.cardBadge}>{a.icuUnit}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action buttons — vertical stack on the right, logout bottom-right */}
      <div className={styles.bottomBar}>
        <div className={styles.actionBtns}>
          <button className={styles.addButton} onClick={() => setShowModal(true)}>
            + Add New Admission
          </button>
          <Link to="/ask-ai" className={styles.aiButton}>
            🧠 Ask AI Assistant
          </Link>
        </div>

        <button className={styles.logoutButton} onClick={() => navigate('/')}>
          🔒 Log Out
        </button>
      </div>

      {showModal && (
        <AddAdmissionModal onSave={handleSave} onClose={() => setShowModal(false)} />
      )}

      {selected && (
        <PatientDashboard
          admission={selected}
          onClose={() => setSelected(null)}
          onSelectAdmission={setSelected}
        />
      )}
    </div>
  );
}
