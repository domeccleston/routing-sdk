import type { CompanyEnrichmentProvider, CrmOwnershipProvider } from "@open-routing/core";

import companiesFixture from "./attio/companies.json" with { type: "json" };
import enrichmentFixture from "./attio/company-enrichment.json" with { type: "json" };
import membersFixture from "./attio/workspace-members.json" with { type: "json" };

const enrichmentByDomain = enrichmentFixture as Record<
  string,
  {
    name: string;
    domain: string;
    employeeCount: number;
    country: string;
    industry: string;
  }
>;

export const fixtureEnrichment: CompanyEnrichmentProvider = {
  name: "fixture-company-enrichment",
  async enrich({ domain }) {
    const company = enrichmentByDomain[domain];
    return company ? { status: "found", company } : { status: "not_found" };
  },
};

/** Deterministic enrichment only for the explicitly configured live test domain. */
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

export const fixtureOwnership: CrmOwnershipProvider = {
  name: "fixture-attio",
  async findOwner({ domain }) {
    const company = companiesFixture.data.find((candidate) =>
      candidate.values.domains.some((entry) => entry.domain === domain),
    );
    if (!company) return { status: "company_not_found" };

    const companyName = company.values.name[0]?.value;
    const crmCompany = {
      id: company.id.record_id,
      ...(companyName ? { name: companyName } : {}),
    };
    const ownerId = company.values.account_owner[0]?.referenced_actor_id;
    if (!ownerId) return { status: "unowned", company: crmCompany };

    const member = membersFixture.data.find(
      (candidate) => candidate.id.workspace_member_id === ownerId,
    );
    const memberName = member ? `${member.first_name} ${member.last_name}` : undefined;
    return {
      status: "owned",
      company: crmCompany,
      owner: {
        id: ownerId,
        ...(member?.email_address ? { email: member.email_address } : {}),
        ...(memberName ? { name: memberName } : {}),
      },
    };
  },
};
