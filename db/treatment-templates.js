// The seeded Director Treatment templates.
//
// Six looks, not one. Each is a whole deck skeleton: the same section types the
// panel already writes, plus a theme (lib/deck.js) that decides the palette and
// the display type. Frameset's gallery is the shape we copied: pick a look, get
// a deck with the right slides in the right order, then fill it with our own
// frames. Titles, wording and structure are ours, from treatments MASSIV has
// actually sold.
//
// Seeded exactly once under key pitches_treatment_templates_v2. The v1 template
// (a single generic 'Director Treatment') is removed by the same migration that
// inserts these, so the gallery does not carry a page nobody will use.
//
// Placeholders are deliberate: [PROJECT] and [CLIENT] are what Andi retypes on
// every job, and the empty image fields are the frames he drops stills into.

module.exports = [
  {
    title: 'MSSV Noir',
    category: 'Commercial',
    accent_color: '#C7FF2E',
    theme: 'noir',
    kind: 'treatment',
    sections: [
      { type: 'hero', content: {
        eyebrow: 'Director’s Treatment',
        title: '[PROJECT]',
        subtitle: 'A film for [CLIENT]',
        image: '',
      }},
      { type: 'statement', content: {
        text: 'A commercial is thirty seconds of feeling. Everything else is craft in service of it.',
        alignment: 'left',
      }},
      { type: 'split', content: {
        image: '',
        heading: 'The Idea',
        body: 'The spine of the film, in one paragraph. What [CLIENT] actually needs to sell, and the single human truth we sell it with. Everything below is how that idea becomes pictures.',
        image_side: 'right',
      }},
      { type: 'moodboard', content: {
        images: [],
        note: 'References: light, palette, texture, movement. Not shots to copy, a direction to point the whole unit at.',
      }},
      { type: 'full_image', content: {
        image: '',
        caption: 'The key frame the film hangs on',
      }},
      { type: 'split', content: {
        image: '',
        heading: 'Look & Feel',
        body: 'Format, lens, light and movement. How the camera behaves, what the grade does, and why each choice serves the idea. Written so the DP and the colourist read the same page and agree.',
        image_side: 'left',
      }},
      { type: 'image_grid', content: {
        images: [],
        columns: 3,
        gap: 'normal',
      }},
      { type: 'deliverables', content: {
        heading: 'What [CLIENT] receives',
        items: [
          { title: 'Master film', detail: '30s hero cut, graded and mixed' },
          { title: 'Cutdowns', detail: '15s and 6s for TV and paid social' },
          { title: 'Vertical edits', detail: '9:16 adaptations for stories and reels' },
          { title: 'Stills set', detail: 'Key frames from the shoot for print and social' },
        ],
      }},
      { type: 'crew', content: {
        heading: 'The team',
        members: [
          { role: 'Director', name: 'Andi Degani' },
          { role: 'Producer', name: '' },
          { role: 'DOP', name: '' },
          { role: 'Production Designer', name: '' },
        ],
      }},
      { type: 'cta', content: {
        heading: 'Let’s make the film [PROJECT] deserves.',
        body: 'One idea, one clear look, a unit that has done this before. We are ready to shoot when [CLIENT] is.',
        show_agency_branding: true,
      }},
    ],
  },

  {
    title: 'Shopping Fest',
    category: 'Retail Promo',
    accent_color: '#FF5A1F',
    theme: 'fest',
    kind: 'treatment',
    sections: [
      { type: 'hero', content: {
        eyebrow: 'TV Commercial + Social',
        title: '[PROJECT]',
        subtitle: 'A campaign for [CLIENT]',
        image: '',
      }},
      { type: 'statement', content: {
        text: 'One night, one street, every trolley in the city. Sell the feeling of the hunt, not the discount.',
        alignment: 'left',
      }},
      { type: 'split', content: {
        image: '',
        heading: 'The Story',
        body: 'Where we open, who we follow, how the night escalates. Written as the cut, beat by beat, so the client reads the film before it exists.',
        image_side: 'right',
      }},
      { type: 'image_grid', content: {
        images: [],
        columns: 3,
        gap: 'tight',
      }},
      { type: 'moodboard', content: {
        images: [],
        note: 'Practical light, handheld energy, faces we believe. Warm, loud, crowded: the mall as a night out.',
      }},
      { type: 'full_image', content: {
        image: '',
        caption: 'The frame we build the campaign around',
      }},
      { type: 'deliverables', content: {
        heading: 'Deliverables',
        items: [
          { title: '30s hero TVC', detail: 'Broadcast master' },
          { title: '3 x 15s', detail: 'Day, night and offer cuts' },
          { title: 'Social bundle', detail: '9:16 reels plus statics' },
        ],
      }},
      { type: 'social_post', content: {
        platform: 'instagram',
        handle: '@[CLIENT]',
        caption: 'The doors open at six. Bring the list.',
        image: '',
      }},
      { type: 'crew', content: {
        heading: 'The team',
        members: [
          { role: 'Director', name: 'Andi Degani' },
          { role: 'DOP', name: '' },
          { role: 'Producer', name: '' },
        ],
      }},
      { type: 'cta', content: {
        heading: 'Book the night, we bring the crowd.',
        body: 'Two shoot days, one rig, one unit that has shot retail at speed before.',
        show_agency_branding: true,
      }},
    ],
  },

  {
    title: 'Bright Retail',
    category: 'FMCG / Retail',
    accent_color: '#1E5BFF',
    theme: 'hebs',
    kind: 'treatment',
    sections: [
      { type: 'hero', content: {
        eyebrow: 'Director’s Treatment',
        title: '[PROJECT]',
        subtitle: 'clean, bright, unmistakably [CLIENT]',
        image: '',
      }},
      { type: 'statement', content: {
        text: 'Product first, but never product only. One clear benefit, stated like a fact, framed like a poster.',
        alignment: 'left',
      }},
      { type: 'split', content: {
        image: '',
        heading: 'The Idea',
        body: 'The single line the whole campaign rests on, and the honest reason a customer would repeat it out loud.',
        image_side: 'right',
      }},
      { type: 'image_grid', content: {
        images: [],
        columns: 4,
        gap: 'tight',
      }},
      { type: 'deliverables', content: {
        heading: 'What you receive',
        items: [
          { title: '20s TVC', detail: 'Broadcast and online master' },
          { title: 'Vertical set', detail: '9:16 and 4:5 cutdowns' },
          { title: 'Key visuals', detail: 'Retouched stills for print and OOH' },
        ],
      }},
      { type: 'moodboard', content: {
        images: [],
        note: 'Daylight, clean surfaces, controlled palette. Every frame could be a poster on its own.',
      }},
      { type: 'crew', content: {
        heading: 'Key crew',
        members: [
          { role: 'Director', name: 'Andi Degani' },
          { role: 'DOP', name: '' },
          { role: 'Stylist', name: '' },
        ],
      }},
      { type: 'cta', content: {
        heading: 'Ready when the product ships.',
        body: 'Studio and location, one day each. Schedules and budget to follow on approval.',
        show_agency_branding: true,
      }},
    ],
  },

  {
    title: 'Reel',
    category: 'Music Video',
    accent_color: '#B14BFF',
    theme: 'reel',
    kind: 'treatment',
    sections: [
      { type: 'hero', content: {
        eyebrow: 'Music Video Treatment',
        title: '[PROJECT]',
        subtitle: 'A video for [CLIENT]',
        image: '',
      }},
      { type: 'statement', content: {
        text: 'The song already has the feeling. The video puts a body, a place and a night into it.',
        alignment: 'center',
      }},
      { type: 'moodboard', content: {
        images: [],
        note: 'Palette, texture, movement. What the room smells like before we decide where the camera stands.',
      }},
      { type: 'full_image', content: {
        image: '',
        caption: 'Hero look',
      }},
      { type: 'image_grid', content: {
        images: [],
        columns: 3,
        gap: 'tight',
      }},
      { type: 'split', content: {
        image: '',
        heading: 'Scene by Scene',
        body: 'Verse, chorus, bridge: what changes, what repeats, where the camera breaks free. The video reads the way the track plays.',
        image_side: 'left',
      }},
      { type: 'crew', content: {
        heading: 'The team',
        members: [
          { role: 'Director', name: 'Andi Degani' },
          { role: 'DOP', name: '' },
          { role: 'Producer', name: '' },
          { role: 'Editor', name: '' },
        ],
      }},
      { type: 'cta', content: {
        heading: 'One day. One location. One take that lands.',
        body: 'We shoot, cut and grade inside two weeks of the track locking.',
        show_agency_branding: true,
      }},
    ],
  },

  {
    title: 'Bone',
    category: 'Brand Film',
    accent_color: '#0F0F0F',
    theme: 'bone',
    kind: 'treatment',
    sections: [
      { type: 'hero', content: {
        eyebrow: 'A brand film for [CLIENT]',
        title: '[PROJECT]',
        subtitle: 'directed by Andi Degani',
        image: '',
      }},
      { type: 'statement', content: {
        text: 'No music-video cuts. Space, faces and one sentence worth remembering.',
        alignment: 'left',
      }},
      { type: 'split', content: {
        image: '',
        heading: 'The Idea',
        body: 'A documentary register, shot in the places the brand actually lives. Real people, real light, no performance.',
        image_side: 'right',
      }},
      { type: 'full_image', content: {
        image: '',
        caption: 'The face of the film',
      }},
      { type: 'moodboard', content: {
        images: [],
        note: 'Available light, long lenses, quiet grade. The restraint is the style.',
      }},
      { type: 'cta', content: {
        heading: 'A film [CLIENT] can run for two years.',
        body: 'Cut long, cut short and cut vertical from the same material.',
        show_agency_branding: true,
      }},
    ],
  },

  {
    title: 'Slate',
    category: 'Any brief',
    accent_color: '#8A8A92',
    theme: 'slate',
    kind: 'treatment',
    sections: [
      { type: 'hero', content: {
        eyebrow: 'Director’s Treatment',
        title: '[PROJECT]',
        subtitle: 'for [CLIENT]',
        image: '',
      }},
      { type: 'statement', content: {
        text: 'Blank on purpose. Keep the slide, retitle it, and the structure still holds.',
        alignment: 'left',
      }},
      { type: 'split', content: {
        image: '',
        heading: 'The Idea',
        body: 'One paragraph. What we are actually saying, and why it lands on this audience.',
        image_side: 'right',
      }},
      { type: 'image_grid', content: {
        images: [],
        columns: 3,
        gap: 'normal',
      }},
      { type: 'moodboard', content: {
        images: [],
        note: 'The look, collected rather than argued.',
      }},
      { type: 'split', content: {
        image: '',
        heading: 'How we shoot it',
        body: 'Days, units, setups, kit. Written so a producer can price it without a phone call.',
        image_side: 'left',
      }},
      { type: 'image_grid', content: {
        images: [],
        columns: 2,
        gap: 'tight',
      }},
      { type: 'deliverables', content: {
        heading: 'Deliverables',
        items: [
          { title: 'Master', detail: '' },
          { title: 'Cutdowns', detail: '' },
          { title: 'Vertical', detail: '' },
        ],
      }},
      { type: 'crew', content: {
        heading: 'Crew',
        members: [
          { role: 'Director', name: 'Andi Degani' },
          { role: 'Producer', name: '' },
          { role: 'DOP', name: '' },
        ],
      }},
      { type: 'cta', content: {
        heading: 'Next step.',
        body: 'Approve the direction, we come back with a schedule and a budget.',
        show_agency_branding: true,
      }},
    ],
  },
];
