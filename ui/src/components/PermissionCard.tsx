import { Button } from "@/components/ui/button";

// Both transports: the wired keyboard (5055) and the 2.4 GHz dongle (5088),
// matching packaging/50-gmk87.rules.
const RULES = [
  'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="320f", ATTRS{idProduct}=="5055", TAG+="uaccess"',
  'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="320f", ATTRS{idProduct}=="5088", TAG+="uaccess"',
].join("\n");
const COMMANDS = [
  "sudo cp packaging/50-gmk87.rules /etc/udev/rules.d/",
  "sudo udevadm control --reload-rules",
  "sudo udevadm trigger",
].join("\n");

export function PermissionCard() {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
      <p className="font-medium">The keyboard could not be opened without root.</p>
      <p className="text-xs text-amber-100/80">Install the udev rule, then replug the keyboard:</p>
      <code className="block overflow-x-auto whitespace-pre rounded bg-black/40 p-2 text-xs">
        {RULES}
      </code>
      <pre className="overflow-x-auto rounded bg-black/40 p-2 text-xs">{COMMANDS}</pre>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void navigator.clipboard.writeText(`${RULES}\n${COMMANDS}`)}
      >
        Copy commands
      </Button>
    </div>
  );
}
