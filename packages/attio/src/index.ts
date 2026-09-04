import type {
  CompanyLookup,
  CrmOwnershipProvider,
  OwnershipResult,
} from "@open-routing/core";

export interface AttioOptions {
  apiKey: string;
  baseUrl?: string;
  companyObject?: string;
  ownerAttribute?: string;
  timeoutMs?: number;
}

interface AttioCompanyRecord {
  id?: { record_id?: string };
  values?: Record<string, Array<Record<string, unknown>>>;
}

interface AttioMember {
  id?: { workspace_member_id?: string };
  first_name?: string;
  last_name?: string;
  email_address?: string;
}

function failure(status: number): OwnershipResult {
  if (status === 401 || status === 403) return { status: "unavailable", reason: "unauthorized" };
  if (status === 429) return { status: "unavailable", reason: "rate_limited" };
  return { status: "unavailable", reason: "provider_error" };
}

export function attio(options: AttioOptions): CrmOwnershipProvider {
  const baseUrl = (options.baseUrl ?? "https://api.attio.com/v2").replace(/\/$/, "");
  const companyObject = options.companyObject ?? "companies";
  const ownerAttribute = options.ownerAttribute ?? "account_owner";
  const timeoutMs = options.timeoutMs ?? 2_000;
  let members: Map<string, AttioMember> | undefined;

  async function request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        ...init?.headers,
      },
    });
  }

  async function memberById(id: string): Promise<AttioMember | undefined> {
    if (!members) {
      const response = await request("/workspace_members");
      if (!response.ok) return undefined;
      const body = (await response.json()) as { data?: AttioMember[] };
      members = new Map(
        (body.data ?? []).flatMap((member) => {
          const memberId = member.id?.workspace_member_id;
          return memberId ? [[memberId, member] as const] : [];
        }),
      );
    }
    return members.get(id);
  }

  return {
    name: "attio",
    async findOwner({ domain }: CompanyLookup): Promise<OwnershipResult> {
      try {
        const response = await request(`/objects/${companyObject}/records/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filter: { domains: domain } }),
        });
        if (!response.ok) return failure(response.status);

        const body = (await response.json()) as { data?: AttioCompanyRecord[] };
        const record = body.data?.[0];
        const recordId = record?.id?.record_id;
        if (!record || !recordId) return { status: "company_not_found" };

        const nameValue = record.values?.name?.[0]?.value;
        const company = {
          id: recordId,
          ...(typeof nameValue === "string" ? { name: nameValue } : {}),
        };
        const ownerId = record.values?.[ownerAttribute]?.[0]?.referenced_actor_id;
        if (typeof ownerId !== "string") return { status: "unowned", company };

        const member = await memberById(ownerId);
        const fullName = [member?.first_name, member?.last_name].filter(Boolean).join(" ");
        return {
          status: "owned",
          company,
          owner: {
            id: ownerId,
            ...(member?.email_address ? { email: member.email_address } : {}),
            ...(fullName ? { name: fullName } : {}),
          },
        };
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        return { status: "unavailable", reason: timedOut ? "timeout" : "provider_error" };
      }
    },
  };
}

