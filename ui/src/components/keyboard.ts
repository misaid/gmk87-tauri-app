export interface KeyBox {
  position: [number, number, number];
  size: [number, number, number];
}

/** A procedurally-built GMK87 key grid: no external model asset. */
export function keyboardLayout(): KeyBox[] {
  const unit = 0.19;
  const gap = 0.02;
  const rows = [15, 15, 15, 14, 13, 13];
  const keys: KeyBox[] = [];
  const depth = rows.length * (unit + gap);
  rows.forEach((columns, row) => {
    const width = columns * (unit + gap) - gap;
    for (let column = 0; column < columns; column += 1) {
      const x = -width / 2 + column * (unit + gap) + unit / 2;
      const z = -depth / 2 + row * (unit + gap) + unit / 2;
      keys.push({ position: [x, 0.06, z], size: [unit, 0.05, unit] });
    }
  });
  return keys;
}

interface UnderglowInput {
  underglow: { rainbow: number; color: [number, number, number] };
  brightness?: number;
}

/** The underglow tint for the preview, honouring brightness and rainbow. */
export function underglowColor(state: UnderglowInput, brightnessOverride?: number): string {
  const brightness = brightnessOverride ?? state.brightness ?? 9;
  const scale = brightness / 9;
  if (state.underglow.rainbow === 1) return "#8b5cf6";
  const [r, g, b] = state.underglow.color;
  return `rgb(${Math.round(r * scale)}, ${Math.round(g * scale)}, ${Math.round(b * scale)})`;
}

/** WebGL is absent under jsdom; the preview falls back to a static panel. */
export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}
