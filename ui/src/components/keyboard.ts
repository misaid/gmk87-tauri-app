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
const GAP = 0.034;

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

// Board geometry in keyboard units (u), origin at the top-left of the key field.
const CASE = { x: -0.35, y: -0.6, w: 18.95, h: 7.1 };
const RECESS = { x: CASE.x + 0.1, y: CASE.y + 0.1, w: CASE.w - 0.2, h: CASE.h - 0.2 };
// Plate exactly covers the key field.
const PLATE = { x: 0, y: 0, w: TOTAL_W, h: ROWS };
// Raised silver module (right end flush with key field's right edge).
const MODULE = { x: 15.0, y: 0.02, w: 3.2, h: 0.92 };
const SCREEN_RECESS = { x: 15.17, y: 0.05, w: 1.62, h: 0.83 };
const SCREEN_ACTIVE = { x: 15.37, y: 0.12, w: 1.28, h: 0.74 };
const KNOB = { cx: 17.57, cy: 0.42, d: 1.1 };
const LIGHT_RECESS = { x: 17.0, y: 3.27, w: 1.08, h: 0.32 };
const LIGHT_CAPSULE = { x: 17.08, y: 3.34, w: 0.92, h: 0.18 };

function centerOf(box: { x: number; y: number; w: number; h: number }) {
  return [box.x + box.w / 2, box.y + box.h / 2] as const;
}

function uToSceneCenter(x: number, y: number, w: number, h: number, ref = CASE): [number, number] {
  const [rcx, rcy] = centerOf(ref);
  return [((x + w / 2) - rcx) * PITCH, ((y + h / 2) - rcy) * PITCH];
}

function uBox(x: number, y: number, w: number, h: number, ref = CASE): PlateBox {
  return { position: uToSceneCenter(x, y, w, h, ref), size: [w * PITCH, h * PITCH] };
}

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

/** A procedurally-built GMK87 key grid: no external model asset. */
export function keyboardLayout(): KeyBox[] {
  return KEYS.map(([col, row, width, height]) => ({
    position: uToSceneCenter(col, row, width, height),
    size: [width * PITCH - GAP, height * PITCH - GAP],
  }));
}

/** Keycaps with their legends, for rendering labels on the flat 2D board. */
export function labeledKeys(): LabeledKey[] {
  return KEYS.map(([col, row, width, height, label]) => ({
    position: uToSceneCenter(col, row, width, height),
    size: [width * PITCH - GAP, height * PITCH - GAP],
    label,
  }));
}

/** The case outer shell, sized to the full board including bezel. */
export function caseLayout(): PlateBox {
  return uBox(CASE.x, CASE.y, CASE.w, CASE.h);
}

/** The inset recess inside the case lip. */
export function recessLayout(): PlateBox {
  return uBox(RECESS.x, RECESS.y, RECESS.w, RECESS.h);
}

/** The plate/switch mounting surface covering the key field. */
export function plateLayout(): PlateBox {
  return uBox(PLATE.x, PLATE.y, PLATE.w, PLATE.h);
}

/** The raised silver module panel (display + knob). */
export function displayPlateLayout(): KeyBox {
  return uBox(MODULE.x, MODULE.y, MODULE.w, MODULE.h);
}

/** The screen's black inset recess inside the module. */
export function displayRecessLayout(): DisplayBox {
  return uBox(SCREEN_RECESS.x, SCREEN_RECESS.y, SCREEN_RECESS.w, SCREEN_RECESS.h);
}

/** The 240×135 active screen area. */
export function displayLayout(): DisplayBox {
  return uBox(SCREEN_ACTIVE.x, SCREEN_ACTIVE.y, SCREEN_ACTIVE.w, SCREEN_ACTIVE.h);
}

/** The rotary knob, mounted on the module panel. */
export function knobLayout(): KnobBox {
  const [rcx, rcy] = centerOf(CASE);
  return {
    position: [(KNOB.cx - rcx) * PITCH, (KNOB.cy - rcy) * PITCH],
    radius: (KNOB.d / 2) * PITCH,
  };
}

/** The recessed pocket for the side LED bar. */
export function ledBarRecessLayout(): KeyBox {
  return uBox(LIGHT_RECESS.x, LIGHT_RECESS.y, LIGHT_RECESS.w, LIGHT_RECESS.h);
}

/** The frosted capsule inside the side LED pocket. */
export function ledBarLayout(): KeyBox {
  return uBox(LIGHT_CAPSULE.x, LIGHT_CAPSULE.y, LIGHT_CAPSULE.w, LIGHT_CAPSULE.h);
}

/** The key field's extent, for sizing the board panel to match. */
export function fieldSize(): [number, number] {
  return [TOTAL_W * PITCH, ROWS * PITCH];
}

/** Board aspect ratio (case outer). */
export function caseAspect(): number {
  return CASE.w / CASE.h;
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
