import { afterEach, describe, expect, it, vi } from "vitest";
import { pdl } from "../src/index.js";

const profile = {
  status: 200,
  id: "company-acme",
  likelihood: 9,
  name: "acme",
  display_name: "Acme",
  website: "https://www.acme.example/about",
  employee_count: 650,
  location: { country: "united states" },
  industry: "software",
};
function mockResponse(body: unknown = profile, status = 200) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("PDL company enrichment", () => {
  it("authenticates in a header and maps the top-level company response", async () => {
    const fetcher = mockResponse();
    expect(
      await pdl({ apiKey: "test-secret" }).enrich({ domain: " ACME.example ", name: "Acme & Co" }),
    ).toEqual({
      status: "found",
      company: {
        name: "Acme",
        domain: "acme.example",
        employeeCount: 650,
        country: "US",
        industry: "software",
      },
    });
    const [url, init] = fetcher.mock.calls[0]!;
    const requestUrl = new URL(String(url));
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      "https://api.peopledatalabs.com/v5/company/enrich",
    );
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      website: "acme.example",
      min_likelihood: "6",
      name: "Acme & Co",
    });
    expect(init?.headers).toMatchObject({ "X-Api-Key": "test-secret" });
    expect(init?.redirect).toBe("error");
    expect(String(url)).not.toContain("test-secret");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    [" United Kingdom ", "GB"],
    ["germany", "DE"],
    ["india", "IN"],
    ["us", "US"],
    ["south korea", "KR"],
    ["Atlantis", undefined],
    [null, undefined],
  ])("normalizes country %s", async (country, expected) => {
    mockResponse({ ...profile, location: { country } });
    const result = await pdl({ apiKey: "test" }).enrich({ domain: "acme.example" });
    expect(result.status).toBe("found");
    if (result.status === "found") expect(result.company.country).toBe(expected);
  });
  it.each([null, "650", -1, 2.5])(
    "does not invent employee counts for %s",
    async (employee_count) => {
      mockResponse({
        ...profile,
        employee_count,
        size: "501-1000",
        location: null,
        display_name: null,
        industry: null,
        website: null,
      });
      expect(await pdl({ apiKey: "test" }).enrich({ domain: "acme.example" })).toEqual({
        status: "found",
        company: { name: "acme" },
      });
    },
  );
  it("preserves zero employees", async () => {
    mockResponse({ ...profile, employee_count: 0 });
    expect(await pdl({ apiKey: "test" }).enrich({ domain: "acme.example" })).toMatchObject({
      company: { employeeCount: 0 },
    });
  });
  it.each([
    [404, { status: "not_found" }],
    [401, { status: "unavailable", reason: "unauthorized" }],
    [403, { status: "unavailable", reason: "unauthorized" }],
    [429, { status: "unavailable", reason: "rate_limited" }],
    [402, { status: "unavailable", reason: "provider_error" }],
    [500, { status: "unavailable", reason: "provider_error" }],
  ])("maps HTTP %s without exposing errors or retrying", async (status, expected) => {
    const fetcher = mockResponse({ error: "sensitive error" }, status);
    expect(await pdl({ apiKey: "test" }).enrich({ domain: "acme.example" })).toEqual(expected);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    [],
    {},
    { status: 200, data: profile },
    { ...profile, likelihood: "9" },
    { ...profile, status: 500 },
  ])("rejects malformed successful payloads", async (body) => {
    mockResponse(body);
    expect(await pdl({ apiKey: "test" }).enrich({ domain: "acme.example" })).toEqual({
      status: "unavailable",
      reason: "provider_error",
    });
  });
  it("handles malformed JSON and network failures safely", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not JSON"))
      .mockRejectedValueOnce(new Error("sensitive error"));
    vi.stubGlobal("fetch", fetcher);
    const provider = pdl({ apiKey: "test" });
    for (let i = 0; i < 2; i++)
      expect(await provider.enrich({ domain: "acme.example" })).toEqual({
        status: "unavailable",
        reason: "provider_error",
      });
  });
  it("enforces the deadline while waiting for the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(
        async (_url, init) =>
          new Response(
            new ReadableStream({
              start(controller) {
                init?.signal?.addEventListener(
                  "abort",
                  () => controller.error(init.signal?.reason),
                  { once: true },
                );
              },
            }),
          ),
      ),
    );
    expect(await pdl({ apiKey: "test", timeoutMs: 10 }).enrich({ domain: "acme.example" })).toEqual(
      { status: "unavailable", reason: "timeout" },
    );
  });
  it("supports a confidence override and rejects below-threshold results", async () => {
    const fetcher = mockResponse({ ...profile, likelihood: 5 });
    expect(await pdl({ apiKey: "test" }).enrich({ domain: "acme.example" })).toEqual({
      status: "not_found",
    });
    expect(
      await pdl({ apiKey: "test", minLikelihood: 4 }).enrich({ domain: "acme.example" }),
    ).toMatchObject({ status: "found" });
    expect(new URL(String(fetcher.mock.calls[1]![0])).searchParams.get("min_likelihood")).toBe("4");
  });
  it("validates configuration before making requests", () => {
    const fetcher = mockResponse();
    expect(() => pdl({ apiKey: " " })).toThrow("API key");
    expect(() => pdl({ apiKey: "test", timeoutMs: 0 })).toThrow("timeoutMs");
    expect(() => pdl({ apiKey: "test", minLikelihood: 11 })).toThrow("minLikelihood");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
