import { lazy, Suspense, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBanner } from "@/components/ErrorBanner";
import { StatusBar } from "@/components/StatusBar";
import { useDeviceEvents } from "@/lib/useDeviceEvents";
import DeviceScreen from "@/screens/DeviceScreen";
import DisplayScreen from "@/screens/DisplayScreen";
import LightingScreen from "@/screens/LightingScreen";
import ClockScreen from "@/screens/ClockScreen";
import { useAppStore } from "@/store";

// Three.js and the preview scene are a large chunk that the first screen does
// not need; load them after the shell paints.
const KeyboardPreview = lazy(() =>
  import("@/components/KeyboardPreview").then((module) => ({
    default: module.KeyboardPreview,
  })),
);

const NAV_ITEMS = [
  { value: "device", label: "Device" },
  { value: "display", label: "Display" },
  { value: "lighting", label: "Lighting" },
  { value: "clock", label: "Clock" },
] as const;

export default function App() {
  useDeviceEvents();
  const loadStoredDisplay = useAppStore((s) => s.loadStoredDisplay);
  const [tab, setTab] = useState<(typeof NAV_ITEMS)[number]["value"]>("device");

  useEffect(() => {
    void loadStoredDisplay();
  }, [loadStoredDisplay]);

  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <div className="px-4 pt-3">
        <ErrorBanner />
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex min-h-0 flex-1">
        <TabsList className="h-auto w-[180px] shrink-0 flex-col items-stretch justify-start gap-1 rounded-none bg-transparent p-3">
          {NAV_ITEMS.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="justify-start rounded-md px-3 py-2 text-left data-[state=active]:bg-white/10"
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto px-6 py-4">
          <div className="w-full max-w-3xl">
            <Suspense
              fallback={
                <div className="h-[380px] w-full rounded-lg border border-white/10 bg-gradient-to-b from-black to-neutral-900" />
              }
            >
              <KeyboardPreview zoomed={tab === "display"} className="h-[380px] w-full" />
            </Suspense>
          </div>

          <div className="w-full max-w-3xl">
            <TabsContent value="device" className="min-h-0">
              <DeviceScreen />
            </TabsContent>
            <TabsContent value="display" className="min-h-0">
              <DisplayScreen />
            </TabsContent>
            <TabsContent value="lighting" className="min-h-0">
              <LightingScreen />
            </TabsContent>
            <TabsContent value="clock" className="min-h-0">
              <ClockScreen />
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
