import { randomUUID } from "node:crypto";

import type {
  CompanyEnrichmentProvider,
  CompanyEnrichmentResult,
  CrmOwnershipProvider,
  OwnershipResult,
} from "./providers.js";
import {
  parseSubmission,
  type FormSchema,
  type InferInput,
  type ParseOptions,
} from "./schema.js";

export interface SalesRep {
  id: string;
  name: string;
  email: string;
  active: boolean;
  bookingUrl: string;
}

export interface Territory {
  id: string;
  name: string;
  countries: readonly string[];
  minimumEmployees?: number;
  maximumEmployees?: number;
  repIds: readonly string[];
}

export interface RuleCondition {
  field: string;
  operator: "equals" | "not_equals" | "in";
  value: unknown;
}

export type RuleOutcome =
  | { type: "not_routed"; reason: string }
  | { type: "owner"; valueFrom: string }
  | { type: "territory" }
  | { type: "unresolved"; reason: string };

export interface RoutingRule {
  id: string;
  priority: number;
  when: RuleCondition;
  outcome: RuleOutcome;
}

export interface RuleTrace {
  rule: string;
  matched: boolean;
  condition: RuleCondition;
  actual: unknown;
}

export interface RoutedDecision<Input> {
  id: string;
  outcome: "routed";
  route: string;
  input: Input;
  target: {
    type: "booking";
    provider: "cal.com";
    repId: string;
    repName: string;
    url: string;
  };
  facts: DecisionFacts;
  trace: RuleTrace[];
  warnings: string[];
}

export interface UnroutedDecision<Input> {
  id: string;
  outcome: "not_routed" | "unresolved";
  route: string;
  reason: string;
  input: Input;
  target: { type: "success"; url: string };
  facts: DecisionFacts;
  trace: RuleTrace[];
  warnings: string[];
}

export type RoutingDecision<Input> = RoutedDecision<Input> | UnroutedDecision<Input>;

export interface DecisionFacts {
  company: CompanyEnrichmentResult;
  ownership: OwnershipResult;
}

export interface RouterConfig<Schema extends FormSchema> {
  schema: Schema;
  providers: {
    enrichment: CompanyEnrichmentProvider;
    ownership: CrmOwnershipProvider;
  };
  reps: readonly SalesRep[];
  territories: readonly Territory[];
  rules: readonly RoutingRule[];
  successUrl: string;
}

function readPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[key];
  }, root);
}

function matches(condition: RuleCondition, actual: unknown): boolean {
  if (condition.operator === "equals") return actual === condition.value;
  if (condition.operator === "not_equals") return actual !== condition.value;
  return Array.isArray(condition.value) && condition.value.includes(actual);
}

function domainFromEmail(email: string): string | undefined {
  const [, domain] = email.trim().toLowerCase().split("@");
  return domain || undefined;
}

function findRoleValue(
  schema: FormSchema,
  input: Record<string, unknown>,
  role: "person.email" | "company.name" | "company.domain",
): string | undefined {
  const entry = Object.entries(schema).find(([, definition]) => definition.role === role);
  const value = entry ? input[entry[0]] : undefined;
  return typeof value === "string" && value ? value : undefined;
}

function territoryMatches(territory: Territory, country: string, employeeCount: number): boolean {
  if (!territory.countries.includes(country.toUpperCase())) return false;
  if (territory.minimumEmployees !== undefined && employeeCount < territory.minimumEmployees) {
    return false;
  }
  if (territory.maximumEmployees !== undefined && employeeCount > territory.maximumEmployees) {
    return false;
  }
  return true;
}

export function createRouter<const Schema extends FormSchema>(config: RouterConfig<Schema>) {
  type Input = InferInput<Schema>;

  const reps = new Map(config.reps.filter(({ active }) => active).map((rep) => [rep.id, rep]));
  const rules = [...config.rules].sort((left, right) => right.priority - left.priority);

  function parse(rawInput: unknown, options?: ParseOptions): Input {
    return parseSubmission(config.schema, rawInput, options);
  }

  async function decide(rawInput: Input): Promise<RoutingDecision<Input>> {
    const input = parseSubmission(config.schema, rawInput);
    const inputRecord = input as Record<string, unknown>;
    const email = findRoleValue(config.schema, inputRecord, "person.email");
    const explicitDomain = findRoleValue(config.schema, inputRecord, "company.domain");
    const domain = explicitDomain ?? (email ? domainFromEmail(email) : undefined);

    if (!domain) {
      throw new Error("The schema must provide company.domain or person.email");
    }

    const companyName = findRoleValue(config.schema, inputRecord, "company.name");
    const lookup = companyName ? { domain, name: companyName } : { domain };
    const [company, ownership] = await Promise.all([
      config.providers.enrichment.enrich(lookup),
      config.providers.ownership.findOwner(lookup),
    ]);

    const facts: DecisionFacts = { company, ownership };
    const context = {
      input,
      company,
      crm: { owner: ownership },
    };
    const trace: RuleTrace[] = [];
    const warnings: string[] = [];

    if (company.status === "unavailable") warnings.push(`enrichment:${company.reason}`);
    if (ownership.status === "unavailable") warnings.push(`crm:${ownership.reason}`);

    for (const rule of rules) {
      const actual = readPath(context, rule.when.field);
      const matched = matches(rule.when, actual);
      trace.push({ rule: rule.id, matched, condition: rule.when, actual });
      if (!matched) continue;

      if (rule.outcome.type === "not_routed" || rule.outcome.type === "unresolved") {
        return {
          id: randomUUID(),
          outcome: rule.outcome.type === "not_routed" ? "not_routed" : "unresolved",
          route: rule.id,
          reason: rule.outcome.reason,
          input,
          target: { type: "success", url: config.successUrl },
          facts,
          trace,
          warnings,
        };
      }

      if (rule.outcome.type === "owner" && ownership.status === "owned") {
        const rep = reps.get(ownership.owner.id);
        if (!rep) {
          warnings.push(`crm_owner_not_configured:${ownership.owner.id}`);
          continue;
        }
        return {
          id: randomUUID(),
          outcome: "routed",
          route: rule.id,
          input,
          target: {
            type: "booking",
            provider: "cal.com",
            repId: rep.id,
            repName: rep.name,
            url: rep.bookingUrl,
          },
          facts,
          trace,
          warnings,
        };
      }

      if (rule.outcome.type === "territory" && company.status === "found") {
        const { country, employeeCount } = company.company;
        if (!country || employeeCount === undefined) continue;
        const territory = config.territories.find((candidate) =>
          territoryMatches(candidate, country, employeeCount),
        );
        const rep = territory?.repIds.map((id) => reps.get(id)).find(Boolean);
        if (!territory || !rep) continue;

        return {
          id: randomUUID(),
          outcome: "routed",
          route: territory.id,
          input,
          target: {
            type: "booking",
            provider: "cal.com",
            repId: rep.id,
            repName: rep.name,
            url: rep.bookingUrl,
          },
          facts,
          trace,
          warnings,
        };
      }
    }

    return {
      id: randomUUID(),
      outcome: "unresolved",
      route: "no-match",
      reason: "no_route_matched",
      input,
      target: { type: "success", url: config.successUrl },
      facts,
      trace,
      warnings,
    };
  }

  return { schema: config.schema, parse, decide };
}

export type Router<Schema extends FormSchema> = ReturnType<typeof createRouter<Schema>>;

