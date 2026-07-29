// Single source of truth for section labels, shared by the editor's add-section
// picker and the "use template" section chooser so the two never drift.

export const SECTION_LABELS = {
  hero: 'Hero',
  statement: 'Statement',
  full_image: 'Full Image',
  image_grid: 'Image Grid',
  split: 'Split',
  moodboard: 'Moodboard',
  deliverables: 'Deliverables',
  crew: 'Crew',
  cta: 'Call to Action',
  social_post: 'Social Post',
};

// One-line description of what a section actually holds, so a picker row is
// distinguishable from the three others of the same type.
export function sectionSummary(type, content) {
  const c = content || {};
  const clip = (s, n = 70) => {
    const t = String(s || '').trim().replace(/\s+/g, ' ');
    return t.length > n ? `${t.slice(0, n)}…` : t;
  };
  const count = arr => (Array.isArray(arr) ? arr.length : 0);

  switch (type) {
    case 'hero':
      return clip(c.title) || clip(c.subtitle) || 'Opening title';
    case 'statement':
      return clip(c.text) || 'One big sentence';
    case 'full_image':
      return clip(c.caption) || 'Full-bleed image';
    case 'image_grid':
      return `${count(c.images)} image${count(c.images) === 1 ? '' : 's'}, ${c.columns || 3} columns`;
    case 'split':
      return clip(c.heading) || clip(c.body) || 'Image beside text';
    case 'moodboard':
      return clip(c.note) || `${count(c.images)} references`;
    case 'deliverables':
      return `${clip(c.heading, 40) || 'Deliverables'} · ${count(c.items)} item${count(c.items) === 1 ? '' : 's'}`;
    case 'crew':
      return `${clip(c.heading, 40) || 'Crew'} · ${count(c.members)} member${count(c.members) === 1 ? '' : 's'}`;
    case 'cta':
      return clip(c.heading) || 'Closing call to action';
    case 'social_post':
      return `${c.platform === 'facebook' ? 'Facebook' : 'Instagram'} post${c.handle ? ` · ${clip(c.handle, 24)}` : ''}`;
    default:
      return '';
  }
}
