import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pdl } from "../src/index.js";
import { resolveDomain } from "../src/resolve-domain.js";
vi.mock("../src/resolve-domain.js", () => ({ resolveDomain: vi.fn() }));
beforeEach(() => vi.mocked(resolveDomain).mockReset().mockResolvedValue("new-company.com"));
afterEach(() => vi.unstubAllGlobals());
it("resolves redirects by default before sending the domain to PDL", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  await pdl({ apiKey: "test" }).enrich({ domain: "old-company.com" });
  expect(resolveDomain).toHaveBeenCalledWith("old-company.com", 800);
  expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get("website")).toBe(
    "new-company.com",
  );
});
it("skips resolution when disabled", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  await pdl({ apiKey: "test", resolveRedirects: false }).enrich({ domain: "old-company.com" });
  expect(resolveDomain).not.toHaveBeenCalled();
  expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get("website")).toBe(
    "old-company.com",
  );
});
it("accepts a redirect deadline override and rejects invalid options", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 404 })),
  );
  await pdl({ apiKey: "test", redirectTimeoutMs: 100 }).enrich({ domain: "old-company.com" });
  expect(resolveDomain).toHaveBeenCalledWith("old-company.com", 100);
  expect(() => pdl({ apiKey: "test", redirectTimeoutMs: 0 })).toThrow("redirectTimeoutMs");
});
