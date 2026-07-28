// Seeded pitch presentation templates — inserted exactly once, guarded by the
// pitches_templates_seeded settings key. User edits to these rows must survive
// every boot, so nothing here is ever re-applied after the first seed.
// Section content shapes must match the nine types defined in routes/pitches.js.

module.exports = [
  {
    title: 'Fashion / Editorial',
    category: 'Fashion/Editorial',
    accent_color: '#E8C1A0',
    sections: [
      { type: 'hero', content: {
        eyebrow: 'Photography Concept',
        title: '[PROJECT]',
        subtitle: 'An editorial fashion story for [CLIENT]',
        image: '',
        overlay_strength: 45,
      }},
      { type: 'statement', content: {
        text: 'Fashion photography works when the clothes stop posing and start telling the truth.',
        alignment: 'center',
      }},
      { type: 'split', content: {
        image: '',
        heading: 'The Concept',
        body: 'We treat [PROJECT] as a story, not a lookbook. One character, one location, one arc — shot with the discipline of a film still. Every frame should feel like it was pulled from a scene that kept going after the shutter closed. The collection leads; the styling, light and gesture do the talking.',
        image_side: 'right',
      }},
      { type: 'full_image', content: {
        image: '',
        caption: 'Key look — the frame the whole story hangs on',
      }},
      { type: 'image_grid', content: {
        images: [],
        columns: 3,
        gap: 'tight',
        }},
      { type: 'moodboard', content: {
        images: [],
        note: 'Texture, tone and attitude — hard light against soft fabric, colour kept quiet so the silhouettes carry the frame.',
      }},
      { type: 'deliverables', content: {
        heading: 'What [CLIENT] receives',
        items: [
          { title: '12 hero images', detail: 'Fully retouched, print and campaign ready' },
          { title: '30 supporting selects', detail: 'Colour graded for web and lookbook use' },
          { title: 'Social crops', detail: '4:5 and 9:16 versions of every hero image' },
          { title: 'Behind-the-scenes set', detail: 'Candid frames from set for launch content' },
        ],
      }},
      { type: 'crew', content: {
        heading: 'The team on set',
        members: [
          { role: 'Photographer', name: '' },
          { role: 'Stylist', name: '' },
          { role: 'Makeup & Hair', name: '' },
          { role: 'Lighting Assistant', name: '' },
          { role: 'Retoucher', name: '' },
        ],
      }},
      { type: 'cta', content: {
        heading: 'Let’s make [PROJECT] happen.',
        body: 'One shoot day, one clear story, imagery [CLIENT] will still be proud of in five years. We are ready when you are.',
        show_agency_branding: true,
      }},
    ],
  },
  {
    title: 'Business Social Media',
    category: 'Business Social Media',
    accent_color: '#4FC3F7',
    sections: [
      { type: 'hero', content: {
        eyebrow: 'Content Photography',
        title: '[PROJECT]',
        subtitle: 'A month of scroll-stopping content for [CLIENT]',
        image: '',
        overlay_strength: 50,
      }},
      { type: 'statement', content: {
        text: 'People don’t follow businesses. They follow businesses that look like they mean it.',
        alignment: 'center',
      }},
      { type: 'split', content: {
        image: '',
        heading: 'Why this works',
        body: 'Instead of one-off shoots that run dry in a week, we build [CLIENT] a repeatable visual system: consistent light, consistent colour, consistent framing. One shoot day produces a full month of posts that all feel like they belong to the same brand — because they do.',
        image_side: 'left',
      }},
      { type: 'image_grid', content: {
        images: [],
        columns: 3,
        gap: 'normal',
      }},
      { type: 'deliverables', content: {
        heading: 'The monthly package',
        items: [
          { title: '20 edited photographs', detail: 'Shot and graded to the brand system' },
          { title: 'Feed plan', detail: 'Posting order mapped so the grid always looks intentional' },
          { title: 'Stories pack', detail: '10 vertical crops ready for stories and reels covers' },
          { title: 'Product detail set', detail: 'Close-ups for ads, website and marketplace listings' },
        ],
      }},
      { type: 'crew', content: {
        heading: 'Who makes it',
        members: [
          { role: 'Photographer', name: '' },
          { role: 'Art Director', name: '' },
          { role: 'Retoucher', name: '' },
        ],
      }},
      { type: 'cta', content: {
        heading: 'Ready to look consistent, [CLIENT]?',
        body: 'One planning call, one shoot day, thirty days of content. Let’s put your feed to work.',
        show_agency_branding: true,
      }},
    ],
  },
  {
    title: 'TVC Photography Campaign',
    category: 'TVC Photography Campaign',
    accent_color: '#FF902F',
    sections: [
      { type: 'hero', content: {
        eyebrow: 'Campaign Stills',
        title: '[PROJECT]',
        subtitle: 'The photography campaign alongside [CLIENT]’s TVC',
        image: '',
        overlay_strength: 40,
      }},
      { type: 'statement', content: {
        text: 'The commercial runs for thirty seconds. The stills run everywhere else.',
        alignment: 'center',
      }},
      { type: 'split', content: {
        image: '',
        heading: 'The campaign idea',
        body: 'We shoot the stills campaign on the TVC set, with the same cast, wardrobe and lighting design — so every billboard, print ad and thumbnail is unmistakably the same world as the film. No mismatched agency stock, no reshoots: one production, one visual language, every channel covered.',
        image_side: 'right',
      }},
      { type: 'full_image', content: {
        image: '',
        caption: 'Key visual — built for billboards, cropped for everything else',
      }},
      { type: 'moodboard', content: {
        images: [],
        note: 'Cinematic contrast, campaign-grade polish. Frames that hold up at 6 metres wide and 60 millimetres tall.',
      }},
      { type: 'deliverables', content: {
        heading: 'Campaign deliverables',
        items: [
          { title: '1 key visual', detail: 'Master art with layered retouch for OOH adaptation' },
          { title: '8 campaign stills', detail: 'Retouched frames covering every product angle' },
          { title: 'Format adaptations', detail: 'Billboard, print, digital display and social crops' },
          { title: 'On-set coverage', detail: 'Production stills of the TVC shoot for PR use' },
        ],
      }},
      { type: 'crew', content: {
        heading: 'Stills unit',
        members: [
          { role: 'Photographer', name: '' },
          { role: 'Digital Tech', name: '' },
          { role: 'Lighting Assistant', name: '' },
          { role: 'Retoucher', name: '' },
        ],
      }},
      { type: 'cta', content: {
        heading: 'One set. Every channel.',
        body: 'Let’s lock the stills unit into the [PROJECT] production schedule and give [CLIENT] a campaign that matches the film frame for frame.',
        show_agency_branding: true,
      }},
    ],
  },
  {
    title: 'Music Video Photography',
    category: 'Music Video Photography',
    accent_color: '#A78BFA',
    sections: [
      { type: 'hero', content: {
        eyebrow: 'Artist Photography',
        title: '[PROJECT]',
        subtitle: 'Cover art and stills from the [CLIENT] video shoot',
        image: '',
        overlay_strength: 55,
      }},
      { type: 'statement', content: {
        text: 'The video gets the views. The photographs become how people remember the era.',
        alignment: 'center',
      }},
      { type: 'moodboard', content: {
        images: [],
        note: 'World-building references — colour, grain and light pulled from the video treatment so the stills live in the same universe.',
      }},
      { type: 'split', content: {
        image: '',
        heading: 'On-set, not after',
        body: 'We shoot during the video production itself — same set, same styling, same energy. Between setups we steal the artist for minutes at a time and walk away with cover art, press shots and single artwork that no separate photo day could fake.',
        image_side: 'left',
      }},
      { type: 'image_grid', content: {
        images: [],
        columns: 2,
        gap: 'tight',
      }},
      { type: 'deliverables', content: {
        heading: 'What the release gets',
        items: [
          { title: 'Single / EP cover art', detail: 'Master artwork with typography-safe versions' },
          { title: '10 press photographs', detail: 'Retouched, ready for playlists, press and print' },
          { title: 'Social rollout pack', detail: 'Teaser crops and vertical formats for release week' },
          { title: 'On-set documentary set', detail: 'Raw, candid frames from the video shoot' },
        ],
      }},
      { type: 'crew', content: {
        heading: 'The unit',
        members: [
          { role: 'Photographer', name: '' },
          { role: 'Lighting Assistant', name: '' },
          { role: 'Retoucher', name: '' },
        ],
      }},
      { type: 'cta', content: {
        heading: 'Let’s shoot the era, not just the song.',
        body: 'Add the stills unit to the [PROJECT] video day and [CLIENT] walks away with the full visual identity for the release.',
        show_agency_branding: true,
      }},
    ],
  },
];
