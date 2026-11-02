import { useEffect } from "react";
import * as ipc from "./ipc";
import { useAppStore } from "@/store";

/**
 * Bridges the backend's `upload://progress` and `device://disconnected` events
 * into the store. Mounted once by the app shell.
 */
export function useDeviceEvents() {
  const setProgress = useAppStore((s) => s.setProgress);
  const handleDisconnected = useAppStore((s) => s.handleDisconnected);

  useEffect(() => {
    let alive = true;
    const unlisteners: Array<() => void> = [];

    void ipc.onUploadProgress(setProgress).then((unlisten) => {
      if (alive) unlisteners.push(unlisten);
      else unlisten();
    });
    void ipc.onDeviceDisconnected(handleDisconnected).then((unlisten) => {
      if (alive) unlisteners.push(unlisten);
      else unlisten();
    });

    return () => {
      alive = false;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [setProgress, handleDisconnected]);
}
