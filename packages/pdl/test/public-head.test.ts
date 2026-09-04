import { EventEmitter } from "node:events";
import type { RequestOptions } from "node:https";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPublicAddress, publicHead } from "../src/public-head.js";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:http", () => ({ request: mocks.request }));
vi.mock("node:https", () => ({ request: mocks.request }));
beforeEach(() => {
  mocks.lookup.mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  mocks.request.mockReset().mockImplementation((_options, callback) => {
    const req = new EventEmitter();
    return Object.assign(req, {
      end: () => callback({ statusCode: 200, headers: {}, destroy: vi.fn() }),
    });
  });
});
describe("public-only HEAD requests", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "2002:7f00:1::",
    "64:ff9b::7f00:1",
    "3fff::1",
    "invalid",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
  it("pins the socket to the checked address without forwarding credentials", async () => {
    await expect(
      publicHead(new URL("https://company.com/path?q=1"), AbortSignal.timeout(800)),
    ).resolves.toEqual({ status: 200 });
    const options = mocks.request.mock.calls[0]![0] as RequestOptions;
    expect(options).toMatchObject({
      hostname: "company.com",
      path: "/path?q=1",
      method: "HEAD",
      agent: false,
      family: 4,
    });
    expect(options.headers).toBeUndefined();
    const pinned = options.lookup as (
      host: string,
      opts: object,
      cb: (err: unknown, address: string, family: number) => void,
    ) => void;
    const callback = vi.fn();
    pinned("company.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ address: "127.0.0.1", family: 4 }],
    [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
    [],
  ])("rejects DNS answers containing private addresses", async (...addresses) => {
    mocks.lookup.mockResolvedValue(addresses);
    await expect(
      publicHead(new URL("https://company.com"), AbortSignal.timeout(800)),
    ).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("bounds DNS lookup and does not connect after expiry", async () => {
    mocks.lookup.mockReturnValue(new Promise(() => {}));
    await expect(
      publicHead(new URL("https://company.com"), AbortSignal.timeout(10)),
    ).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
