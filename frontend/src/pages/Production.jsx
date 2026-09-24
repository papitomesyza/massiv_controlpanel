import React from 'react';
import { ListVideo } from 'lucide-react';
import { ToolCard, ToolCardGrid } from '../components/ToolCards';

// Tools, Production. Same card grid as Pitches, with room for more production
// tools as they arrive.
export default function Production() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Production</h1>
      </div>

      <ToolCardGrid>
        <ToolCard icon={ListVideo} title="Shot Lists" to="/production/shotlists" />
      </ToolCardGrid>
    </div>
  );
}
