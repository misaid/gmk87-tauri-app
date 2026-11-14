/**
 * Hand-drawn resting frames for effect thumbnails, so look-alike effects
 * (Breathe / Orbit / Drift / Tide / Steady glow) read as different at a glance.
 * Returns 0..1 intensity, or null to fall back to the simulated LED field.
 */
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function thumbIntensity(effect: number, r: number, c: number, rows: number, cols: number): number | null {
  const x = (c + 0.5) / cols;
  const y = (r + 0.5) / rows;
  // Aspect-corrected distance from the centre (cells are wider than tall).
  const dx = (x - 0.5) * (cols / rows) * 0.42;
  const dy = y - 0.5;
  const d = Math.hypot(dx, dy) * 1.6;
  switch (effect) {
    case 1: // Drift: slow gradient washing left to right
      return clamp01(x * x * 1.1);
    case 5: // Breathe: soft centre glow
      return clamp01(1.1 - d * 1.5);
    case 6: // Steady glow: everything lit
      return 1;
    case 8: // Ripple spread: a ring
      return Math.abs(d - 0.62) < 0.17 ? 1 : 0;
    case 9: { // Row sweep: one bright column with a short trail
      const lead = Math.floor(cols * 0.36);
      return c === lead ? 1 : c === lead - 1 ? 0.45 : 0;
    }
    case 13: // Ripple centre: dot with a faint outer ring
      return d < 0.28 ? 1 : Math.abs(d - 0.75) < 0.1 ? 0.4 : 0;
    case 14: { // Orbit: diagonal bands
      const m = (((c - r * 2) % 6) + 6) % 6;
      return m === 0 ? 1 : m === 1 ? 0.4 : 0;
    }
    case 16: { // Tide: a sine crest rolling across
      const crest = 0.5 + 0.38 * Math.sin(x * Math.PI * 3);
      return clamp01(1 - Math.abs(y - crest) * 3.2);
    }
    default:
      return null;
  }
}
