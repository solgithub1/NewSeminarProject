import { MemoryRouter } from 'react-router-dom';
import { Clinical } from "./clinical.js";
    
export const ClinicalBasic = () => {
  return (
    <MemoryRouter>
      <Clinical />
    </MemoryRouter>
  );
}