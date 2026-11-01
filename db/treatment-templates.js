// The seeded Director Treatment template, inserted exactly once under its own
// guard key (pitches_treatment_templates_seeded) so it also lands on a database
// that was already seeded with the photography templates.
//
// A treatment is the deck that wins the job: the idea, the look, and how it
// gets made. Every section uses one of the ten existing types, so the treatments
// render through the same renderer as the photography pitches and need no new
// section code.

module.exports = [
  {
    title: 'Director Treatment',
    category: 'Commercial',
    accent_color: '#C7FF2E',
    kind: 'treatment',
    sections: [
      { type: 'hero', content: {
        eyebrow: 'Director’s Treatment',
        title: '[PROJECT]',
        subtitle: 'A film for [CLIENT]',
        image: '',
        overlay_strength: 60,
      }},
      { type: 'statement', content: {
        text: 'A commercial is thirty seconds of feeling. Everything else is craft in service of it.',
        alignment: 'center',
      }},
      { type: 'split', content: {
        image: '',
        heading: 'The Idea',
        body: 'This is the spine of the film, in one paragraph. What [CLIENT] actually needs to sell, and the single human truth we sell it with. Everything below is how that idea becomes pictures: the world, the look, and the mechanics of the shoot.',
        image_side: 'right',
      }},
      { type: 'moodboard', content: {
        images: [],
        note: 'References: light, palette, texture and movement. Not shots to copy, a direction to point the whole unit at.',
      }},
      { type: 'image_grid', content: {
        images: [],
        columns: 2,
        gap: 'tight',
      }},
      { type: 'full_image', content: {
        image: '',
        caption: 'The key frame the film hangs on',
      }},
      { type: 'split', content: {
        image: '',
        heading: 'Look & Feel',
        body: 'Format, lens, light and movement. How the camera behaves, what the grade does, and why each choice serves the idea. Written so the DP and the colourist can read the same page and agree.',
        image_side: 'left',
      }},
      { type: 'deliverables', content: {
        heading: 'What [CLIENT] receives',
        items: [
          { title: 'Master film', detail: '30s hero cut, graded and mixed' },
          { title: 'Cutdowns', detail: '15s and 6s versions for TV and paid social' },
          { title: 'Vertical edits', detail: '9:16 adaptations for stories and reels' },
          { title: 'Stills set', detail: 'Key frames from the shoot for print and social' },
        ],
      }},
      { type: 'crew', content: {
        heading: 'The team',
        members: [
          { role: 'Director', name: '' },
          { role: 'Producer', name: '' },
          { role: 'DOP', name: '' },
          { role: 'Production Designer', name: '' },
          { role: 'Editor', name: '' },
        ],
      }},
      { type: 'cta', content: {
        heading: 'Let’s make the film [PROJECT] deserves.',
        body: 'One idea, one clear look, a unit that has done this before. We are ready to shoot when [CLIENT] is.',
        show_agency_branding: true,
      }},
    ],
  },
];
