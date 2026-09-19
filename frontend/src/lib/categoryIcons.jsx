import React from 'react';
import {
  Music, Tv, Building2, Clapperboard, Smartphone, Video, Home, Package,
  Camera, User, ShoppingBag, Building, Shirt, Wand2, Images,
  Scissors, Contrast, Sparkles, Mic, Sliders, Captions,
  Palette, Hash, PenTool, LayoutTemplate, Shapes,
  Film, Tag,
} from 'lucide-react';

// One category icon system for the whole app. The Projects rows, the estimate
// pipeline and the leads rail all decode a category the same way, so a Music
// Video reads as a Music Video wherever it appears. The word itself never needs
// to be printed: the glyph carries the category and the tile tint carries the
// group.

// Each of the five groups takes one hue from the shared categorical palette in
// index.css. Nothing is hardcoded here: these are token names, resolved by the
// stylesheet in both light and dark themes.
export const GROUP_TINT = {
  'Video Production':   'var(--cat-1)',
  'Photography':        'var(--cat-3)',
  'Post Production':    'var(--cat-4)',
  'Branding & Digital': 'var(--cat-7)',
  'Animation & Motion': 'var(--cat-5)',
};

// A distinct glyph per seeded category. Chosen so no two read alike: a TV
// Commercial (Tv) and a Music Video (Music) are unmistakable, and a Web Design
// job (LayoutTemplate) never looks like a Graphic Design job (PenTool).
const CATEGORY_ICON = {
  // Video Production
  'Music Video': Music,
  'TV Commercial': Tv,
  'Corporate Video / Brand Film': Building2,
  'Documentary / Short Film': Clapperboard,
  'Social Media Video Content': Smartphone,
  'Event Videography': Video,
  'Real Estate / Property Video': Home,
  'Product Demo Video': Package,
  // Photography
  'Event Photography': Camera,
  'Portrait / Editorial Photography': User,
  'Commercial / Product Photography': ShoppingBag,
  'Real Estate Photography': Building,
  'Fashion Photography': Shirt,
  'Photo Retouching': Wand2,
  'Photo Editing & Culling': Images,
  // Post Production
  'Video Editing': Scissors,
  'Color Grading': Contrast,
  'VFX / Motion Graphics': Sparkles,
  'Podcast / Audio Production': Mic,
  'Audio Mixing & Mastering': Sliders,
  'Subtitling & Localization': Captions,
  // Branding & Digital
  'Branding & Identity': Palette,
  'Social Media Content Management': Hash,
  'Graphic Design': PenTool,
  'Web Design': LayoutTemplate,
  // Animation & Motion
  '2D / 3D Animation': Shapes,
};

// One representative glyph per group, used when the user invents a category name
// that is not in the seeded set. It still belongs to a known group, so it still
// reads as that kind of work.
const GROUP_FALLBACK_ICON = {
  'Video Production':   Video,
  'Photography':        Camera,
  'Post Production':    Film,
  'Branding & Digital': Palette,
  'Animation & Motion': Sparkles,
};

// The final fallback for a category whose group is also unknown.
const GENERIC_ICON = Tag;

// Resolve a category name and its group to a glyph and a tint token. An exact
// category match wins; failing that the group glyph; failing that a neutral tag.
export function categoryVisual(categoryName, groupName) {
  const Icon = CATEGORY_ICON[categoryName] || GROUP_FALLBACK_ICON[groupName] || GENERIC_ICON;
  const tint = GROUP_TINT[groupName] || 'var(--color-mid-gray)';
  return { Icon, tint };
}

// A bare glyph element, sized to caller. Used where the host already provides
// its own container (the leads rail chip, the estimate card header).
export function categoryIconEl(categoryName, groupName, size = 15) {
  const { Icon } = categoryVisual(categoryName, groupName);
  return <Icon size={size} />;
}

// The tinted rounded tile used at the left of a project row. The tint travels on
// a CSS custom property so the wash and the glyph colour are computed from the
// one token in the stylesheet, never a hardcoded value.
export function CategoryTile({ categoryName, groupName, size = 38, className = '' }) {
  const { Icon, tint } = categoryVisual(categoryName, groupName);
  const glyph = Math.round(size * 0.46);
  return (
    <span
      className={`cat-tile ${className}`}
      style={{ '--tint': tint, width: size, height: size }}
    >
      <Icon size={glyph} />
    </span>
  );
}
