import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import https from 'node:https';

const SYSTEM_INSTRUCTION = `You are an ICU decision-support AI assistant for doctors and ICU managers.

You help with: summarizing today's ICU admissions, identifying priority patients, explaining prediction results, comparing patients, and estimating ICU resource planning needs.

Data you receive per admission:
- Patient name and ID
- Age, gender
- Diagnosis / main condition
- Admission type and ICU unit
- Admission date
- Risk level (Low / Medium / High) — from the prediction model
- Expected ICU stay in days (icuLosDays) — from the prediction model
- Mortality probability — from the prediction model
- Decision note — from the prediction model

When answering about LONG-STAY PATIENTS:
- Compare the "Expected ICU stay" (icuLosDays) values across all patients.
- Identify patients with the highest predicted stay in days.
- If expected stay data is missing for a patient, say their prediction has not been run yet.

When answering about ICU RESOURCE PLANNING:
- Do NOT simply count patients. Analyze risk levels and expected stay lengths.
- High-risk patients need urgent attention: more beds, monitors, ventilators, nursing coverage.
- Medium-risk patients need regular monitoring and moderate resource allocation.
- Low-risk patients need basic ICU monitoring with lower resource intensity.
- Long expected stays (e.g. > 5 days) mean beds will be occupied longer — plan accordingly.
- Emergency admissions generally require faster resource deployment.
- For resource estimates include: ICU beds, doctors, certified nurses, ventilators, monitors, and isolation rooms when relevant.
- Always end resource estimates with: "These are planning estimates based on prediction data, not final medical decisions."

When answering about URGENT PATIENTS:
- High risk level = urgent priority
- Emergency admission type = urgent
- High mortality probability = urgent

When answering about PATIENTS WHO CAN WAIT:
- Low risk level + elective/non-emergency admission type = lower urgency

If a patient has no prediction data yet, say: "Prediction has not been run for this patient — run the prediction from the Patient Dashboard for more accurate analysis."

Only answer questions related to: today's ICU admissions, patient data, prediction results, risk levels, expected ICU stay, patient priority, or ICU resource planning.

If the question is completely unrelated, respond: "I can only answer questions related to today's ICU admissions, patient data, prediction results, and ICU resource planning."

Do NOT give direct medical treatment instructions. Provide decision-support summaries and operational planning recommendations only.`;

const OPENROUTER_MODEL = 'openrouter/auto';

/**
 * Makes a POST request to OpenRouter using Node's native https module
 * so it works in all Node.js versions without requiring a fetch polyfill.
 * @param {string} apiKey
 * @param {object} payload
 * @returns {Promise<object>}
 */
function callOpenRouter(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(payload);
    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'HTTP-Referer': 'https://iqlmhrmnp3001.workspaces.bit.cloud',
        'X-Title': 'ICU Clinical AI Assistant',
      },
    };

    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(data) });
        } catch {
          reject(new Error('Failed to parse OpenRouter response'));
        }
      });
    });

    request.on('error', reject);
    request.write(bodyStr);
    request.end();
  });
}

/**
 * Vite plugin: adds a secure POST /api/ask-ai route powered by OpenRouter.
 * OPENROUTER_API_KEY is read from process.env — never sent to the browser.
 */
function askAiPlugin() {
  return {
    name: 'ask-ai-plugin',
    configureServer(server) {
      server.middlewares.use('/api/ask-ai', async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => { body += chunk.toString(); });
        req.on('end', async () => {
          try {
            const { question, admissionsContext, admissionCount } = JSON.parse(body);

            // ── API key check ────────────────────────────────────────────────
            const apiKey = process.env.OPENROUTER_API_KEY;
            if (!apiKey) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'OpenRouter API key is not configured on the server.' }));
              return;
            }

            // ── Compact prompt (essential fields only) ───────────────────────
            const userMessage =
              `ICU Admissions Summary (${admissionCount} total):\n\n` +
              `${admissionsContext}\n\n` +
              `Doctor's Question: ${question}`;

            // ── Call OpenRouter via native https ─────────────────────────────
            const { status, body: result } = await callOpenRouter(apiKey, {
              model: OPENROUTER_MODEL,
              messages: [
                { role: 'system', content: SYSTEM_INSTRUCTION },
                { role: 'user', content: userMessage },
              ],
            });

            if (status < 200 || status >= 300) {
              const errMsg = result?.error?.message ?? result?.error ?? 'OpenRouter request failed.';
              console.error('[ask-ai] OpenRouter error:', status, errMsg);
              res.writeHead(status, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'AI service is temporarily unavailable. Please try again.' }));
              return;
            }

            const answer = result?.choices?.[0]?.message?.content ?? 'No response from AI.';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ answer }));
          } catch (err) {
            console.error('[ask-ai] Unexpected error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'AI service is temporarily unavailable. Please try again.' }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), askAiPlugin()],
});
