import "@testing-library/jest-dom";

// jsdom does not implement object URLs; the store uses them for preview blobs.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:mock";
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}

// Radix primitives (Slider, Tooltip) observe element size; jsdom has no
// ResizeObserver, so the tests need a no-op.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom does not implement PointerEvent, so its events carry no clientX/Y and
// the crop editor's drag math sees NaN. A MouseEvent subclass restores them.
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventStub extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  globalThis.PointerEvent = PointerEventStub as unknown as typeof PointerEvent;
}
