import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdaptiveQuality,
  FPS_TIERS,
  FRAME_STRIDE,
  INSTANCE_STRIDE,
  chooseRenderer,
  getLightingMode,
  loadLightingMode,
  packInstances,
  quantise,
  rateGate,
  resetLightingModeCache,
  saveLightingMode,
  setLightingMode,
  subscribeLightingMode,
  webgl2Available,
} from "./lightingPerf";

function feed(q: AdaptiveQuality, ms: number, n: number): number {
  let fps = q.fps;
  for (let i = 0; i < n; i++) fps = q.push(ms);
  return fps;
}

describe("AdaptiveQuality", () => {
  it("starts at the top tier and stays there while frames are cheap", () => {
    const q = new AdaptiveQuality();
    expect(q.fps).toBe(60);
    expect(feed(q, 2, 200)).toBe(60);
  });

  it("steps 60 -> 30 -> 15 when frames cost too much, and never below 15", () => {
    const q = new AdaptiveQuality();
    expect(feed(q, 14, 80)).toBe(30); // 14ms > 60% of a 16.7ms budget
    expect(feed(q, 25, 80)).toBe(15); // 25ms > 60% of a 33ms budget
    expect(feed(q, 90, 400)).toBe(15);
  });

  it("does not change tier before the window is full or during the cooldown", () => {
    const q = new AdaptiveQuality();
    expect(feed(q, 40, AdaptiveQuality.COOLDOWN - 1)).toBe(60);
    expect(q.push(40)).toBe(30);
    // The window restarts after a change, so the next step needs a fresh cooldown.
    expect(feed(q, 40, AdaptiveQuality.COOLDOWN - 1)).toBe(30);
    expect(q.push(40)).toBe(15);
  });

  it("climbs back up only when comfortably under the faster tier's budget", () => {
    const q = new AdaptiveQuality(2);
    expect(q.fps).toBe(15);
    expect(feed(q, 10, 80)).toBe(15); // too close to the 30 fps budget to risk it
    expect(feed(q, 2, 40)).toBe(30);
    expect(feed(q, 2, 40)).toBe(60);
  });

  it("clamps an out of range starting tier", () => {
    expect(new AdaptiveQuality(99).fps).toBe(FPS_TIERS[FPS_TIERS.length - 1]);
    expect(new AdaptiveQuality(-4).fps).toBe(FPS_TIERS[0]);
  });
});

describe("lighting preview setting", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    });
    resetLightingModeCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to auto and ignores junk", () => {
    expect(loadLightingMode()).toBe("auto");
    localStorage.setItem("gmk87.lightingPreview.v1", "turbo");
    expect(loadLightingMode()).toBe("auto");
  });

  it("round-trips every mode through localStorage", () => {
    for (const m of ["auto", "gpu", "cpu", "static"] as const) {
      saveLightingMode(m);
      expect(loadLightingMode()).toBe(m);
    }
  });

  it("survives storage that throws", () => {
    const bad = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadLightingMode(bad)).toBe("auto");
    expect(() => saveLightingMode("cpu", bad)).not.toThrow();
  });

  it("setLightingMode persists, updates the cached value and notifies listeners", () => {
    const seen = vi.fn();
    const off = subscribeLightingMode(seen);
    setLightingMode("static");
    expect(getLightingMode()).toBe("static");
    expect(localStorage.getItem("gmk87.lightingPreview.v1")).toBe("static");
    expect(seen).toHaveBeenCalledWith("static");
    off();
    setLightingMode("cpu");
    expect(seen).toHaveBeenCalledTimes(1);
    resetLightingModeCache();
    expect(getLightingMode()).toBe("cpu");
  });
});

describe("renderer selection", () => {
  it("treats a null WebGL2 context as unavailable", () => {
    const getContext = vi.fn().mockReturnValue(null);
    expect(webgl2Available(() => ({ getContext }))).toBe(false);
    expect(getContext).toHaveBeenCalledWith("webgl2");
  });

  it("is available when a context is returned, and unavailable when creation throws", () => {
    expect(webgl2Available(() => ({ getContext: () => ({}) }))).toBe(true);
    expect(
      webgl2Available(() => {
        throw new Error("no canvas");
      }),
    ).toBe(false);
    expect(webgl2Available(() => null)).toBe(false);
  });

  it("Auto and GPU use WebGL2 when present and fall back to the 2D canvas when not", () => {
    expect(chooseRenderer("auto", true)).toBe("gl");
    expect(chooseRenderer("gpu", true)).toBe("gl");
    expect(chooseRenderer("auto", false)).toBe("2d");
    expect(chooseRenderer("gpu", false)).toBe("2d");
  });

  it("CPU always uses 2D and Static never animates", () => {
    expect(chooseRenderer("cpu", true)).toBe("2d");
    expect(chooseRenderer("static", true)).toBe("static");
    expect(chooseRenderer("static", false)).toBe("static");
  });
});

describe("packInstances", () => {
  const keys = [
    { x: 10, y: 20, w: 100, h: 50, ax: 0, ay: 0 },
    { x: 200, y: 20, w: 100, h: 50, ax: 100, ay: 0 },
    { x: 300, y: 80, w: 40, h: 50, ax: 0, ay: 50 },
  ];

  it("writes rect, atlas uv, colour and intensity, skipping dark keys", () => {
    const frame = new Float32Array(3 * FRAME_STRIDE);
    frame.set([255, 128, 0, 0.5, 0.08], 0);
    frame.set([1, 2, 3, 0, 0], FRAME_STRIDE); // off
    frame.set([0, 255, 255, 1, 0.17], 2 * FRAME_STRIDE);
    const out = new Float32Array(3 * INSTANCE_STRIDE);
    const n = packInstances(keys, frame, 200, 100, out);
    expect(n).toBe(2);
    const first = Array.from(out.slice(0, INSTANCE_STRIDE));
    expect(first.slice(0, 8)).toEqual([10, 20, 100, 50, 0, 0, 0.5, 0.5]);
    expect(first[8]).toBe(1);
    expect(first[9]).toBeCloseTo(128 / 255, 6);
    expect(first[10]).toBe(0);
    expect(first[11]).toBe(0.5);
    const second = Array.from(out.slice(INSTANCE_STRIDE, INSTANCE_STRIDE * 2));
    expect(second.slice(0, 4)).toEqual([300, 80, 40, 50]);
    expect(second.slice(4, 8).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0.5, 0.2, 1]);
    expect(second[11]).toBe(1);
  });

  it("returns zero when everything is dark", () => {
    const out = new Float32Array(3 * INSTANCE_STRIDE);
    expect(packInstances(keys, new Float32Array(3 * FRAME_STRIDE), 64, 64, out)).toBe(0);
  });
});

describe("ambient helpers", () => {
  it("quantises to 4 bits per channel", () => {
    expect(quantise(0, 4)).toBe(0);
    expect(quantise(255, 4)).toBe(255);
    expect(quantise(130, 4)).toBe(136);
    expect(quantise(300, 4)).toBe(255);
    expect(quantise(-5, 4)).toBe(0);
    const levels = new Set(Array.from({ length: 256 }, (_, v) => quantise(v, 4)));
    expect(levels.size).toBe(16);
  });

  it("rateGate lets at most hz calls per second through", () => {
    const gate = rateGate(10);
    expect(gate(0)).toBe(true);
    expect(gate(50)).toBe(false);
    expect(gate(99)).toBe(false);
    expect(gate(100)).toBe(true);
    expect(gate(150)).toBe(false);
  });
});
