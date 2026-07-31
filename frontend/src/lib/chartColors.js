/**
 * Chart marks for the achromatic system.
 *
 * The palette is monochrome by mandate, so series identity is carried by
 * lightness alone. Steps below were checked for perceptual separation: adjacent
 * pairs clear the ΔE 15 normal-vision floor and the CVD floor at every length.
 * Four steps is the ceiling — a fifth step drops adjacent separation to ΔE 12.6,
 * which reads as the same grey. Anything past four folds into `OTHER`.
 *
 * Because the lighter steps fall under 3:1 against paper, charts using them must
 * keep a legend or direct labels — identity is never carried by the fill alone.
 */

// Series ramps, indexed by how many series the chart draws.
const RAMPS = {
  1: ['#0a0a0a'],
  2: ['#0a0a0a', '#a3a3a3'],
  3: ['#262626', '#737373', '#c4c4c4'],
  4: ['#262626', '#5c5c5c', '#949494', '#c4c4c4'],
};

export const CHART_INK = '#0a0a0a';
export const CHART_MUTED = '#a3a3a3';
export const CHART_GRID = '#e5e5e5';
export const CHART_AXIS = '#737373';
export const CHART_OTHER = '#d4d4d4';

/** Reserved — never used for a plain series. */
export const CHART_NEGATIVE = '#e7000b';

/** Fixed-order ramp for `n` series. Colour follows the entity, never its rank. */
export function seriesColors(n) {
  if (n <= 1) return RAMPS[1];
  if (n >= 4) return RAMPS[4];
  return RAMPS[n];
}

/**
 * Colour for slice/series `i` of `total`. Past the fourth slot everything
 * collapses to a single "other" step rather than inventing new greys.
 */
export function seriesColor(i, total) {
  const ramp = seriesColors(Math.min(total, 4));
  return i < ramp.length ? ramp[i] : CHART_OTHER;
}
