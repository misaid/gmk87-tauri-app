import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { budgetError } from "@/lib/budget";
import { useAppStore } from "@/store";

export function UploadControls() {
  const uploads = useAppStore((s) => s.uploads);
  const progress = useAppStore((s) => s.progress);
  const upload = useAppStore((s) => s.upload);
  const cancel = useAppStore((s) => s.cancel);
  const delayMs = useAppStore((s) => s.delayMs);
  const totalFrames = useAppStore((s) => s.totalFrames);
  const source = useAppStore((s) => s.source);

  const busy = uploads > 0;
  const problem = source ? budgetError({ totalFrames, delayMs }) : null;
  const percent =
    progress && progress.totalBytes > 0
      ? Math.round((progress.bytesSent / progress.totalBytes) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-2">
      <Button
        disabled={busy || !source || problem !== null}
        onClick={() => void upload(delayMs, true)}
      >
        Upload and show
      </Button>
      <Button variant="outline" disabled={!busy} onClick={() => void cancel()}>
        Cancel
      </Button>
      {busy && (
        <div className="flex flex-col gap-1">
          <Progress value={percent} />
          <span className="text-xs text-white/50">
            {percent}% · {totalFrames} frames
          </span>
        </div>
      )}
    </div>
  );
}
