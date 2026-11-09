export interface NamedValue {
  name: string;
  value: number;
}

/** Experiential names for picking; firmware strings kept for reference below. Values are device order. */
export const UNDERGLOW_EFFECTS: readonly NamedValue[] = [
  { name: "Off", value: 0 },
  { name: "Drift", value: 1 },
  { name: "Pulse drift", value: 2 },
  { name: "Rain shower", value: 3 },
  { name: "Colour spectrum", value: 4 },
  { name: "Breathe", value: 5 },
  { name: "Steady glow", value: 6 },
  { name: "Tap glow", value: 7 },
  { name: "Ripple spread", value: 8 },
  { name: "Row sweep", value: 9 },
  { name: "Flicker", value: 10 },
  { name: "Rainbow breathe", value: 11 },
  { name: "Neon rain", value: 12 },
  { name: "Ripple centre", value: 13 },
  { name: "Orbit", value: 14 },
  { name: "Downpour", value: 15 },
  { name: "Tide", value: 16 },
  { name: "Slow hue breathing", value: 17 },
  { name: "Slow rainbow", value: 18 },
];

/** Firmware/board strings, shown as a reference so users can match docs. */
export const EFFECT_FIRMWARE_NAMES: Readonly<Record<number, string>> = {
  0: "Off",
  1: "Horizontal dimming wave",
  2: "Horizontal pulse wave",
  3: "Waterfall",
  4: "Full cycling colors",
  5: "Breathing",
  6: "Full one color",
  7: "Glow pressed key",
  8: "Glow spreading",
  9: "Glow row",
  10: "Random pattern",
  11: "Rainbow cycle",
  12: "Rainbow waterfall",
  13: "Wave from center",
  14: "Circling J/K",
  15: "Raining",
  16: "Wave left-right",
  17: "Slow saturation cycle",
  18: "Slow rainbow from center",
};

export const LED_MODES: readonly NamedValue[] = [
  { name: "Blink one colour", value: 0 },
  { name: "Pulse rainbow", value: 1 },
  { name: "Blink alternating pair", value: 2 },
  { name: "Fixed colour", value: 3 },
  { name: "Fixed alternating pair", value: 4 },
];

export const LED_MODE_DESCRIPTIONS: Readonly<Record<number, string>> = {
  0: "One colour blinks on and off.",
  1: "Rainbow hues pulse in and out.",
  2: "Two colours take turns blinking.",
  3: "One colour stays solid.",
  4: "Two colours alternate, solid.",
};


export const LED_COLORS: readonly NamedValue[] = [
  { name: "Red", value: 0 },
  { name: "Orange", value: 1 },
  { name: "Yellow", value: 2 },
  { name: "Green", value: 3 },
  { name: "Teal", value: 4 },
  { name: "Blue", value: 5 },
  { name: "Purple", value: 6 },
  { name: "White", value: 7 },
  { name: "Off", value: 8 },
];

export const LED_COLOR_SWATCHES: Readonly<Record<number, string>> = {
  0: "#e5484d",
  1: "#f76b15",
  2: "#ffd60a",
  3: "#46a758",
  4: "#12a594",
  5: "#0091ff",
  6: "#8e4ec6",
  7: "#f2f2f2",
  8: "#3a3a3c",
};

export const EFFECT_DESCRIPTIONS: Readonly<Record<number, string>> = {
  0: "No underglow.",
  1: "A dimming wave travels left to right.",
  2: "A bright pulse travels left to right.",
  3: "Rain falls top to bottom.",
  4: "Hues cycle across the board.",
  5: "Brightness breathes in and out.",
  6: "One steady colour everywhere.",
  7: "Keys light as you press them.",
  8: "Light spreads out from each press.",
  9: "Whole rows light in turn.",
  10: "Keys flicker in a random pattern.",
  11: "The whole board cycles through the rainbow.",
  12: "Rainbow rain falls top to bottom.",
  13: "Waves ripple outward from the centre.",
  14: "Light circles around the centre of the board.",
  15: "Rain falls with varied timing per column.",
  16: "A wave sweeps left to right and back.",
  17: "Colours slowly breathe in saturation.",
  18: "A slow rainbow ripples from the centre.",
};

/** Preset lighting values mirrored from the board (crates/gmk87-app/src/presets.rs). */
export interface PresetValues {
  effect: number;
  brightness: number;
  speed: number;
  orientation: number;
  rainbow: number;
  color: [number, number, number];
  ledMode: number;
  ledSaturation: number;
  ledRainbow: number;
  ledColor: number;
}

export const PRESET_VALUES: Readonly<Record<string, PresetValues>> = {
  gaming: { effect: 5, brightness: 9, speed: 1, orientation: 1, rainbow: 0, color: [255, 0, 0], ledMode: 3, ledSaturation: 9, ledRainbow: 0, ledColor: 0 },
  relaxed: { effect: 5, brightness: 3, speed: 7, orientation: 1, rainbow: 0, color: [0, 255, 255], ledMode: 3, ledSaturation: 3, ledRainbow: 0, ledColor: 4 },
  party: { effect: 12, brightness: 9, speed: 0, orientation: 1, rainbow: 1, color: [255, 255, 255], ledMode: 1, ledSaturation: 9, ledRainbow: 1, ledColor: 0 },
  minimal: { effect: 0, brightness: 0, speed: 5, orientation: 1, rainbow: 0, color: [0, 0, 0], ledMode: 3, ledSaturation: 0, ledRainbow: 0, ledColor: 8 },
  productivity: { effect: 6, brightness: 4, speed: 5, orientation: 1, rainbow: 0, color: [255, 255, 255], ledMode: 3, ledSaturation: 5, ledRainbow: 0, ledColor: 7 },
  "purple-wave": { effect: 16, brightness: 6, speed: 4, orientation: 1, rainbow: 0, color: [128, 0, 255], ledMode: 3, ledSaturation: 6, ledRainbow: 0, ledColor: 6 },
  matrix: { effect: 15, brightness: 7, speed: 2, orientation: 1, rainbow: 0, color: [0, 255, 0], ledMode: 3, ledSaturation: 7, ledRainbow: 0, ledColor: 3 },
  sunset: { effect: 5, brightness: 6, speed: 6, orientation: 1, rainbow: 0, color: [255, 128, 0], ledMode: 3, ledSaturation: 6, ledRainbow: 0, ledColor: 1 },
};
