import type Database from "better-sqlite3";
import type { AssignmentResult } from "@open-routing/core";

export interface AnalyticsSummary {
  submissions: { total: number; pending: number; failed: number };
  leads: number;
  assigned: number;
  unassigned: number;
  enriched: number;
  confirmedBookings: null;
  sizes: { label: string; count: number }[];
  industries: { label: string; count: number }[];
  countries: { label: string; count: number }[];
  companies: {
    domain: string;
    name: string;
    country: string;
    industry: string;
    employeeCount: number | null;
    leads: number;
    assigned: number;
  }[];
  reps: {
    id: string;
    name: string;
    assigned: number;
    roundRobin: number;
    direct: number;
    confirmedBookings: null;
  }[];
}

const sizes = ["0–50", "51–200", "201–500", "501–1,000", "1,001+", "Unknown"];
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function count(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
function breakdown(map: Map<string, number>) {
  return [...map]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** All-time snapshot, deduplicated by assignment ID, including legacy audit snapshots. */
export function readAnalytics(
  db: Database.Database,
  people: readonly { id: string; name: string }[],
): AnalyticsSummary {
  const result: AnalyticsSummary = {
    submissions: { total: 0, pending: 0, failed: 0 },
    leads: 0,
    assigned: 0,
    unassigned: 0,
    enriched: 0,
    confirmedBookings: null,
    sizes: [],
    industries: [],
    countries: [],
    companies: [],
    reps: [],
  };
  const statuses = db
    .prepare("SELECT status, COUNT(*) AS count FROM submissions GROUP BY status")
    .all() as { status: string; count: number }[];
  for (const row of statuses) {
    result.submissions.total += row.count;
    if (row.status === "failed" || row.status === "pending")
      result.submissions[row.status] = row.count;
  }
  const sizeCounts = new Map(sizes.map((label) => [label, 0]));
  const industries = new Map<string, number>();
  const countries = new Map<string, number>();
  const companies = new Map<string, AnalyticsSummary["companies"][number]>();
  const reps = new Map(
    people.map((person) => [
      person.id,
      { ...person, assigned: 0, roundRobin: 0, direct: 0, confirmedBookings: null },
    ]),
  );
  const seen = new Set<string>();
  // Committed assignments are authoritative, even when audit logging failed.
  // Audit snapshots supplement these for older databases, without double counting.
  const rows = db
    .prepare(`SELECT idempotency_key AS source_id, result_json FROM assignments
    UNION ALL SELECT id AS source_id, json_extract(record_json, '$.decision') AS result_json
    FROM submissions WHERE status = 'completed' AND json_type(record_json, '$.decision') = 'object'`)
    .iterate() as Iterable<{ source_id: string; result_json: string }>;
  for (const row of rows) {
    const decision = JSON.parse(row.result_json) as AssignmentResult & {
      target?: { repId?: string; repName?: string };
      outcome: string;
    };
    const id = decision.id ?? `legacy:${row.source_id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.leads++;
    const assigned = ["assigned", "routed"].includes(decision.outcome);
    if (assigned) result.assigned++;
    else result.unassigned++;
    const personId = decision.personId ?? decision.target?.repId;
    if (assigned && personId) {
      const rep = reps.get(personId) ?? {
        id: personId,
        name: decision.target?.repName ?? personId,
        assigned: 0,
        direct: 0,
        roundRobin: 0,
        confirmedBookings: null,
      };
      rep.assigned++;
      // Historical snapshots lack poolId, so do not infer an assignment method.
      if (decision.poolId) rep.roundRobin++;
      else if (decision.outcome === "assigned") rep.direct++;
      reps.set(personId, rep);
    }
    const company =
      decision.facts?.company?.status === "found" ? decision.facts.company.company : undefined;
    if (company) result.enriched++;
    const employees =
      typeof company?.employeeCount === "number" &&
      Number.isSafeInteger(company.employeeCount) &&
      company.employeeCount >= 0
        ? company.employeeCount
        : null;
    const size =
      employees === null
        ? "Unknown"
        : employees <= 50
          ? sizes[0]!
          : employees <= 200
            ? sizes[1]!
            : employees <= 500
              ? sizes[2]!
              : employees <= 1000
                ? sizes[3]!
                : sizes[4]!;
    const industry = text(company?.industry)?.toLowerCase() ?? "Unknown";
    const country = text(company?.country)?.toUpperCase() ?? "Unknown";
    count(sizeCounts, size);
    count(industries, industry);
    count(countries, country);
    const domain = text(company?.domain)
      ?.toLowerCase()
      .replace(/^www\./, "");
    if (domain) {
      const entry = companies.get(domain) ?? {
        domain,
        name: text(company?.name) ?? domain,
        country,
        industry,
        employeeCount: employees,
        leads: 0,
        assigned: 0,
      };
      entry.leads++;
      if (assigned) entry.assigned++;
      companies.set(domain, entry);
    }
  }
  result.sizes = [...sizeCounts].map(([label, count]) => ({ label, count }));
  result.industries = breakdown(industries);
  result.countries = breakdown(countries);
  result.companies = [...companies.values()].sort(
    (a, b) => b.leads - a.leads || a.domain.localeCompare(b.domain),
  );
  result.reps = [...reps.values()].sort(
    (a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name),
  );
  return result;
}
