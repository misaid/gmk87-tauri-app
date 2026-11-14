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
    <div className="flex flex-col gap-2 rounded-[14px] border border-[var(--warn)]/30 bg-[var(--warn)]/10 p-3.5 text-[13px] text-[#fde68a]">
      <p className="font-medium">Keyboard access denied.</p>
      <details className="rounded-[10px] bg-black/40 p-2">
        <summary className="cursor-pointer text-xs font-medium">udev rule</summary>
        <code className="mt-2 block overflow-x-auto whitespace-pre text-xs">
          {RULES}
        </code>
        <pre className="mt-2 overflow-x-auto text-xs">{COMMANDS}</pre>
      </details>
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
