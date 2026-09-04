import { afterEach, describe, expect, it } from "vitest";
import { attio } from "../src/index.js";
import { startFakeAttio, type FakeAttio } from "./fake-attio.js";

let fakeAttio: FakeAttio | undefined;

afterEach(async () => {
  await fakeAttio?.close();
  fakeAttio = undefined;
});

describe("Attio ownership provider", () => {
  it("returns a normalized owner identity", async () => {
    fakeAttio = await startFakeAttio();
    const provider = attio({ apiKey: "test", baseUrl: fakeAttio.baseUrl });

    await expect(provider.findOwner({ domain: "acme.example" })).resolves.toEqual({
      status: "owned",
      company: { id: "company_acme", name: "Acme Corporation" },
      owner: {
        id: "rep_marcus",
        name: "Marcus Lee",
        email: "marcus@northstar.example",
      },
    });
  });

  it("distinguishes an unowned company", async () => {
    fakeAttio = await startFakeAttio();
    const provider = attio({ apiKey: "test", baseUrl: fakeAttio.baseUrl });

    await expect(provider.findOwner({ domain: "unowned.example" })).resolves.toEqual({
      status: "unowned",
      company: { id: "company_unowned", name: "Unowned Systems" },
    });
  });

  it("distinguishes a missing company", async () => {
    fakeAttio = await startFakeAttio();
    const provider = attio({ apiKey: "test", baseUrl: fakeAttio.baseUrl });

    await expect(provider.findOwner({ domain: "unknown.example" })).resolves.toEqual({
      status: "company_not_found",
    });
  });
});
