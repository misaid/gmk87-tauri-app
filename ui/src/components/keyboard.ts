export interface KeyBox {
  position: [number, number, number];
  size: [number, number, number];
}

export interface LabeledKey extends KeyBox {
  label: string;
}

export interface DisplayBox {
  position: [number, number, number];
  size: [number, number];
}

export interface KnobBox {
  position: [number, number, number];
  radius: number;
  height: number;
}

export interface PlateBox {
  position: [number, number, number];
  size: [number, number];
  height: number;
}

/** One key: left/top edge in keyboard units (u), its width/height in u, and its legend. */
type KeySpec = [col: number, row: number, width: number, height: number, label: string];

const PITCH = 0.21;
const GAP = 0.02;

// The case is a solid block, not a sheet: keycaps sit on a visible stem gap
// above its top face (y = 0), so the board reads as a 3D object with real
// thickness from any orbit angle instead of a flat painted plane.
const PLATE_HEIGHT = 0.36;
const PLATE_TOP = 0;
const STEM_GAP = 0.025;
const KEY_HEIGHT = 0.11;
const KEY_Y = PLATE_TOP + STEM_GAP + KEY_HEIGHT / 2;
const KNOB_HEIGHT = 0.09;

const ROWS = 6;

// Column where each cluster starts, in keyboard units (u). The GMK87 is a
// standard 87-key TKL: the alpha cluster plus a 3-wide nav block (Ins/Home/
// PgUp over Del/End/PgDn) and an arrow cluster below it — no numpad. The
// display and knob sit above the nav block, at function-row height.
const MAIN_W = 15;
const CLUSTER_GAP = 0.5;
const NAV_X0 = MAIN_W + CLUSTER_GAP;
const NAV_W = 3;
const TOTAL_W = NAV_X0 + NAV_W;

const KEYS: KeySpec[] = [
  // Function row
  [0, 0, 1, 1, "Esc"],
  [2, 0, 1, 1, "F1"], [3, 0, 1, 1, "F2"], [4, 0, 1, 1, "F3"], [5, 0, 1, 1, "F4"],
  [6.5, 0, 1, 1, "F5"], [7.5, 0, 1, 1, "F6"], [8.5, 0, 1, 1, "F7"], [9.5, 0, 1, 1, "F8"],
  [11, 0, 1, 1, "F9"], [12, 0, 1, 1, "F10"], [13, 0, 1, 1, "F11"], [14, 0, 1, 1, "F12"],
  [15.25, 0, 1, 1, "Del"],
  // Number row
  [0, 1, 1, 1, "`"], [1, 1, 1, 1, "1"], [2, 1, 1, 1, "2"], [3, 1, 1, 1, "3"], [4, 1, 1, 1, "4"],
  [5, 1, 1, 1, "5"], [6, 1, 1, 1, "6"], [7, 1, 1, 1, "7"], [8, 1, 1, 1, "8"], [9, 1, 1, 1, "9"],
  [10, 1, 1, 1, "0"], [11, 1, 1, 1, "-"], [12, 1, 1, 1, "="], [13, 1, 2, 1, "Backspace"],
  // QWERTY row
  [0, 2, 1.5, 1, "Tab"], [1.5, 2, 1, 1, "Q"], [2.5, 2, 1, 1, "W"], [3.5, 2, 1, 1, "E"], [4.5, 2, 1, 1, "R"],
  [5.5, 2, 1, 1, "T"], [6.5, 2, 1, 1, "Y"], [7.5, 2, 1, 1, "U"], [8.5, 2, 1, 1, "I"], [9.5, 2, 1, 1, "O"],
  [10.5, 2, 1, 1, "P"], [11.5, 2, 1, 1, "["], [12.5, 2, 1, 1, "]"], [13.5, 2, 1.5, 1, "\\"],
  // Home row
  [0, 3, 1.75, 1, "Caps"], [1.75, 3, 1, 1, "A"], [2.75, 3, 1, 1, "S"], [3.75, 3, 1, 1, "D"], [4.75, 3, 1, 1, "F"],
  [5.75, 3, 1, 1, "G"], [6.75, 3, 1, 1, "H"], [7.75, 3, 1, 1, "J"], [8.75, 3, 1, 1, "K"], [9.75, 3, 1, 1, "L"],
  [10.75, 3, 1, 1, ";"], [11.75, 3, 1, 1, "'"], [12.75, 3, 2.25, 1, "Enter"],
  // Bottom letter row
  [0, 4, 2.25, 1, "Shift"], [2.25, 4, 1, 1, "Z"], [3.25, 4, 1, 1, "X"], [4.25, 4, 1, 1, "C"], [5.25, 4, 1, 1, "V"],
  [6.25, 4, 1, 1, "B"], [7.25, 4, 1, 1, "N"], [8.25, 4, 1, 1, "M"], [9.25, 4, 1, 1, ","], [10.25, 4, 1, 1, "."],
  [11.25, 4, 1, 1, "/"], [12.25, 4, 2.75, 1, "Shift"],
  // Bottom row
  [0, 5, 1.25, 1, "Ctrl"], [1.25, 5, 1.25, 1, "Win"], [2.5, 5, 1.25, 1, "Alt"], [3.75, 5, 6.25, 1, ""],
  [10, 5, 1.25, 1, "Alt"], [11.25, 5, 1.25, 1, "Win"], [12.5, 5, 1.25, 1, "Fn"], [13.75, 5, 1.25, 1, "Ctrl"],

  // Nav block: Ins/Home/PgUp over Del/End/PgDn
  [NAV_X0, 1, 1, 1, "Ins"], [NAV_X0 + 1, 1, 1, 1, "Home"], [NAV_X0 + 2, 1, 1, 1, "PgUp"],
  [NAV_X0, 2, 1, 1, "Del"], [NAV_X0 + 1, 2, 1, 1, "End"], [NAV_X0 + 2, 2, 1, 1, "PgDn"],
  // Arrow cluster
  [NAV_X0 + 1, 4, 1, 1, "↑"],
  [NAV_X0, 5, 1, 1, "←"], [NAV_X0 + 1, 5, 1, 1, "↓"], [NAV_X0 + 2, 5, 1, 1, "→"],
];

function sceneX(col: number, width: number): number {
  return (col + width / 2 - TOTAL_W / 2) * PITCH;
}

function sceneZ(row: number, height: number): number {
  return (row + height / 2 - ROWS / 2) * PITCH;
}

/** A procedurally-built GMK87 key grid: no external model asset. */
export function keyboardLayout(): KeyBox[] {
  return KEYS.map(([col, row, width, height]) => ({
    position: [sceneX(col, width), KEY_Y, sceneZ(row, height)],
    size: [width * PITCH - GAP, KEY_HEIGHT, height * PITCH - GAP],
  }));
}

/** Keycaps with their legends, for baking a label texture over the key field. */
export function labeledKeys(): LabeledKey[] {
  return KEYS.map(([col, row, width, height, label]) => ({
    position: [sceneX(col, width), KEY_Y, sceneZ(row, height)],
    size: [width * PITCH - GAP, KEY_HEIGHT, height * PITCH - GAP],
    label,
  }));
}

/** The status LCD, flush-mounted above the Ins/Home/PgUp columns at function-row height. */
export function displayLayout(): DisplayBox {
  const col = NAV_X0;
  const width = 2;
  return {
    position: [sceneX(col, width), PLATE_TOP + 0.006, sceneZ(0, 1)],
    size: [width * PITCH - GAP, 1 * PITCH - GAP],
  };
}

/** The rotary knob, mounted beside the display above the PgUp column. */
export function knobLayout(): KnobBox {
  const col = NAV_X0 + 2.5;
  return {
    position: [sceneX(col, 1), PLATE_TOP + STEM_GAP + KNOB_HEIGHT / 2, sceneZ(0, 1)],
    radius: 0.5 * PITCH,
    height: KNOB_HEIGHT,
  };
}

/** The case/plate beneath the keys, sized to the full key cluster bounds. */
export function plateLayout(): PlateBox {
  const margin = 0.12;
  return {
    position: [0, PLATE_TOP - PLATE_HEIGHT / 2, 0],
    size: [TOTAL_W * PITCH + margin, ROWS * PITCH + margin],
    height: PLATE_HEIGHT,
  };
}

/** The Y just above the keycap tops, for the label overlay to sit flush without z-fighting. */
export function legendY(): number {
  return KEY_Y + KEY_HEIGHT / 2 + 0.003;
}

/** The key field's extent, for sizing a label-texture overlay to match. */
export function fieldSize(): [number, number] {
  return [TOTAL_W * PITCH, ROWS * PITCH];
}

/** The board's rest tilt (rotation around X) in the scene. */
export const BOARD_TILT = Math.PI / 5;

/** Converts a point from the board's local (pre-tilt) space to world space. */
export function toWorld([x, y, z]: [number, number, number]): [number, number, number] {
  const cos = Math.cos(BOARD_TILT);
  const sin = Math.sin(BOARD_TILT);
  return [x, y * cos - z * sin, y * sin + z * cos];
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
