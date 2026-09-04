import { describe, expect, it } from "vitest";
import { parseResearchReport, piResearch } from "../src/pi-research.js";

describe("Pi research boundary", () => {
  const valid = {
    brief: "Company research with uncertainty",
    sources: ["https://linear.app/about"],
    proposedChanges: [
      { field: "territory", value: "us-commercial", reason: "Source-backed review" },
    ],
  };
  it("accepts sourced reports and advisory changes without restricting agent work", () => {
    expect(parseResearchReport(valid)).toEqual(valid);
  });
  it.each([
    null,
    {},
    { ...valid, brief: " " },
    { ...valid, sources: [] },
    { ...valid, sources: ["javascript:alert(1)"] },
    { ...valid, sources: ["https://secret@example.com"] },
    { ...valid, proposedChanges: [{ field: "territory" }] },
  ])("rejects malformed report %#", (report) => {
    expect(() => parseResearchReport(report)).toThrow("Invalid research report");
  });
  it("fails before launching a sandbox when credentials are missing", () => {
    expect(() =>
      piResearch({ model: "test", directory: "/unused", openRouterApiKey: "", parallelApiKey: "" }),
    ).toThrow("Research credentials required");
  });
});
