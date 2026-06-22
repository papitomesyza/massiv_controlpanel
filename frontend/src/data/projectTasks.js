const TASKS = {
  'Music Video': {
    'Development': ["Director's Treatment", 'Treatment Approved', 'Budget Breakdown', 'Budget Approved', 'Concept Approval', 'Moodboard', 'Script/Storyboard'],
    'Pre-Production': ['Location Scouting', 'Casting', 'Costume Design', 'Makeup & Hair Planning', 'Scenography', 'Equipment Planning', 'Transportation Planning', 'Accommodation Planning', 'Crew Booking', 'Shot List'],
    'Production': (days) => {
      const t = ['Shoot Day 1'];
      for (let i = 2; i <= days; i++) t.push(`Shoot Day ${i}`);
      return [...t, 'Behind The Scenes', 'Equipment Pickup', 'Equipment Return'];
    },
    'Post-Production': ['Editing', 'Color Grading', 'VFX', 'Sound Design', 'Subtitles', 'Client Review', 'Final Delivery', 'Archive'],
  },
  'TV Commercial': {
    'Development': ["Director's Treatment", 'Treatment Approved', 'Budget Breakdown', 'Budget Approved', 'Brand Brief Review', 'Script', 'Storyboard', 'Client Concept Approval'],
    'Pre-Production': ['Location Scouting', 'Casting', 'Costume Design', 'Props Planning', 'Equipment Planning', 'Transportation', 'Accommodation', 'Crew Booking', 'Shot List'],
    'Production': (days) => {
      const t = ['Shoot Day 1'];
      for (let i = 2; i <= days; i++) t.push(`Shoot Day ${i}`);
      return [...t, 'B-Roll Day', 'Equipment Pickup', 'Equipment Return'];
    },
    'Post-Production': ['Offline Edit', 'Online Edit', 'Color Grading', 'Sound Mix', 'Graphics/Motion', 'Client Review', 'Broadcast Delivery', 'Archive'],
  },
  'Corporate Video / Brand Film': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Budget Approved', 'Treatment Approved', 'Script', 'Moodboard', 'Storyboard'],
    'Pre-Production': ['Location Scouting', 'Equipment Planning', 'Crew Booking', 'Transportation', 'Interview Setup Planning'],
    'Production': (days) => {
      const t = ['Shoot Day 1'];
      for (let i = 2; i <= days; i++) t.push(`Shoot Day ${i}`);
      return [...t, 'B-Roll', 'Equipment Pickup', 'Equipment Return'];
    },
    'Post-Production': ['Edit', 'Color Grade', 'Sound', 'Motion Graphics', 'Client Review', 'Delivery', 'Archive'],
  },
  'Documentary / Short Film': {
    'Development': ['Treatment', 'Treatment Approved', 'Budget Breakdown', 'Budget Approved', 'Research', 'Script', 'Moodboard'],
    'Pre-Production': ['Location Scouting', 'Casting', 'Equipment Planning', 'Crew Booking', 'Transportation', 'Accommodation'],
    'Production': (days) => {
      const t = [];
      for (let i = 1; i <= days; i++) t.push(`Shoot Day ${i}`);
      return [...t, 'B-Roll', 'Equipment Pickup', 'Equipment Return'];
    },
    'Post-Production': ['Assembly Cut', 'Rough Cut', 'Fine Cut', 'Color Grade', 'Sound Mix', 'Music Licensing', 'Client Review', 'Festival Delivery', 'Archive'],
  },
  'Social Media Video Content': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Budget Approved', 'Content Plan', 'Script/Shot List'],
    'Pre-Production': ['Location Scouting', 'Props', 'Equipment Planning', 'Crew Booking'],
    'Production': () => ['Shoot Day', 'Equipment Pickup', 'Equipment Return'],
    'Post-Production': ['Edit', 'Captions', 'Thumbnail Design', 'Client Review', 'Delivery'],
  },
  'Event Videography': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Budget Approved', 'Event Schedule Review', 'Shot List'],
    'Pre-Production': ['Location Recce', 'Equipment Planning', 'Crew Booking', 'Transportation', 'Accommodation'],
    'Production': (days) => {
      const t = [];
      const cap = Math.min(days, 7);
      for (let i = 1; i <= cap; i++) t.push(`Coverage Day ${i}`);
      return [...t, 'Equipment Pickup', 'Equipment Return'];
    },
    'Post-Production': ['Edit', 'Color Grade', 'Sound', 'Client Review', 'Delivery', 'Archive'],
  },
  'Real Estate / Property Video': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Property Visit'],
    'Pre-Production': ['Shot List', 'Equipment Planning', 'Crew Booking'],
    'Production': () => ['Interior Shoot', 'Exterior Shoot', 'Drone Footage', 'Equipment Pickup', 'Equipment Return'],
    'Post-Production': ['Edit', 'Color Grade', 'Client Review', 'Delivery'],
  },
  'Product Demo Video': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Product Brief', 'Script'],
    'Pre-Production': ['Studio/Location Planning', 'Props', 'Equipment Planning', 'Crew Booking'],
    'Production': () => ['Product Shoot', 'Lifestyle Shoot', 'Equipment Pickup', 'Equipment Return'],
    'Post-Production': ['Edit', 'Motion Graphics', 'Sound', 'Client Review', 'Delivery'],
  },
  'Event Photography': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Event Schedule', 'Shot List'],
    'Pre-Production': ['Gear Preparation', 'Logistics Planning', 'Transportation', 'Accommodation', 'Crew Booking'],
    'Production': (days) => {
      const t = [];
      const cap = Math.min(days, 7);
      for (let i = 1; i <= cap; i++) t.push(`Coverage Day ${i}`);
      return [...t, 'Equipment Pickup', 'Equipment Return'];
    },
    'Post-Production': ['Selection/Culling', 'Retouching', 'Client Review', 'Delivery', 'Archive'],
  },
  'Portrait / Editorial Photography': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Moodboard', 'Concept Approval'],
    'Pre-Production': ['Location Scouting', 'Casting', 'Styling', 'Makeup & Hair Planning', 'Equipment Planning', 'Crew Booking'],
    'Production': () => ['Shoot Day', 'Equipment Pickup', 'Equipment Return'],
    'Post-Production': ['Selection/Culling', 'Retouching', 'Client Review', 'Delivery'],
  },
  'Commercial / Product Photography': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Product Brief', 'Moodboard'],
    'Pre-Production': ['Studio Booking', 'Props', 'Styling', 'Equipment Planning', 'Crew Booking'],
    'Production': () => ['Product Shoot', 'Lifestyle Shoot', 'Equipment Pickup', 'Equipment Return'],
    'Post-Production': ['Selection/Culling', 'Retouching', 'Client Review', 'Delivery'],
  },
  'Real Estate Photography': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Property Visit'],
    'Pre-Production': ['Equipment Planning', 'Crew Booking'],
    'Production': () => ['Interior Shoot', 'Exterior Shoot', 'Drone Photography', 'Equipment Pickup', 'Equipment Return'],
    'Post-Production': ['Selection/Culling', 'Retouching', 'Client Review', 'Delivery'],
  },
  'Fashion Photography': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Moodboard', 'Concept Approval'],
    'Pre-Production': ['Location Scouting', 'Casting', 'Styling', 'Makeup & Hair Planning', 'Equipment Planning', 'Crew Booking'],
    'Production': () => ['Shoot Day', 'Equipment Pickup', 'Equipment Return'],
    'Post-Production': ['Selection/Culling', 'Retouching', 'Client Review', 'Delivery'],
  },
  'Photo Retouching': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Reference / Style Review'],
    'Pre-Production': ['Files Acceptance', 'Culling / Selection', 'Scope Agreement'],
    'Production': () => [],
    'Post-Production': ['RAW Processing', 'Exposure & White Balance', 'Cleanup / Object Removal', 'Skin Retouching', 'Frequency Separation', 'Dodge & Burn', 'Color Correction', 'Sharpening', 'Client Review', 'Revisions', 'Final Export', 'Delivery'],
  },
  'Photo Editing & Culling': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Style Reference'],
    'Pre-Production': ['Files Acceptance', 'Backup / Ingest'],
    'Production': () => [],
    'Post-Production': ['Culling / Selection', 'RAW Processing', 'Exposure & Color', 'Crop & Straighten', 'Batch Sync', 'Spot Removal', 'Export Presets', 'Client Gallery', 'Delivery'],
  },
  'Video Editing': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Footage Review', 'Edit Brief Approval'],
    'Pre-Production': ['Project Setup', 'Media Ingest / Backup', 'Folder Structure'],
    'Production': () => [],
    'Post-Production': ['Assembly Cut', 'Rough Cut', 'Fine Cut', 'Color Grade', 'Sound', 'Client Review', 'Revisions', 'Delivery'],
  },
  'Color Grading': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Reference Grade Review'],
    'Pre-Production': ['Files Acceptance', 'Conform / Project Setup', "Client's Brief"],
    'Production': () => [],
    'Post-Production': ['Primary Grade', 'Secondary Grade', 'Shot Matching', 'Look Development', 'Client Review', 'Grade Revisions', 'Final Render', 'Delivery'],
  },
  'VFX / Motion Graphics': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Reference Collection', 'Concept Approval'],
    'Pre-Production': ['Project Setup', 'Asset Collection', 'Style Frames', 'Timeline Planning'],
    'Production': () => [],
    'Post-Production': ['VFX/Motion Build', 'Animation Pass', 'Compositing', 'Sound Design', 'Client Review', 'Revisions', 'Final Export', 'Delivery'],
  },
  'Audio Mixing & Mastering': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Reference Tracks'],
    'Pre-Production': ['Files Acceptance', 'Session Setup', 'Stem Organization'],
    'Production': () => [],
    'Post-Production': ['Editing / Comping', 'Noise Reduction', 'Mixing', 'EQ & Compression', 'Automation', 'Mastering', 'Loudness Check', 'Client Review', 'Revisions', 'Final Export', 'Delivery'],
  },
  'Subtitling & Localization': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Source Material Review'],
    'Pre-Production': ['Files Acceptance', 'Transcription', 'Glossary / Style Guide'],
    'Production': () => [],
    'Post-Production': ['Translation', 'Timing / Spotting', 'Subtitle Formatting', 'QC Review', 'Client Review', 'Revisions', 'Final Export (SRT/Burned-in)', 'Delivery'],
  },
  'Podcast / Audio Production': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Episode Plan'],
    'Pre-Production': ['Studio Booking', 'Guest Scheduling', 'Equipment Planning'],
    'Production': () => ['Recording Session'],
    'Post-Production': ['Edit', 'Mix', 'Master', 'Show Notes', 'Client Review', 'Delivery'],
  },
  'Branding & Identity': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Research', 'Competitor Analysis', 'Moodboard'],
    'Pre-Production': ['Concept Development', 'Brand Strategy', 'Naming / Tagline (if needed)'],
    'Production': () => ['Logo Design', 'Color Palette', 'Typography', 'Brand Guidelines', 'Mockups'],
    'Post-Production': ['Client Review', 'Revisions', 'Brand Book', 'Final Files Export', 'Brand Book Delivery'],
  },
  'Social Media Content Management': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Content Strategy', 'Platform Audit'],
    'Pre-Production': ['Content Calendar', 'Caption Templates', 'Visual Style Guide'],
    'Production': () => ['Content Creation (Month 1)'],
    'Post-Production': ['Analytics Review', 'Report Delivery'],
  },
  'Graphic Design': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Reference Collection', 'Competitor Analysis'],
    'Pre-Production': ['Concept Sketches', 'Moodboard', 'Design Direction Approval'],
    'Production': () => ['Design Execution', 'Design Variations'],
    'Post-Production': ['Client Review', 'Revisions', 'Final Export', 'File Preparation', 'Delivery'],
  },
  'Web Design': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Sitemap', 'Wireframes', 'Reference Collection'],
    'Pre-Production': ['Design System', 'UI Design', 'Prototype / Clickable Mockup', 'Client Approval'],
    'Production': () => ['Development Handoff / Build', 'Responsive Testing'],
    'Post-Production': ['Client Review', 'Revisions', 'QA Testing', 'SEO Setup', 'Launch', 'Delivery'],
  },
  '2D / 3D Animation': {
    'Development': ['Brief Review', 'Budget Breakdown', 'Concept / Moodboard', 'Script / Storyboard', 'Style Frames'],
    'Pre-Production': ['Asset Collection', 'Character / Asset Design', 'Rigging / Setup', 'Animatic'],
    'Production': () => ['Layout / Blocking', 'Animation Pass', 'Modeling / Texturing'],
    'Post-Production': ['Lighting / Rendering', 'Compositing', 'Sound Design', 'Client Review', 'Revisions', 'Final Render', 'Delivery'],
  },
};

export function getTasksForCategory(categoryName, shootDays = 1) {
  const data = TASKS[categoryName];
  const empty = { 'Development': [], 'Pre-Production': [], 'Production': [], 'Post-Production': [] };
  if (!data) return empty;
  const resolve = (key) => {
    const v = data[key] || [];
    return typeof v === 'function' ? v(parseInt(shootDays) || 1) : v;
  };
  return {
    'Development': resolve('Development'),
    'Pre-Production': resolve('Pre-Production'),
    'Production': resolve('Production'),
    'Post-Production': resolve('Post-Production'),
  };
}
