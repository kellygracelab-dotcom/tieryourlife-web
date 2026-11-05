import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { resetStorageTroubleForTests } from "../lib/storage";

afterEach(cleanup);

// jsdom cannot scroll, and says so loudly every time the router asks it to.
window.scrollTo = () => undefined;

afterEach(() => window.localStorage.clear());

// What a blocked browser refused is held for the visit, and a test is a visit.
afterEach(() => resetStorageTroubleForTests());

// The site shows no board until Firebase has said who is here; a page test
// has no Firebase, and its boards are a guest's from the start.
window.localStorage.setItem("tyl:owners", "1");

// A test that switches to fake timers and fails before switching back would
// leave every later test in its file on a frozen clock.
afterEach(() => vi.useRealTimers());
