import type { CompanyLookup, CrmOwnershipProvider, OwnershipResult } from "@open-routing/core";

export interface AttioOptions {
  apiKey?: string;
  baseUrl?: string;
  companyObject?: string;
  ownerAttribute?: string;
  timeoutMs?: number;
  /** Inject a transport for offline tests/examples. Defaults to the platform fetch. */
  fetch?: typeof fetch;
}

export type AttioValue =
  | null
  | boolean
  | number
  | string
  | AttioValue[]
  | { [key: string]: AttioValue };
export type AttioWriteResult = { recordId: string; url: string | null };
export interface AttioClient extends CrmOwnershipProvider {
  updateCompany(input: {
    recordId: string;
    values: Record<string, AttioValue>;
    signal?: AbortSignal;
  }): Promise<AttioWriteResult>;
  upsertCompany(input: {
    matchingAttribute: string;
    values: Record<string, AttioValue>;
    signal?: AbortSignal;
  }): Promise<AttioWriteResult>;
}
export class AttioWriteError extends Error {
  constructor(
    public readonly code:
      | "unauthorized"
      | "rate_limited"
      | "invalid_request"
      | "not_found"
      | "timeout"
      | "cancelled"
      | "provider_error",
    public readonly status: number | null = null,
  ) {
    super(`Attio write failed: ${code}`);
    this.name = "AttioWriteError";
  }
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

export function attio(options: AttioOptions = {}): AttioClient {
  const apiKey = options.apiKey ?? process.env.ATTIO_API_KEY;
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("Attio requires an API key");
  const baseUrl = (options.baseUrl ?? "https://api.attio.com/v2").replace(/\/$/, "");
  const companyObject = options.companyObject ?? "companies";
  const ownerAttribute = options.ownerAttribute ?? "account_owner";
  const timeoutMs = options.timeoutMs ?? 2_000;
  const transport = options.fetch ?? fetch;
  let members: Map<string, AttioMember> | undefined;

  async function request(path: string, init?: RequestInit): Promise<Response> {
    return transport(`${baseUrl}${path}`, {
      ...init,
      redirect: "error",
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...init?.headers,
      },
    });
  }

  async function write(
    path: string,
    method: string,
    values: Record<string, AttioValue>,
    signal?: AbortSignal,
  ): Promise<AttioWriteResult> {
    try {
      signal?.throwIfAborted();
      const response = await request(path, {
        method,
        ...(signal ? { signal } : {}),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { values } }),
      });
      if (!response.ok)
        throw new AttioWriteError(
          response.status === 401 || response.status === 403
            ? "unauthorized"
            : response.status === 429
              ? "rate_limited"
              : response.status === 404
                ? "not_found"
                : response.status >= 400 && response.status < 500
                  ? "invalid_request"
                  : "provider_error",
          response.status,
        );
      const body = (await response.json()) as {
        data?: { id?: { record_id?: string }; web_url?: string };
      };
      if (typeof body.data?.id?.record_id !== "string" || !body.data.id.record_id.trim())
        throw new AttioWriteError("provider_error");
      return {
        recordId: body.data.id.record_id,
        url: typeof body.data.web_url === "string" ? body.data.web_url : null,
      };
    } catch (error) {
      if (error instanceof AttioWriteError) throw error;
      throw new AttioWriteError(
        signal?.aborted
          ? "cancelled"
          : error instanceof Error && error.name === "TimeoutError"
            ? "timeout"
            : "provider_error",
      );
    }
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
    updateCompany({ recordId, values, signal }) {
      if (!recordId.trim()) throw new AttioWriteError("invalid_request");
      return write(
        `/objects/${encodeURIComponent(companyObject)}/records/${encodeURIComponent(recordId)}`,
        "PATCH",
        values,
        signal,
      );
    },
    upsertCompany({ matchingAttribute, values, signal }) {
      if (!matchingAttribute.trim() || !Object.hasOwn(values, matchingAttribute))
        throw new AttioWriteError("invalid_request");
      return write(
        `/objects/${encodeURIComponent(companyObject)}/records?matching_attribute=${encodeURIComponent(matchingAttribute)}`,
        "PUT",
        values,
        signal,
      );
    },
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
