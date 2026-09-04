export interface CompanyLookup {
  domain: string;
  name?: string;
}

export interface Company {
  name?: string;
  domain?: string;
  employeeCount?: number;
  country?: string;
  industry?: string;
  annualRevenue?: number;
}

export type CompanyEnrichmentResult =
  | { status: "found"; company: Company }
  | { status: "not_found" }
  | {
      status: "unavailable";
      reason: "timeout" | "rate_limited" | "unauthorized" | "provider_error";
    };

export interface CompanyEnrichmentProvider {
  readonly name: string;
  enrich(lookup: CompanyLookup): Promise<CompanyEnrichmentResult>;
}

export interface CrmCompany {
  id: string;
  name?: string;
}

export interface CrmOwner {
  id: string;
  email?: string;
  name?: string;
}

export type OwnershipResult =
  | { status: "owned"; company: CrmCompany; owner: CrmOwner }
  | { status: "unowned"; company: CrmCompany }
  | { status: "company_not_found" }
  | {
      status: "unavailable";
      reason: "timeout" | "rate_limited" | "unauthorized" | "provider_error";
    };

export interface CrmOwnershipProvider {
  readonly name: string;
  findOwner(lookup: CompanyLookup): Promise<OwnershipResult>;
}

