import React from 'react';
import { Camera, Clapperboard } from 'lucide-react';
import { ToolCard, ToolCardGrid } from '../components/ToolCards';

// Tools, Pitches. A card grid of pitch builders: Photography and the Director
// Treatments built beside it. Both open the same kind of list and the same
// editor; a treatment adds the PDF export and a passcode window the First AD
// can write in.
export default function Pitches() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Pitches</h1>
      </div>

      <ToolCardGrid>
        <ToolCard icon={Camera} title="Photography" to="/pitches/photography" />
        <ToolCard icon={Clapperboard} title="Director Treatments" to="/pitches/treatments" />
      </ToolCardGrid>
    </div>
  );
}
