import { describe, expect, it, vi } from "vitest";
import { attio, AttioWriteError } from "../src/index.js";

describe("Attio company writes", () => {
  it("updates the explicit record with Attio values and returns a receipt", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: { id: { record_id: "record" }, web_url: "https://app.attio.com/record" },
      }),
    );
    const client = attio({ apiKey: "secret", fetch: transport });
    const result = await client.updateCompany({
      recordId: "record",
      values: { routing_research: "Verified report" },
    });
    expect(result).toEqual({ recordId: "record", url: "https://app.attio.com/record" });
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe("https://api.attio.com/v2/objects/companies/records/record");
    expect(init?.method).toBe("PATCH");
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toEqual({
      data: { values: { routing_research: "Verified report" } },
    });
    expect(init?.headers).toMatchObject({ Authorization: "Bearer secret" });
  });
  it("upserts by an explicit matching attribute and escapes path components", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { id: { record_id: "record" } } }),
    );
    const client = attio({ apiKey: "test", companyObject: "custom/object", fetch: transport });
    await client.upsertCompany({
      matchingAttribute: "domains",
      values: { domains: ["example.com"] },
    });
    expect(transport.mock.calls[0]?.[0]).toBe(
      "https://api.attio.com/v2/objects/custom%2Fobject/records?matching_attribute=domains",
    );
    expect(transport.mock.calls[0]?.[1]?.method).toBe("PUT");
  });
  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate_limited"],
    [400, "invalid_request"],
    [404, "not_found"],
    [500, "provider_error"],
  ] as const)("maps %s without exposing response bodies or retrying", async (status, code) => {
    const transport = vi.fn<typeof fetch>(async () => new Response("secret API body", { status }));
    const client = attio({ apiKey: "test", fetch: transport });
    await expect(client.updateCompany({ recordId: "record", values: {} })).rejects.toMatchObject({
      code,
      status,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("honors cancellation before making a request", async () => {
    const transport = vi.fn<typeof fetch>();
    const signal = AbortSignal.abort();
    await expect(
      attio({ apiKey: "test", fetch: transport }).updateCompany({
        recordId: "record",
        values: {},
        signal,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("sanitizes timeouts, network errors and malformed responses", async () => {
    for (const error of [new DOMException("secret", "TimeoutError"), new Error("secret")]) {
      const client = attio({
        apiKey: "test",
        fetch: async () => {
          throw error;
        },
      });
      await expect(client.updateCompany({ recordId: "record", values: {} })).rejects.toBeInstanceOf(
        AttioWriteError,
      );
      await expect(client.updateCompany({ recordId: "record", values: {} })).rejects.not.toThrow(
        "secret",
      );
    }
    await expect(
      attio({ apiKey: "test", fetch: async () => Response.json({}) }).updateCompany({
        recordId: "record",
        values: {},
      }),
    ).rejects.toMatchObject({ code: "provider_error" });
  });
});
