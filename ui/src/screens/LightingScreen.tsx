import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { LED_COLORS, LED_COLOR_SWATCHES, LED_MODES, UNDERGLOW_EFFECTS } from "@/lib/effects";
import { useAppStore } from "@/store";

export default function LightingScreen() {
  const state = useAppStore((s) => s.state);
  const presets = useAppStore((s) => s.presets);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const applyPreset = useAppStore((s) => s.applyPreset);
  const applyLighting = useAppStore((s) => s.applyLighting);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  if (!state) {
    return <p className="pt-3 text-sm text-white/50">Connect a keyboard to edit lighting.</p>;
  }

  const { underglow, led } = state;

  return (
    <div className="flex max-w-3xl flex-col gap-6 pt-3 text-sm">
      <section className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset.name}
            variant="outline"
            size="sm"
            title={preset.description}
            onClick={() => void applyPreset(preset.name)}
          >
            {preset.name.replace(/-/g, " ")}
          </Button>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <Label htmlFor="effect">Underglow effect</Label>
        <select
          id="effect"
          className="h-9 rounded-md border border-white/15 bg-neutral-900 px-2"
          value={underglow.effect}
          onChange={(e) => void applyLighting({ underglowEffect: Number(e.target.value) })}
        >
          {UNDERGLOW_EFFECTS.map((effect) => (
            <option key={effect.value} value={effect.value}>
              {effect.name}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Brightness: {underglow.brightness}</Label>
            <Slider
              min={0}
              max={9}
              step={1}
              value={[underglow.brightness]}
              onValueChange={([v]) => void applyLighting({ underglowBrightness: v })}
            />
          </div>
          <div>
            <Label>Speed: {underglow.speed} (0 fast → 9 slow)</Label>
            <Slider
              min={0}
              max={9}
              step={1}
              value={[underglow.speed]}
              onValueChange={([v]) => void applyLighting({ underglowSpeed: v })}
            />
          </div>
        </div>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2">
            <Switch
              checked={underglow.rainbow === 1}
              onCheckedChange={(checked) => void applyLighting({ underglowRainbow: checked ? 1 : 0 })}
            />
            Rainbow
          </label>
          <label className="flex items-center gap-2">
            <Switch
              checked={underglow.orientation === 1}
              onCheckedChange={(checked) =>
                void applyLighting({ underglowOrientation: checked ? 1 : 0 })
              }
            />
            Right to left
          </label>
          <label className="flex items-center gap-2">
            <span className="text-white/60">Colour</span>
            <input
              type="color"
              aria-label="Underglow colour"
              value={`#${underglow.color.map((c) => c.toString(16).padStart(2, "0")).join("")}`}
              onChange={(e) => {
                const hex = e.target.value;
                void applyLighting({
                  underglowColor: [
                    parseInt(hex.slice(1, 3), 16),
                    parseInt(hex.slice(3, 5), 16),
                    parseInt(hex.slice(5, 7), 16),
                  ],
                });
              }}
            />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Label>Side LED mode</Label>
        <select
          className="h-9 rounded-md border border-white/15 bg-neutral-900 px-2"
          value={led.mode}
          onChange={(e) => void applyLighting({ ledMode: Number(e.target.value) })}
        >
          {LED_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          {LED_COLORS.map((color) => (
            <button
              key={color.value}
              aria-label={color.name}
              title={color.name}
              className={
                led.color === color.value
                  ? "size-7 rounded-full ring-2 ring-white"
                  : "size-7 rounded-full ring-1 ring-white/20"
              }
              style={{ background: LED_COLOR_SWATCHES[color.value] }}
              onClick={() => void applyLighting({ ledColor: color.value })}
            />
          ))}
        </div>

        <div>
          <Label>LED saturation: {led.saturation}</Label>
          <Slider
            min={0}
            max={9}
            step={1}
            value={[led.saturation]}
            onValueChange={([v]) => void applyLighting({ ledSaturation: v })}
          />
        </div>
      </section>

      <label className="flex items-center gap-2">
        <Switch
          checked={state.winLock}
          onCheckedChange={(checked) => void applyLighting({ winLock: checked })}
        />
        Lock the Windows key
      </label>
    </div>
  );
}
