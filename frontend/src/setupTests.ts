import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// testing-library's auto-cleanup only self-registers when it detects a
// global afterEach (vitest doesn't inject one unless test.globals is set),
// so without this, each render() leaves its DOM in place for the next test
// in the same file — harmless until two tests render the same static markup
// (e.g. two "Log in" buttons), at which point queries start matching more
// than one element.
afterEach(() => {
  cleanup();
});
