import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom cannot scroll, and says so loudly every time the router asks it to.
window.scrollTo = () => undefined;

afterEach(() => window.localStorage.clear());
