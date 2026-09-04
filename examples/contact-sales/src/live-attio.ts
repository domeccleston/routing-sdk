import { attio } from "@open-routing/attio";
import type { CompanyEnrichmentProvider, CrmOwnershipProvider } from "@open-routing/core";
import reps from "../fixtures/routing/reps.json" with { type: "json" };

/** Explicit single-member mapping for this demo, not a production territory configuration. */
export function liveAttio() {
  const apiKey = process.env.ATTIO_API_KEY;
  const memberId = process.env.ATTIO_WORKSPACE_MEMBER_ID;
  if (!apiKey || !memberId)
    throw new Error("Live Attio requires ATTIO_API_KEY and ATTIO_WORKSPACE_MEMBER_ID");
  const client = attio({ apiKey, timeoutMs: 10_000 });
  const memberIds = Object.fromEntries(reps.map((rep) => [rep.id, memberId]));
  const ownership: CrmOwnershipProvider = {
    name: "attio",
    async findOwner(lookup) {
      const result = await client.findOwner(lookup);
      if (result.status !== "owned" || result.owner.id !== memberId) return result;
      // Multiple sample reps map to one real member; use the first as the canonical read identity.
      return { ...result, owner: { ...result.owner, id: reps[0]!.id } };
    },
  };
  return { client, memberIds, ownership };
}

export function liveTestEnrichment(fallback: CompanyEnrichmentProvider): CompanyEnrichmentProvider {
  return {
    name: fallback.name,
    async enrich(lookup) {
      if (process.env.ATTIO_E2E_DOMAIN && lookup.domain === process.env.ATTIO_E2E_DOMAIN) {
        return {
          status: "found",
          company: {
            domain: lookup.domain,
            name: lookup.name ?? "Open Routing E2E",
            country: "US",
            employeeCount: 750,
            industry: "software",
          },
        };
      }
      return fallback.enrich(lookup);
    },
  };
}
