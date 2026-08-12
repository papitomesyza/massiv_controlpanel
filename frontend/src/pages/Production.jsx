import React from 'react';
import { ListVideo } from 'lucide-react';
import { ToolCard, ToolCardGrid } from '../components/ToolCards';

// Tools → Production. Same card grid pattern as Pitches, with room for more
// production tools as they arrive.
export default function Production() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Production</h1>
        <p className="page-subtitle">Tools for the shoot day itself.</p>
      </div>

      <ToolCardGrid>
        <ToolCard
          icon={ListVideo}
          title="Shot Lists"
          description="Plan the day, pin locations, publish a call sheet the crew can tick off."
          to="/production/shotlists"
        />
      </ToolCardGrid>
    </div>
  );
}
