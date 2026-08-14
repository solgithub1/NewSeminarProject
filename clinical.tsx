import { Routes, Route } from 'react-router-dom';
import { LoginPage } from './login-page.js';
import { PatientRegistryPage } from './patient-registry-page.js';
import { AskAiPage } from './ask-ai-page.js';

export function Clinical() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/patients" element={<PatientRegistryPage />} />
      <Route path="/ask-ai" element={<AskAiPage />} />
    </Routes>
  );
}
