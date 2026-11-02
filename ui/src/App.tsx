import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBanner } from "@/components/ErrorBanner";
import { StatusBar } from "@/components/StatusBar";
import DeviceScreen from "@/screens/DeviceScreen";
import DisplayScreen from "@/screens/DisplayScreen";
import LightingScreen from "@/screens/LightingScreen";
import ClockScreen from "@/screens/ClockScreen";

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <div className="px-4 pt-3">
        <ErrorBanner />
      </div>
      <Tabs defaultValue="device" className="flex min-h-0 flex-1 flex-col px-4 py-3">
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
    </div>
  );
}
