export const MAX_TOTAL_FRAMES = 36;
export const MIN_FRAME_DELAY_MS = 60;

export interface Budget {
  totalFrames: number;
  delayMs: number;
}

export function budgetError({ totalFrames, delayMs }: Budget): string | null {
  if (totalFrames < 1) return "No frames to upload.";
  if (totalFrames > MAX_TOTAL_FRAMES) {
    return `Animation is ${totalFrames} frames, over the ${MAX_TOTAL_FRAMES}-frame budget across both slots.`;
  }
  if (delayMs < MIN_FRAME_DELAY_MS) {
    return `Frame delay of ${delayMs} ms is below the ${MIN_FRAME_DELAY_MS} ms minimum.`;
  }
  return null;
}

/**
 * Frames the slot that is *not* being replaced will resend. The device's whole
 * image memory is rewritten on every upload, so the other slot's frames count
 * against the budget. Before any device state is known, assume the one black
 * frame a fresh `SlotStore` holds.
 */
export function otherSlotFrames(
  state: { slot0Frames: number; slot1Frames: number } | null,
  slot: "slot0" | "slot1",
): number {
  if (!state) return 1;
  return slot === "slot0" ? state.slot1Frames : state.slot0Frames;
}
