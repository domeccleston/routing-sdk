import { afterEach, expect, it, vi } from "vitest";
import { attio } from "../src/index.js";

afterEach(() => vi.unstubAllEnvs());
it("reads the conventional environment key and allows explicit overrides", async () => {
  vi.stubEnv("ATTIO_API_KEY", "env-test-key");
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(JSON.stringify({ data: [] })));
  await attio({ fetch: transport }).findOwner({ domain: "example.com" });
  expect(transport.mock.calls[0]?.[1]?.headers).toMatchObject({
    Authorization: "Bearer env-test-key",
  });
  await attio({ apiKey: "explicit-test-key", fetch: transport }).findOwner({
    domain: "example.com",
  });
  expect(transport.mock.calls[1]?.[1]?.headers).toMatchObject({
    Authorization: "Bearer explicit-test-key",
  });
});
it("fails during construction when credentials are missing or blank", () => {
  vi.stubEnv("ATTIO_API_KEY", "");
  expect(() => attio()).toThrow("API key");
  vi.stubEnv("ATTIO_API_KEY", "env-test-key");
  expect(() => attio({ apiKey: " " })).toThrow("API key");
});
