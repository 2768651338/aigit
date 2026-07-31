import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Unmount React trees between tests so intervals/effects don't leak across cases.
afterEach(() => {
  cleanup();
});
