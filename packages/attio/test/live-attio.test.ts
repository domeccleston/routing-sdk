import { describe, expect, it } from "vitest";

const live = process.env.RUN_ATTIO_INTEGRATION_TESTS === "1";

describe.skipIf(!live)("live Attio contract", () => {
  it("can read workspace members with the configured credential", async () => {
    const apiKey = process.env.ATTIO_API_KEY;
    expect(apiKey, "ATTIO_API_KEY must be set for live tests").toBeTruthy();

    const response = await fetch("https://api.attio.com/v2/workspace_members", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data?: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});
