import "@testing-library/jest-dom";

// jsdom does not implement object URLs; the store uses them for preview blobs.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:mock";
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}
