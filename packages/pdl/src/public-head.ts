import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";

export function isPublicAddress(address: string): boolean {
  if (!isIP(address)) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.range() !== "unicast") return false;
  // Limit IPv6 to allocated global unicast, excluding special transition blocks.
  if (parsed instanceof ipaddr.IPv6) {
    return (
      parsed.match(ipaddr.IPv6.parse("2000::"), 3) &&
      !parsed.match(ipaddr.IPv6.parse("2001::"), 23) &&
      !parsed.match(ipaddr.IPv6.parse("2002::"), 16) &&
      !parsed.match(ipaddr.IPv6.parse("3fff::"), 20)
    );
  }
  return true;
}

/** One HEAD request. Validate DNS and pin the connection to that exact address. */
export async function publicHead(
  url: URL,
  signal: AbortSignal,
): Promise<{ status: number; location?: string }> {
  signal.throwIfAborted();
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.port ||
    url.username ||
    url.password ||
    isIP(url.hostname)
  )
    throw new Error("Unsafe redirect target");
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true, verbatim: true }),
    cancelled,
  ]).finally(() => signal.removeEventListener("abort", abort));
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new Error("Non-public redirect target");
  const selected = addresses[0]!;
  const pinnedLookup: LookupFunction = (_host, _options, callback) =>
    callback(null, selected.address, selected.family);
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "HEAD",
        lookup: pinnedLookup,
        family: selected.family,
        agent: false,
        signal,
      },
      (response) => {
        // Only headers are needed; do not download arbitrary website content.
        const result = {
          status: response.statusCode ?? 0,
          ...(response.headers.location ? { location: response.headers.location } : {}),
        };
        response.destroy();
        resolve(result);
      },
    );
    req.once("error", reject);
    req.end();
  });
}
