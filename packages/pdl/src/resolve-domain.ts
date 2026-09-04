import { publicHead } from "./public-head.js";

const reserved = [
  "localhost",
  "local",
  "internal",
  "intranet",
  "home.arpa",
  "invalid",
  "test",
  "example",
];
// A hosted/parked site is not evidence that the prospect is the hosting company.
const shared = [
  "squarespace.com",
  "wixsite.com",
  "wix.com",
  "weebly.com",
  "webnode.com",
  "godaddysites.com",
  "business.site",
  "sites.google.com",
  "myshopify.com",
  "wordpress.com",
  "blogspot.com",
  "webflow.io",
  "carrd.co",
  "notion.site",
  "framer.website",
  "github.io",
  "netlify.app",
  "vercel.app",
  "pages.dev",
  "hugedomains.com",
  "sedoparking.com",
  "afternic.com",
  "dan.com",
  "porkbun.com",
  "namecheap.com",
  "godaddy.com",
];
const hostnamePattern =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/;
const redirects = new Set([301, 302, 303, 307, 308]);
const normalize = (host: string) => host.toLowerCase().replace(/^www\./, "");
function safeTarget(url: URL): boolean {
  return (
    ["http:", "https:"].includes(url.protocol) &&
    !url.port &&
    !url.username &&
    !url.password &&
    hostnamePattern.test(url.hostname) &&
    ![...reserved, ...shared].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  );
}

/** Best-effort canonicalization; any incomplete or unsafe chain retains the input. */
export async function resolveDomain(domain: string, timeoutMs: number): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    let current = new URL(`https://${domain}`);
    const visited = new Set<string>();
    for (let hop = 0; hop <= 5; hop++) {
      if (!safeTarget(current) || visited.has(current.href)) return domain;
      visited.add(current.href);
      const response = await publicHead(current, signal);
      if (!redirects.has(response.status)) {
        return (response.status >= 200 && response.status < 300) || response.status === 405
          ? normalize(current.hostname)
          : domain;
      }
      if (!response.location) return domain;
      current = new URL(response.location, current);
    }
  } catch {
    /* DNS, timeout, TLS, and malformed targets retain the submitted domain. */
  }
  return domain;
}
