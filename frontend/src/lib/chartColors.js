/**
 * Chart marks for the achromatic system.
 *
 * The palette is monochrome by mandate, so series identity is carried by
 * lightness alone. Each ramp below was checked for perceptual separation in
 * both themes: adjacent pairs clear the ΔE 15 normal-vision floor and the CVD
 * floor. Four steps is the ceiling — a fifth drops adjacent separation to
 * ΔE ~12.6, which reads as the same grey, so anything past four folds into
 * `CHART_OTHER`.
 *
 * Values resolve through CSS custom properties, so the marks re-step when the
 * theme flips rather than being inverted mechanically. `var()` is valid in SVG
 * presentation attributes, which is how recharts applies fill/stroke.
 *
 * Because the lightest steps can fall under 3:1 against the surface, charts
 * using them must keep a legend or direct labels — identity is never carried
 * by the fill alone.
 */

const RAMPS = {
  1: ['var(--chart-a1)'],
  2: ['var(--chart-b1)', 'var(--chart-b2)'],
  3: ['var(--chart-c1)', 'var(--chart-c2)', 'var(--chart-c3)'],
  4: ['var(--chart-d1)', 'var(--chart-d2)', 'var(--chart-d3)', 'var(--chart-d4)'],
};

export const CHART_INK = 'var(--color-ink)';
export const CHART_MUTED = 'var(--color-mid-gray)';
export const CHART_GRID = 'var(--chart-grid)';
export const CHART_AXIS = 'var(--chart-axis)';
export const CHART_OTHER = 'var(--chart-other)';
export const CHART_SURFACE = 'var(--surface-card)';

/** Reserved — never used for a plain series. */
export const CHART_NEGATIVE = 'var(--color-ember)';

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
