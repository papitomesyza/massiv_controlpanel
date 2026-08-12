import React from 'react';
import { Camera, Clapperboard } from 'lucide-react';
import { ToolCard, ToolCardGrid } from '../components/ToolCards';

// Tools → Pitches. A card grid of pitch builders; Photography opens the
// existing pitch list untouched at /pitches/photography.
export default function Pitches() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Pitches</h1>
        <p className="page-subtitle">Client-facing decks, by discipline.</p>
      </div>

      <ToolCardGrid>
        <ToolCard
          icon={Camera}
          title="Photography"
          description="Photography concept decks with a public client link."
          to="/pitches/photography"
        />
        <ToolCard
          icon={Clapperboard}
          title="Director Treatments"
          description="Film treatments with references and a shooting approach."
          badge="Coming later"
          disabled
        />
      </ToolCardGrid>
    </div>
  );
}
