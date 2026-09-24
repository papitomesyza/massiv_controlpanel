import React from 'react';
import { Camera, Clapperboard } from 'lucide-react';
import { ToolCard, ToolCardGrid } from '../components/ToolCards';

// Tools, Pitches. A card grid of pitch builders; Photography opens the pitch
// list at /pitches/photography. Director Treatments is not built yet, so its
// card stays visible but disabled.
export default function Pitches() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Pitches</h1>
      </div>

      <ToolCardGrid>
        <ToolCard icon={Camera} title="Photography" to="/pitches/photography" />
        <ToolCard icon={Clapperboard} title="Director Treatments" disabled />
      </ToolCardGrid>
    </div>
  );
}
