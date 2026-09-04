import { beforeEach, describe, expect, it, vi } from "vitest";
import { publicHead } from "../src/public-head.js";
import { resolveDomain } from "../src/resolve-domain.js";

vi.mock("../src/public-head.js", () => ({ publicHead: vi.fn() }));
const head = vi.mocked(publicHead);
beforeEach(() => {
  head.mockReset();
});
describe("company domain redirect resolution", () => {
  it("follows relative and cross-domain redirects and strips www from the final host", async () => {
    head
      .mockResolvedValueOnce({ status: 301, location: "/about" })
      .mockResolvedValueOnce({ status: 308, location: "https://www.new-company.com/home" })
      .mockResolvedValueOnce({ status: 200 });
    expect(await resolveDomain("old-company.com", 800)).toBe("new-company.com");
    expect(head.mock.calls.map(([url]) => url.href)).toEqual([
      "https://old-company.com/",
      "https://old-company.com/about",
      "https://www.new-company.com/home",
    ]);
    expect(new Set(head.mock.calls.map(([, signal]) => signal)).size).toBe(1);
  });
  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/",
    "http://2130706433/",
    "file:///etc/passwd",
    "https://user:pass@other.com/",
    "https://other.com:8443/",
    "https://intranet/",
    "http://metadata.internal/",
    "https://smallco.squarespace.com/",
    "https://afternic.com/sale",
  ])("does not request unsafe or shared redirect %s", async (location) => {
    head.mockResolvedValue({ status: 302, location });
    expect(await resolveDomain("old-company.com", 800)).toBe("old-company.com");
    expect(head).toHaveBeenCalledTimes(1);
  });
  it.each(["localhost", "127.0.0.1", "acme.example", "corp.local", "intranet", "[::1]"])(
    "does not request reserved input %s",
    async (domain) => {
      expect(await resolveDomain(domain, 800)).toBe(domain);
      expect(head).not.toHaveBeenCalled();
    },
  );
  it("falls back for loops, missing locations, and too many hops", async () => {
    head.mockResolvedValue({ status: 301, location: "/" });
    expect(await resolveDomain("old-company.com", 800)).toBe("old-company.com");
    expect(head).toHaveBeenCalledTimes(1);
    head.mockReset().mockResolvedValue({ status: 301 });
    expect(await resolveDomain("old-company.com", 800)).toBe("old-company.com");
    head
      .mockReset()
      .mockImplementation(async (url) => ({ status: 301, location: `${url.pathname}next/` }));
    expect(await resolveDomain("old-company.com", 800)).toBe("old-company.com");
    expect(head).toHaveBeenCalledTimes(6);
  });
  it("falls back on lookup or request errors and server failures", async () => {
    head.mockRejectedValueOnce(new Error("DNS failure"));
    expect(await resolveDomain("old-company.com", 800)).toBe("old-company.com");
    head
      .mockResolvedValueOnce({ status: 302, location: "https://new-company.com" })
      .mockResolvedValueOnce({ status: 500 });
    expect(await resolveDomain("old-company.com", 800)).toBe("old-company.com");
  });
  it("bounds the entire chain with one deadline", async () => {
    head.mockImplementation(
      (_url, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    expect(await resolveDomain("old-company.com", 10)).toBe("old-company.com");
  });
});
