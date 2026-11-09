export interface KeyBox {
  position: [number, number];
  size: [number, number];
}

export interface LabeledKey extends KeyBox {
  label: string;
}

export interface DisplayBox {
  position: [number, number];
  size: [number, number];
}

export interface KnobBox {
  position: [number, number];
  radius: number;
}

export interface PlateBox {
  position: [number, number];
  size: [number, number];
}

/** One key: left/top edge in keyboard units (u), its width/height in u, and its legend. */
type KeySpec = [col: number, row: number, width: number, height: number, label: string];

const PITCH = 0.21;
const GAP = 0.02;

/** Pitch-cell width minus keycap width: the gap between adjacent keycaps. */
export const KEY_GAP = GAP;
const ROWS = 6;

// Column where each cluster starts, in keyboard units (u). The GMK87 is a
// standard 87-key TKL: the alpha cluster plus a 3-wide nav block (Ins/Home/
// PgUp over Del/End/PgDn) and an arrow cluster below it — no numpad. The
// display and knob sit above the nav block, at function-row height.
// The function row is tight-racked so PRINT is the last top-row key, with
// its right edge flush with the Backspace key's right edge.
const FN_ROW_END = 15;
const NAV_X0 = FN_ROW_END + 0.25;
const NAV_W = 3;
const TOTAL_W = NAV_X0 + NAV_W;

const KEYS: KeySpec[] = [
  // Function row
  [0, 0, 1, 1, "ESC"],
  [1.25, 0, 1, 1, "F1"], [2.25, 0, 1, 1, "F2"], [3.25, 0, 1, 1, "F3"], [4.25, 0, 1, 1, "F4"],
  [5.625, 0, 1, 1, "F5"], [6.625, 0, 1, 1, "F6"], [7.625, 0, 1, 1, "F7"], [8.625, 0, 1, 1, "F8"],
  [10, 0, 1, 1, "F9"], [11, 0, 1, 1, "F10"], [12, 0, 1, 1, "F11"], [13, 0, 1, 1, "F12"],
  [14, 0, 1, 1, "PRINT"],
  // Number row
  [0, 1, 1, 1, "`"], [1, 1, 1, 1, "1"], [2, 1, 1, 1, "2"], [3, 1, 1, 1, "3"], [4, 1, 1, 1, "4"],
  [5, 1, 1, 1, "5"], [6, 1, 1, 1, "6"], [7, 1, 1, 1, "7"], [8, 1, 1, 1, "8"], [9, 1, 1, 1, "9"],
  [10, 1, 1, 1, "0"], [11, 1, 1, 1, "-"], [12, 1, 1, 1, "="], [13, 1, 2, 1, "BACKSPACE"],
  // QWERTY row
  [0, 2, 1.5, 1, "TAB"], [1.5, 2, 1, 1, "Q"], [2.5, 2, 1, 1, "W"], [3.5, 2, 1, 1, "E"], [4.5, 2, 1, 1, "R"],
  [5.5, 2, 1, 1, "T"], [6.5, 2, 1, 1, "Y"], [7.5, 2, 1, 1, "U"], [8.5, 2, 1, 1, "I"], [9.5, 2, 1, 1, "O"],
  [10.5, 2, 1, 1, "P"], [11.5, 2, 1, 1, "["], [12.5, 2, 1, 1, "]"], [13.5, 2, 1.5, 1, "\\"],
  // Home row
  [0, 3, 1.75, 1, "CAPS"], [1.75, 3, 1, 1, "A"], [2.75, 3, 1, 1, "S"], [3.75, 3, 1, 1, "D"], [4.75, 3, 1, 1, "F"],
  [5.75, 3, 1, 1, "G"], [6.75, 3, 1, 1, "H"], [7.75, 3, 1, 1, "J"], [8.75, 3, 1, 1, "K"], [9.75, 3, 1, 1, "L"],
  [10.75, 3, 1, 1, ";"], [11.75, 3, 1, 1, "'"], [12.75, 3, 2.25, 1, "ENTER"],
  // Bottom letter row
  [0, 4, 2.25, 1, "SHIFT"], [2.25, 4, 1, 1, "Z"], [3.25, 4, 1, 1, "X"], [4.25, 4, 1, 1, "C"], [5.25, 4, 1, 1, "V"],
  [6.25, 4, 1, 1, "B"], [7.25, 4, 1, 1, "N"], [8.25, 4, 1, 1, "M"], [9.25, 4, 1, 1, ","], [10.25, 4, 1, 1, "."],
  [11.25, 4, 1, 1, "/"], [12.25, 4, 2.75, 1, "SHIFT"],
  // Bottom row
  [0, 5, 1.25, 1, "CTRL"], [1.25, 5, 1.25, 1, "WIN"], [2.5, 5, 1.25, 1, "ALT"], [3.75, 5, 6.25, 1, ""],
  [10, 5, 1.25, 1, "ALT"], [11.25, 5, 1.25, 1, "WIN"], [12.5, 5, 1.25, 1, "FN"], [13.75, 5, 1.25, 1, "CTRL"],

  // Nav block: INS/HOME/PGUP over DEL/END/PGDN
  [NAV_X0, 1, 1, 1, "INS"], [NAV_X0 + 1, 1, 1, 1, "HOME"], [NAV_X0 + 2, 1, 1, 1, "PGUP"],
  [NAV_X0, 2, 1, 1, "DEL"], [NAV_X0 + 1, 2, 1, 1, "END"], [NAV_X0 + 2, 2, 1, 1, "PGDN"],
  // Arrow cluster
  [NAV_X0 + 1, 4, 1, 1, "↑"],
  [NAV_X0, 5, 1, 1, "←"], [NAV_X0 + 1, 5, 1, 1, "↓"], [NAV_X0 + 2, 5, 1, 1, "→"],
];

function sceneX(col: number, width: number): number {
  return (col + width / 2 - TOTAL_W / 2) * PITCH;
}

function sceneY(row: number, height: number): number {
  return (row + height / 2 - ROWS / 2) * PITCH;
}

/** A procedurally-built GMK87 key grid: no external model asset. */
export function keyboardLayout(): KeyBox[] {
  return KEYS.map(([col, row, width, height]) => ({
    position: [sceneX(col, width), sceneY(row, height)],
    size: [width * PITCH - GAP, height * PITCH - GAP],
  }));
}

/** Keycaps with their legends, for rendering labels on the flat 2D board. */
export function labeledKeys(): LabeledKey[] {
  return KEYS.map(([col, row, width, height, label]) => ({
    position: [sceneX(col, width), sceneY(row, height)],
    size: [width * PITCH - GAP, height * PITCH - GAP],
    label,
  }));
}

/** The status LCD, mounted above the Ins/Home/PgUp columns at function-row height. */
export function displayLayout(): DisplayBox {
  const col = NAV_X0;
  const width = 2;
  return {
    position: [sceneX(col, width), sceneY(0, 1)],
    size: [width * PITCH - GAP, 1 * PITCH - GAP],
  };
}

/** The top-right plate carrying the display; the knob protrudes from its right end. */
export function displayPlateLayout(): KeyBox {
  return {
    position: [sceneX(NAV_X0, NAV_W), sceneY(0, 1)],
    size: [NAV_W * PITCH - GAP, PITCH - GAP],
  };
}

/** The horizontal side LED strip, one key wide directly below PgDn. */
export function ledBarLayout(): KeyBox {
  const col = NAV_X0 + 2;
  return {
    position: [sceneX(col, 1), 0.065],
    size: [PITCH - GAP, 0.18 * PITCH],
  };
}

/** The rotary knob, mounted on the display plate in line with PgUp/PgDn. */
export function knobLayout(): KnobBox {
  const col = NAV_X0 + 2;
  return {
    position: [sceneX(col, 1), sceneY(0, 1)],
    radius: 0.55 * PITCH,
  };
}

/** The case/plate beneath the keys, sized to the full key cluster bounds. */
export function plateLayout(): PlateBox {
  const margin = 0.12;
  return {
    position: [0, 0],
    size: [TOTAL_W * PITCH + margin, ROWS * PITCH + margin],
  };
}

/** The key field's extent, for sizing the board panel to match. */
export function fieldSize(): [number, number] {
  return [TOTAL_W * PITCH, ROWS * PITCH];
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
