import React from 'react';
import { Youtube, Film, Instagram, Music2, Globe, Twitter, Dribbble } from 'lucide-react';

// Where a saved link comes from, as one small glyph instead of a word. Shared
// by the Collection page and both public pages so a source reads the same
// everywhere. TikTok has no glyph of its own in the icon set, so it takes the
// music note; Vimeo takes the film strip.
const SOURCE = {
  youtube:   { Icon: Youtube,   title: 'YouTube' },
  vimeo:     { Icon: Film,      title: 'Vimeo' },
  instagram: { Icon: Instagram, title: 'Instagram' },
  tiktok:    { Icon: Music2,    title: 'TikTok' },
  twitter:   { Icon: Twitter,   title: 'X' },
  dribbble:  { Icon: Dribbble,  title: 'Dribbble' },
};

export function sourceTitle(source) {
  return (SOURCE[source] && SOURCE[source].title) || 'Web';
}

export default function SourceIcon({ source, size = 12, title, className = '', style }) {
  const { Icon } = SOURCE[source] || { Icon: Globe };
  const label = title || sourceTitle(source);
  return (
    <span className={`source-icon ${className}`} title={label} aria-label={label} style={style}>
      <Icon size={size} />
    </span>
  );
}
