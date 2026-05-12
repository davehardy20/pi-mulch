import { describe, it, expect } from "vitest";
import { createState, resetState } from "../src/state.js";

describe("createState", () => {
  it("returns fresh state with defaults", () => {
    const state = createState();
    expect(state.initOffered).toBe(false);
    expect(state.initDeclined).toBe(false);
    expect(state.primedOnce).toBe(false);
    expect(state.lastPrimeHash).toBeNull();
    expect(state.touchedFiles.size).toBe(0);
    expect(state.lastLinterStatus).toBe("unknown");
    expect(state.draftInProgress).toBe(false);
  });
});

describe("resetState", () => {
  it("clears all mutable fields", () => {
    const state = createState();
    state.initOffered = true;
    state.initDeclined = true;
    state.primedOnce = true;
    state.lastPrimeHash = "abc";
    state.touchedFiles.add("/file.ts");
    state.lastLinterStatus = "clean";
    state.draftInProgress = true;

    resetState(state);

    expect(state.initOffered).toBe(false);
    expect(state.primedOnce).toBe(false);
    expect(state.lastPrimeHash).toBeNull();
    expect(state.touchedFiles.size).toBe(0);
    expect(state.lastLinterStatus).toBe("unknown");
    expect(state.draftInProgress).toBe(false);
  });
});
