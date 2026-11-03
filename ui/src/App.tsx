import { lazy, Suspense, useEffect } from "react";
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

export default function App() {
  useDeviceEvents();
  const loadStoredDisplay = useAppStore((s) => s.loadStoredDisplay);

  useEffect(() => {
    void loadStoredDisplay();
  }, [loadStoredDisplay]);

  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <div className="px-4 pt-3">
        <ErrorBanner />
      </div>
      <div className="flex min-h-0 flex-1 gap-4 px-4 py-3">
        <Tabs defaultValue="device" className="flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="device">Device</TabsTrigger>
            <TabsTrigger value="display">Display</TabsTrigger>
            <TabsTrigger value="lighting">Lighting</TabsTrigger>
            <TabsTrigger value="clock">Clock</TabsTrigger>
          </TabsList>
          <TabsContent value="device" className="min-h-0 flex-1">
            <DeviceScreen />
          </TabsContent>
          <TabsContent value="display" className="min-h-0 flex-1">
            <DisplayScreen />
          </TabsContent>
          <TabsContent value="lighting" className="min-h-0 flex-1">
            <LightingScreen />
          </TabsContent>
          <TabsContent value="clock" className="min-h-0 flex-1">
            <ClockScreen />
          </TabsContent>
        </Tabs>
        <aside className="w-[360px] shrink-0">
          <Suspense
            fallback={
              <div className="h-[320px] w-full rounded-lg border border-white/10 bg-gradient-to-b from-black to-neutral-900" />
            }
          >
            <KeyboardPreview />
          </Suspense>
        </aside>
      </div>
    </div>
  );
}
