import countries from "i18n-iso-countries";
import { resolveDomain } from "./resolve-domain.js";
import type {
  Company,
  CompanyEnrichmentProvider,
  CompanyEnrichmentResult,
} from "@open-routing/core";

export interface PdlOptions {
  apiKey: string;
  /** Per-request deadline, including reading the response. Default: 2 seconds. */
  timeoutMs?: number;
  /** PDL match confidence, 1–10. Default: 6. */
  minLikelihood?: number;
  /** Follow public company-website redirects before enrichment. Default: true. */
  resolveRedirects?: boolean;
  /** Total redirect-chain deadline, separate from the PDL request. Default: 800ms. */
  redirectTimeoutMs?: number;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function countryCode(value: unknown): string | undefined {
  const name = text(value);
  if (!name) return undefined;
  const upper = name.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && countries.isValid(upper)) return upper;
  return countries.getAlpha2Code(name, "en");
}
function domain(value: unknown): string | undefined {
  const website = text(value);
  if (!website) return undefined;
  try {
    const url = new URL(website.includes("://") ? website : `https://${website}`);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      return undefined;
    return url.hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
function failure(status: number): CompanyEnrichmentResult {
  if (status === 404) return { status: "not_found" };
  if (status === 401 || status === 403) return { status: "unavailable", reason: "unauthorized" };
  if (status === 429) return { status: "unavailable", reason: "rate_limited" };
  return { status: "unavailable", reason: "provider_error" };
}

/** Server-side PDL Company Enrichment v5 adapter. Makes one request, without retries. */
export function pdl({
  apiKey,
  timeoutMs = 2_000,
  minLikelihood = 6,
  resolveRedirects = true,
  redirectTimeoutMs = 800,
}: PdlOptions): CompanyEnrichmentProvider {
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("PDL requires an API key");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new Error("PDL timeoutMs must be a positive integer up to 2147483647");
  if (!Number.isInteger(minLikelihood) || minLikelihood < 1 || minLikelihood > 10)
    throw new Error("PDL minLikelihood must be an integer from 1 to 10");
  if (typeof resolveRedirects !== "boolean")
    throw new Error("PDL resolveRedirects must be a boolean");
  if (
    !Number.isInteger(redirectTimeoutMs) ||
    redirectTimeoutMs < 1 ||
    redirectTimeoutMs > 2_147_483_647
  )
    throw new Error("PDL redirectTimeoutMs must be a positive integer up to 2147483647");
  return {
    name: "pdl",
    async enrich(lookup): Promise<CompanyEnrichmentResult> {
      const website = domain(lookup.domain);
      if (!website) return { status: "unavailable", reason: "provider_error" };
      const url = new URL("https://api.peopledatalabs.com/v5/company/enrich");
      url.searchParams.set(
        "website",
        resolveRedirects ? await resolveDomain(website, redirectTimeoutMs) : website,
      );
      url.searchParams.set("min_likelihood", String(minLikelihood));
      const name = text(lookup.name);
      if (name) url.searchParams.set("name", name);
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const response = await fetch(url, {
          headers: { "X-Api-Key": apiKey, Accept: "application/json" },
          signal,
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          return failure(response.status);
        }
        const body: unknown = await response.json();
        if (
          !object(body) ||
          body.status !== 200 ||
          !text(body.id) ||
          typeof body.likelihood !== "number" ||
          !Number.isInteger(body.likelihood) ||
          body.likelihood < 1 ||
          body.likelihood > 10
        )
          return failure(500);
        if (body.likelihood < minLikelihood) return { status: "not_found" };
        const company: Company = {};
        const companyName = text(body.display_name) ?? text(body.name);
        const companyDomain = domain(body.website);
        const country = countryCode(object(body.location) ? body.location.country : undefined);
        const industry = text(body.industry);
        if (companyName) company.name = companyName;
        if (companyDomain) company.domain = companyDomain;
        if (country) company.country = country;
        if (industry) company.industry = industry;
        if (
          typeof body.employee_count === "number" &&
          Number.isSafeInteger(body.employee_count) &&
          body.employee_count >= 0
        )
          company.employeeCount = body.employee_count;
        return { status: "found", company };
      } catch {
        return { status: "unavailable", reason: signal.aborted ? "timeout" : "provider_error" };
      }
    },
  };
}
