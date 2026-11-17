import { Button } from "@/components/ui/button";

// Both transports: the wired keyboard (5055) and the 2.4 GHz dongle (5088).
// The command is self-contained so it works from a packaged build with no repo checkout.
const RULES = [
  'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="320f", ATTRS{idProduct}=="5055", TAG+="uaccess"',
  'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="320f", ATTRS{idProduct}=="5088", TAG+="uaccess"',
];
const COMMANDS = [
  "sudo tee /etc/udev/rules.d/50-gmk87.rules <<'EOF'",
  ...RULES,
  "EOF",
  "sudo udevadm control --reload-rules",
  "sudo udevadm trigger",
].join("\n");

/** Whether the webview runs on Linux, the only platform where hidraw permissions are a udev matter. */
export function isLinux(): boolean {
  return typeof navigator !== "undefined" && /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);
}

export function PermissionCard() {
  return (
    <div className="panel flex flex-col gap-2 border-l-2 border-l-[var(--warn)] p-3.5 text-[13px]">
      <p className="font-medium text-[var(--warn)]">Keyboard access denied.</p>
      <p className="text-[var(--muted)]">
        Linux needs a udev rule before an app can open the keyboard. Run this once, then unplug and replug the keyboard.
      </p>
      <pre className="readout overflow-x-auto rounded-[var(--r-ctl)] bg-[var(--bg-sunk)] p-2.5 text-[11.5px]">{COMMANDS}</pre>
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void navigator.clipboard.writeText(COMMANDS)}
        >
          Copy commands
        </Button>
      </div>
    </div>
  );
}
