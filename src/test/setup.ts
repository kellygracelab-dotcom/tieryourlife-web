import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

// jsdom cannot scroll, and says so loudly every time the router asks it to.
window.scrollTo = () => undefined;

afterEach(() => window.localStorage.clear());

// A test that switches to fake timers and fails before switching back would
// leave every later test in its file on a frozen clock.
afterEach(() => vi.useRealTimers());
