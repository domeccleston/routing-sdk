import { randomUUID } from "node:crypto";
import type {
  CompanyEnrichmentProvider,
  CompanyEnrichmentResult,
  CrmOwnershipProvider,
  OwnershipResult,
} from "./providers.js";
import { parseSubmission, type FormSchema, type InferInput, type ParseOptions } from "./schema.js";
import { redactDecision } from "./decision-record.js";

export interface Person {
  name: string;
  bookingUrl: string;
  active?: boolean;
}
export interface Pool {
  name?: string;
  members: readonly string[];
  strategy?: "round-robin";
}
export interface PoolState {
  poolId: string;
  name: string;
  strategy: "round-robin";
  lastAssignedPersonId: string | null;
  nextPersonId: string | null;
  eligiblePersonIds: string[];
  members: { id: string; name: string; active: boolean }[];
}

/** Shared by state inspection and atomic store selection. */
export function nextPoolPerson(
  memberIds: readonly string[],
  lastPersonId: string | null,
): string | null {
  if (!memberIds.length) return null;
  return memberIds[(memberIds.indexOf(lastPersonId ?? "") + 1) % memberIds.length]!;
}
export type Condition =
  | { all: readonly Condition[] }
  | { any: readonly Condition[] }
  | { field: string; equals: unknown }
  | { field: string; notEquals: unknown }
  | { field: string; in: readonly unknown[] }
  | { field: string; gte: number }
  | { field: string; lte: number };
export type RoutingRule = { id: string; when?: Condition } & (
  | { assign: { pool: string } | { person: string } | { owner: true }; redirect?: never }
  | { redirect: string; reason?: string; assign?: never }
);
export interface RuleTrace {
  rule: string;
  matched: boolean;
  condition: { field: string; operator: string; value: unknown };
  actual: unknown;
}
export interface AssignmentResult {
  id: string;
  outcome: "assigned" | "unassigned";
  ruleId?: string;
  poolId?: string;
  personId?: string;
  redirectUrl: string;
  reason?: string;
  facts: { company?: CompanyEnrichmentResult; ownership?: OwnershipResult };
  trace: RuleTrace[];
  warnings: string[];
}
export interface AssignmentRequest {
  idempotencyKey: string;
  result: AssignmentResult;
  /** Ordered eligible members captured from this router's configuration. */
  candidates?: readonly { id: string; bookingUrl: string }[];
}
export interface AssignmentStore {
  /** Read-only cursor lookup; null means this pool has never assigned a lead. */
  getPoolCursor(poolId: string): string | null | Promise<string | null>;
  getAssignment(idempotencyKey: string): AssignmentResult | null | Promise<AssignmentResult | null>;
  /** Atomically recheck the key, select a member, advance its pool, and save.
   * Failure MUST roll back all changes; an existing key MUST return its saved result.
   */
  commitAssignment(request: AssignmentRequest): AssignmentResult | Promise<AssignmentResult>;
}
export interface RouterConfig<Schema extends FormSchema> {
  schema: Schema;
  people: Readonly<Record<string, Person>>;
  pools?: Readonly<Record<string, Pool>>;
  rules: readonly RoutingRule[];
  fallback: { redirect: string };
  store: AssignmentStore;
  providers?: { enrichment?: CompanyEnrichmentProvider; ownership?: CrmOwnershipProvider };
}
function readPath(root: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        typeof value === "object" && value !== null && Object.hasOwn(value, key)
          ? (value as Record<string, unknown>)[key]
          : undefined,
      root,
    );
}
function evaluate(
  condition: Condition,
  context: unknown,
  rule: string,
  trace: RuleTrace[],
): boolean {
  if ("all" in condition)
    return condition.all.map((c) => evaluate(c, context, rule, trace)).every(Boolean);
  if ("any" in condition)
    return condition.any.map((c) => evaluate(c, context, rule, trace)).some(Boolean);
  const actual = readPath(context, condition.field);
  const operator =
    "equals" in condition
      ? "equals"
      : "notEquals" in condition
        ? "notEquals"
        : "in" in condition
          ? "in"
          : "gte" in condition
            ? "gte"
            : "lte";
  const value: unknown =
    "equals" in condition
      ? condition.equals
      : "notEquals" in condition
        ? condition.notEquals
        : "in" in condition
          ? condition.in
          : "gte" in condition
            ? condition.gte
            : condition.lte;
  const matched =
    "equals" in condition
      ? actual === condition.equals
      : "notEquals" in condition
        ? actual !== undefined && actual !== condition.notEquals
        : "in" in condition
          ? condition.in.includes(actual)
          : typeof actual === "number" &&
            ("gte" in condition ? actual >= condition.gte : actual <= condition.lte);
  trace.push({ rule, matched, condition: { field: condition.field, operator, value }, actual });
  return matched;
}
function validateUrl(value: string, relative = false) {
  if (relative && /^\/(?!\/)/.test(value) && !/[\\\s]/.test(value)) return;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Destinations must be HTTPS URLs or local absolute paths");
}
export function createRouter<const Schema extends FormSchema>(config: RouterConfig<Schema>) {
  const people = new Map(Object.entries(config.people).map(([id, person]) => [id, { ...person }]));
  const pools = new Map(
    Object.entries(config.pools ?? {}).map(([id, pool]) => [
      id,
      { ...pool, strategy: pool.strategy ?? "round-robin", members: [...pool.members] },
    ]),
  );
  const rules = structuredClone(config.rules);
  for (const person of people.values()) validateUrl(person.bookingUrl);
  validateUrl(config.fallback.redirect, true);
  for (const pool of pools.values()) {
    if (
      pool.strategy !== "round-robin" ||
      !pool.members.length ||
      new Set(pool.members).size !== pool.members.length
    )
      throw new Error("Pools require unique members and a round-robin strategy");
    for (const id of pool.members) if (!people.has(id)) throw new Error(`Unknown person: ${id}`);
  }
  if (new Set(rules.map((r) => r.id)).size !== rules.length)
    throw new Error("Rule IDs must be unique");
  for (const rule of rules) {
    if (rule.redirect !== undefined) validateUrl(rule.redirect, true);
    if (rule.assign && "pool" in rule.assign && !pools.has(rule.assign.pool))
      throw new Error(`Unknown pool: ${rule.assign.pool}`);
    if (rule.assign && "person" in rule.assign && !people.has(rule.assign.person))
      throw new Error(`Unknown person: ${rule.assign.person}`);
  }
  function parse(rawInput: unknown, options?: ParseOptions): InferInput<Schema> {
    return parseSubmission(config.schema, rawInput, options);
  }
  async function assign(
    rawInput: InferInput<Schema>,
    { idempotencyKey }: { idempotencyKey: string },
  ): Promise<AssignmentResult> {
    if (!idempotencyKey?.trim() || idempotencyKey.length > 200)
      throw new Error("A nonempty idempotency key of at most 200 characters is required");
    const previous = await config.store.getAssignment(idempotencyKey);
    if (previous) return previous;
    const input = parse(rawInput);
    const role = (name: string) => {
      const entry = Object.entries(config.schema).find(([, field]) => field.role === name);
      const value = entry ? (input as Record<string, unknown>)[entry[0]] : undefined;
      return typeof value === "string" ? value : undefined;
    };
    const domain = role("company.domain") ?? role("person.email")?.split("@")[1];
    if (config.providers && Object.values(config.providers).some(Boolean) && !domain)
      throw new Error("Providers require a company.domain or person.email field");
    const lookup = {
      domain: domain?.trim().toLowerCase() ?? "",
      ...(role("company.name") ? { name: role("company.name")! } : {}),
    };
    const [company, ownership] = await Promise.all([
      config.providers?.enrichment?.enrich(lookup),
      config.providers?.ownership?.findOwner(lookup),
    ]);
    const facts = { ...(company ? { company } : {}), ...(ownership ? { ownership } : {}) };
    const context = {
      input,
      company:
        company?.status === "found" ? { ...company.company, status: company.status } : company,
      crm: { owner: ownership },
    };
    const trace: RuleTrace[] = [];
    const warnings: string[] = [];
    if (company?.status === "unavailable") warnings.push(`enrichment:${company.reason}`);
    if (ownership?.status === "unavailable") warnings.push(`crm:${ownership.reason}`);
    const base = (): AssignmentResult => ({
      id: randomUUID(),
      outcome: "unassigned",
      redirectUrl: config.fallback.redirect,
      facts,
      trace,
      warnings,
    });
    const commit = (result: AssignmentResult, candidates?: AssignmentRequest["candidates"]) =>
      config.store.commitAssignment({
        idempotencyKey,
        result: redactDecision(config.schema, result),
        ...(candidates ? { candidates } : {}),
      });
    for (const rule of rules) {
      if (rule.when && !evaluate(rule.when, context, rule.id, trace)) continue;
      const result = { ...base(), ruleId: rule.id };
      if (rule.redirect !== undefined)
        return commit({
          ...result,
          redirectUrl: rule.redirect,
          reason: rule.reason ?? "rule_redirect",
        });
      const assignment = rule.assign!;
      if ("pool" in assignment) {
        const candidates = pools.get(assignment.pool)!.members.flatMap((id) => {
          const person = people.get(id)!;
          return person.active === false ? [] : [{ id, bookingUrl: person.bookingUrl }];
        });
        return commit(
          { ...result, poolId: assignment.pool, reason: "no_active_members" },
          candidates,
        );
      }
      const personId =
        "person" in assignment
          ? assignment.person
          : ownership?.status === "owned"
            ? ownership.owner.id
            : undefined;
      const person = personId ? people.get(personId) : undefined;
      if (!person || person.active === false) {
        // An unavailable CRM owner explicitly falls through to territory rules.
        if ("owner" in assignment) {
          warnings.push("crm_owner_not_eligible");
          continue;
        }
        return commit({ ...result, reason: "person_inactive" });
      }
      return commit({
        ...result,
        outcome: "assigned",
        personId: personId!,
        redirectUrl: person.bookingUrl,
      });
    }
    return commit({ ...base(), reason: "no_matching_rule" });
  }
  async function getPoolState(poolId: string): Promise<PoolState> {
    const pool = pools.get(poolId);
    if (!pool) throw new Error(`Unknown pool: ${poolId}`);
    const lastAssignedPersonId = await config.store.getPoolCursor(poolId);
    const members = pool.members.map((id) => {
      const person = people.get(id)!;
      return { id, name: person.name, active: person.active !== false };
    });
    const eligiblePersonIds = members.filter((person) => person.active).map((person) => person.id);
    return {
      poolId,
      name: pool.name ?? poolId,
      strategy: pool.strategy,
      lastAssignedPersonId,
      nextPersonId: nextPoolPerson(eligiblePersonIds, lastAssignedPersonId),
      eligiblePersonIds,
      members,
    };
  }
  async function listPoolStates(): Promise<PoolState[]> {
    return Promise.all([...pools.keys()].map(getPoolState));
  }
  return { schema: config.schema, parse, assign, getPoolState, listPoolStates };
}
export type Router<Schema extends FormSchema> = ReturnType<typeof createRouter<Schema>>;
