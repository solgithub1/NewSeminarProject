import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Admission } from './admission.js';
import { subscribeToAdmissions, updateAdmissionPrediction } from './admissions-service.js';
import { runPrediction } from './prediction-service.js';
import styles from './ask-ai-page.module.css';

/** Quick questions covering both doctors and ICU managers. */
const QUICK_QUESTIONS = [
  "Summarize today's ICU admissions",
  'Which patients are highest risk today?',
  'Which patients need urgent ICU resources today?',
  'Which patients can wait?',
  'How many ICU resources should we prepare today?',
  'Which patients are expected to stay longer?',
];

/**
 * Full prompt sent when the "planning summary" button is clicked.
 */
const PLANNING_SUMMARY_PROMPT =
  "Give me today's ICU planning summary: identify the highest-risk patients, urgent patients, patients who can wait, expected long-stay patients, and estimate the ICU resources needed today including beds, doctors, certified nurses, ventilators, and monitors.";

type ResponseState =
  | { status: 'idle' }
  | { status: 'preparing'; message: string }
  | { status: 'loading' }
  | { status: 'success'; text: string; question: string; timestamp: Date }
  | { status: 'error'; message: string };

/** Returns true if an admission arrived today (local date). */
function isToday(admission: Admission): boolean {
  if (!admission.admissionDateTime) return false;
  const admDate = new Date(admission.admissionDateTime);
  const now = new Date();
  return (
    admDate.getFullYear() === now.getFullYear() &&
    admDate.getMonth() === now.getMonth() &&
    admDate.getDate() === now.getDate()
  );
}

/** Returns true if this admission already has prediction results saved. */
function hasPrediction(a: Admission): boolean {
  return !!a.riskLevel && a.icuLosDays != null;
}

/**
 * Builds a rich context block for today's admissions.
 * Every admission should already have prediction data filled in by this point.
 */
function buildAdmissionContext(admissions: Admission[]): string {
  if (admissions.length === 0) return 'No admissions recorded yet.';

  const header = `Today's ICU Admissions: ${admissions.length} total.`;

  const lines = admissions.map((a, i) => {
    const parts: string[] = [
      `Patient ${i + 1}: ${a.fullName ?? 'Unknown'} (ID: ${a.subjectId ?? 'N/A'})`,
    ];
    if (a.age != null)            parts.push(`Age: ${a.age} years`);
    if (a.gender)                 parts.push(`Gender: ${a.gender}`);
    if (a.mainDiagnosis)          parts.push(`Diagnosis: ${a.mainDiagnosis}`);
    const otherDx = (a.otherDiagnoses ?? a.diagnoses ?? []).filter(Boolean);
    if (otherDx.length)           parts.push(`Other diagnoses: ${otherDx.join(', ')}`);
    if (a.admissionType)          parts.push(`Admission type: ${a.admissionType}`);
    if (a.icuUnit)                parts.push(`ICU unit: ${a.icuUnit}`);
    if (a.admissionDateTime)      parts.push(`Admitted: ${new Date(a.admissionDateTime).toLocaleDateString('en-GB')}`);

    // Prediction fields
    if (a.riskLevel)              parts.push(`Risk level: ${a.riskLevel}`);
    if (a.icuLosDays != null)     parts.push(`Expected ICU stay: ${a.icuLosDays.toFixed(1)} days`);
    if (a.deathProbability != null) {
      parts.push(`Mortality probability: ${(a.deathProbability * 100).toFixed(1)}%`);
    }
    if (a.decisionNote)           parts.push(`Decision note: ${a.decisionNote}`);
    if (!hasPrediction(a))        parts.push(`Prediction: unavailable (API unreachable at time of query)`);

    return parts.join(' | ');
  });

  return header + '\n\n' + lines.join('\n\n');
}

/**
 * Runs prediction for one admission that is missing prediction data,
 * saves the result back to Firestore, and returns the enriched admission.
 * Returns the original admission (with a flag) if the API fails.
 */
async function runAndSavePrediction(admission: Admission): Promise<Admission> {
  try {
    const result = await runPrediction(admission);
    await updateAdmissionPrediction(admission.admissionId, {
      riskLevel: result.riskLevel,
      icuLosDays: result.icuLosDays,
      deathProbability: result.deathProbability,
      decisionNote: result.note,
    });
    // Return enriched copy so we can build context immediately
    return {
      ...admission,
      riskLevel: result.riskLevel,
      icuLosDays: result.icuLosDays,
      deathProbability: result.deathProbability,
      decisionNote: result.note,
    };
  } catch {
    // Prediction API unavailable — return original admission unchanged
    return admission;
  }
}

/**
 * Ensures all of today's admissions have prediction data.
 * Runs predictions in parallel for any that are missing them.
 * Reports progress via the `onProgress` callback.
 *
 * @param todayAdmissions - admissions from today's date.
 * @param onProgress - called with a status string during processing.
 * @returns enriched admissions list.
 */
async function ensurePredictions(
  todayAdmissions: Admission[],
  onProgress: (msg: string) => void
): Promise<Admission[]> {
  const missing = todayAdmissions.filter((a) => !hasPrediction(a));

  if (missing.length === 0) return todayAdmissions;

  onProgress(
    `Checking today's admissions and generating missing predictions… (${missing.length} remaining)`
  );

  // Run all missing predictions in parallel
  const enrichedMissing = await Promise.all(missing.map(runAndSavePrediction));

  // Merge enriched back into the full list
  const enrichedMap = new Map(enrichedMissing.map((a) => [a.admissionId, a]));
  return todayAdmissions.map((a) => enrichedMap.get(a.admissionId) ?? a);
}

/**
 * Ask AI Assistant page — auto-generates missing predictions before calling OpenRouter.
 * The OPENROUTER_API_KEY is never exposed in frontend code.
 */
export function AskAiPage() {
  const navigate = useNavigate();
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState<ResponseState>({ status: 'idle' });
  const responseRef = useRef<HTMLDivElement>(null);

  // Live admissions from Firestore
  useEffect(() => {
    return subscribeToAdmissions((list) => setAdmissions(list));
  }, []);

  // Auto-scroll when result arrives
  useEffect(() => {
    if (response.status === 'success' || response.status === 'error') {
      responseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [response.status]);

  const isBusy =
    response.status === 'loading' || response.status === 'preparing';

  /**
   * Full pipeline:
   * 1. Auto-run predictions for any today admissions that are missing them.
   * 2. Build full context.
   * 3. Call /api/ask-ai (OpenRouter via backend).
   */
  const submit = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || isBusy) return;

    // Step 1 — auto-predict missing admissions
    setResponse({ status: 'preparing', message: "Checking today's admissions…" });

    const todayList = admissions.filter(isToday);
    let enrichedToday: Admission[];

    try {
      enrichedToday = await ensurePredictions(todayList, (msg) =>
        setResponse({ status: 'preparing', message: msg })
      );
    } catch {
      enrichedToday = todayList; // fall back to whatever we have
    }

    // Step 2 — call OpenRouter
    setResponse({ status: 'loading' });

    try {
      const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
      const res = await fetch(`${apiBaseUrl}/api/ask-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          admissionsContext: buildAdmissionContext(enrichedToday),
          admissionCount: enrichedToday.length,
        }),
      });

      const data = (await res.json()) as { answer?: string; error?: string };

      if (!res.ok || data.error) {
        setResponse({
          status: 'error',
          message: data.error ?? 'AI service is temporarily unavailable. Please try again.',
        });
      } else {
        setResponse({
          status: 'success',
          text: data.answer ?? '',
          question: trimmed,
          timestamp: new Date(),
        });
      }
    } catch {
      setResponse({
        status: 'error',
        message: 'Could not reach the AI assistant. Please check your connection.',
      });
    }
  };

  const handleQuick = (q: string) => {
    setQuestion(q);
    submit(q);
  };

  const handleSubmit = () => submit(question);

  return (
    <div className={styles.page}>
      {/* Back button */}
      <button className={styles.backBtn} onClick={() => navigate('/patients')}>
        ← Go Back
      </button>

      <h1 className={styles.heading}>Ask AI Assistant</h1>
      <p className={styles.subHeading}>
        Ask questions about today's ICU admissions and prediction results.
      </p>

      <div className={styles.card}>
        {/* Quick questions */}
        <p className={styles.quickLabel}>Quick Questions</p>
        <div className={styles.quickBtns}>
          {QUICK_QUESTIONS.map((q) => (
            <button
              key={q}
              className={styles.quickBtn}
              onClick={() => handleQuick(q)}
              disabled={isBusy}
            >
              {q}
            </button>
          ))}
        </div>

        {/* Planning summary — full-width highlighted button */}
        <button
          className={styles.planningBtn}
          onClick={() => handleQuick(PLANNING_SUMMARY_PROMPT)}
          disabled={isBusy}
        >
          📋 Give me today's ICU planning summary
        </button>

        {/* Custom input */}
        <label className={styles.inputLabel}>Your Question</label>
        <div className={styles.inputRow}>
          <textarea
            className={styles.textarea}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Which patient has the highest mortality risk today?"
            disabled={isBusy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            rows={2}
          />
          <button
            className={styles.askBtn}
            onClick={handleSubmit}
            disabled={isBusy || !question.trim()}
          >
            Ask AI
          </button>
        </div>

        <hr className={styles.divider} />

        {/* Response area */}
        <div className={styles.responseArea} ref={responseRef}>
          <p className={styles.responseLabel}>🧠 AI Response</p>

          {response.status === 'idle' && (
            <p className={styles.placeholderBox}>
              Select a quick question or type your own to get started.
            </p>
          )}

          {response.status === 'preparing' && (
            <div className={styles.loadingBox}>
              <div className={styles.spinner} />
              <span>{response.message}</span>
            </div>
          )}

          {response.status === 'loading' && (
            <div className={styles.loadingBox}>
              <div className={styles.spinner} />
              Analyzing today's ICU data and generating AI response…
            </div>
          )}

          {response.status === 'error' && (
            <div className={styles.errorBox}>{response.message}</div>
          )}

          {response.status === 'success' && (
            <>
              <div className={styles.responseBox}>{response.text}</div>
              <p className={styles.responseMeta}>
                Asked: &quot;{response.question}&quot; · {response.timestamp.toLocaleTimeString('en-GB')}
              </p>
              <p className={styles.disclaimer}>
                ⚠️ Resource estimates are planning suggestions based on prediction data, not final medical decisions.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
