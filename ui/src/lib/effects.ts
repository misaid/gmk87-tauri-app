export interface NamedValue {
  name: string;
  value: number;
}

/** The 19 underglow effects, in device order (spec §3.5). */
export const UNDERGLOW_EFFECTS: readonly NamedValue[] = [
  { name: "Off", value: 0 },
  { name: "Horizontal dimming wave", value: 1 },
  { name: "Horizontal pulse wave", value: 2 },
  { name: "Waterfall", value: 3 },
  { name: "Full cycling colors", value: 4 },
  { name: "Breathing", value: 5 },
  { name: "Full one color", value: 6 },
  { name: "Glow pressed key", value: 7 },
  { name: "Glow spreading", value: 8 },
  { name: "Glow row", value: 9 },
  { name: "Random pattern", value: 10 },
  { name: "Rainbow cycle", value: 11 },
  { name: "Rainbow waterfall", value: 12 },
  { name: "Wave from center", value: 13 },
  { name: "Circling J/K", value: 14 },
  { name: "Raining", value: 15 },
  { name: "Wave left-right", value: 16 },
  { name: "Slow saturation cycle", value: 17 },
  { name: "Slow rainbow from center", value: 18 },
];

export const LED_MODES: readonly NamedValue[] = [
  { name: "Blinking one color", value: 0 },
  { name: "Pulse rainbow", value: 1 },
  { name: "Blinking one color (alternate)", value: 2 },
  { name: "Fixed color", value: 3 },
  { name: "Fixed color (alternate)", value: 4 },
];

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
