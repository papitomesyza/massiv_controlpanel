import React from 'react';
import {
  Music, Tv, Building2, Clapperboard, Smartphone, Video, Home, Package,
  Camera, User, ShoppingBag, Building, Shirt, Wand2, Images,
  Scissors, Contrast, Sparkles, Mic, Sliders, Captions,
  Palette, Hash, PenTool, LayoutTemplate, Shapes,
  Film, Tag, Heart, RefreshCw,
  Lightbulb, Aperture, Plane, Monitor, Battery, Truck, Grip, Headphones,
  Cable, HardDrive, Armchair,
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
  'Film & Video':       'var(--cat-1)',
  'Photography':        'var(--cat-3)',
  'Post & Finishing':   'var(--cat-4)',
  'Design & Brand':     'var(--cat-7)',
  'Campaign & Direction': 'var(--cat-5)',
};

// A distinct glyph per seeded category. Chosen so no two read alike: a TV
// Commercial (Tv) and a Music Video (Music) are unmistakable, and a Web Design
// job (LayoutTemplate) never looks like a Graphic Design job (PenTool).
const CATEGORY_ICON = {
  // Film & Video
  'TV Commercial': Tv,
  'Music Video': Music,
  'Brand Film / Corporate Video': Building2,
  'Documentary / Short Film': Clapperboard,
  'Social Media Video': Smartphone,
  'Event Videography': Video,
  'Product / Property Video': Home,
  'Aerial & Drone': Plane,
  // Photography
  'Commercial / Product Photography': ShoppingBag,
  'Portrait / Editorial': User,
  'Fashion': Shirt,
  'Event Photography': Camera,
  'Real Estate / Architecture': Building,
  'Wedding': Heart,
  // Design & Brand
  'Branding & Identity': Palette,
  'Graphic Design': PenTool,
  'Web / UI Design': LayoutTemplate,
  'Social Content Management': Hash,
  // Post & Finishing
  'Video Editing': Scissors,
  'Color Grading': Contrast,
  'VFX / Motion Graphics': Sparkles,
  '2D / 3D Animation': Shapes,
  'Audio Production & Mix': Mic,
  'Subtitling & Localization': Captions,
  'Photo Retouching': Wand2,
  // Campaign & Direction
  'Integrated Campaign': Package,
  'Directing Only': Film,
  'Monthly Content Retainer': RefreshCw,
  'Concept / Pitch': Lightbulb,
};

// One representative glyph per group, used when the user invents a category name
// that is not in the seeded set. It still belongs to a known group, so it still
// reads as that kind of work.
const GROUP_FALLBACK_ICON = {
  'Film & Video':        Video,
  'Photography':         Camera,
  'Design & Brand':      Palette,
  'Post & Finishing':    Film,
  'Campaign & Direction': Lightbulb,
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

// Asset item categories are free text typed by the user (Camera, Lighting,
// Audio...), so they are read by keyword rather than by exact name. Anything
// unrecognised takes the neutral package glyph, drawn grey by the caller.
const ASSET_ICON_RULES = [
  [/lens|optic|glass/i, Aperture],
  [/camera|body|cine/i, Camera],
  [/light|lamp|led|flash/i, Lightbulb],
  [/audio|sound|mic/i, Mic],
  [/headphone|monitoring/i, Headphones],
  [/drone|aerial/i, Plane],
  [/monitor|screen|display/i, Monitor],
  [/power|battery|generator/i, Battery],
  [/grip|rig|stand|tripod|dolly|gimbal/i, Grip],
  [/cable|wire/i, Cable],
  [/storage|drive|card|media/i, HardDrive],
  [/vehicle|van|truck|transport/i, Truck],
  [/prop|furniture|set/i, Armchair],
  [/studio|space|location/i, Building],
];

export function assetCategoryVisual(category) {
  const rule = ASSET_ICON_RULES.find(([re]) => re.test(category || ''));
  return rule ? { Icon: rule[1], known: true } : { Icon: Package, known: false };
}
