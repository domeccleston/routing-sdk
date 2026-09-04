import { afterEach, expect, it, vi } from "vitest";
import { pdl } from "../src/index.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("reads the conventional environment key and allows explicit overrides", async () => {
  vi.stubEnv("PDL_API_KEY", "env-test-key");
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", transport);
  await pdl({ resolveRedirects: false }).enrich({ domain: "example.com" });
  expect(transport.mock.calls[0]?.[1]?.headers).toMatchObject({ "X-Api-Key": "env-test-key" });
  await pdl({ apiKey: "explicit-test-key", resolveRedirects: false }).enrich({
    domain: "example.com",
  });
  expect(transport.mock.calls[1]?.[1]?.headers).toMatchObject({ "X-Api-Key": "explicit-test-key" });
});
it("fails during construction when credentials are missing or blank", () => {
  vi.stubEnv("PDL_API_KEY", "");
  expect(() => pdl()).toThrow("API key");
  vi.stubEnv("PDL_API_KEY", "env-test-key");
  expect(() => pdl({ apiKey: " " })).toThrow("API key");
});
