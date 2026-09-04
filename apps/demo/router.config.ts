import {
  createRouter,
  defineSchema,
  type RoutingRule,
  type AssignmentStore,
  type CompanyEnrichmentProvider,
  type CrmOwnershipProvider,
} from "@open-routing/core";

import repsFixture from "./fixtures/routing/reps.json" with { type: "json" };
import territoriesFixture from "./fixtures/routing/territories.json" with { type: "json" };
import { fixtureEnrichment, fixtureOwnership } from "./fixtures/providers.js";

export const contactSalesSchema = defineSchema({
  fullName: { type: "string", required: true, label: "Full name", privacy: "plain" },
  workEmail: {
    type: "email",
    required: true,
    label: "Work email",
    role: "person.email",
    privacy: "mask",
  },
  companyName: {
    type: "string",
    required: true,
    label: "Company name",
    role: "company.name",
    privacy: "plain",
  },
  companySize: {
    type: "enum",
    required: true,
    label: "Company size",
    values: ["1-50", "51-200", "201-500", "501-1000", "1001+"],
    privacy: "plain",
  },
  requestedSeats: {
    type: "integer",
    required: true,
    label: "Seats required",
    minimum: 1,
    privacy: "plain",
  },
  requestType: {
    type: "enum",
    required: true,
    label: "What can we help with?",
    values: ["sales", "support", "partnership"],
    privacy: "plain",
  },
  message: {
    type: "string",
    required: false,
    label: "Anything else?",
    privacy: "omit",
  },
});

export const createContactSalesRouter = (
  store: AssignmentStore,
  enrichment: CompanyEnrichmentProvider = fixtureEnrichment,
  ownership: CrmOwnershipProvider = fixtureOwnership,
) =>
  createRouter({
    schema: contactSalesSchema,
    providers: {
      enrichment,
      ownership,
    },
    people: Object.fromEntries(repsFixture.map(({ id, ...person }) => [id, person])),
    pools: Object.fromEntries(
      territoriesFixture.map((territory) => [
        territory.id,
        {
          name: territory.name,
          members: territory.repIds,
          strategy: "round-robin" as const,
        },
      ]),
    ),
    rules: [
      {
        id: "non-sales-request",
        when: { field: "input.requestType", notEquals: "sales" },
        redirect: "/success.html",
        reason: "not_a_sales_request",
      },
      {
        id: "existing-crm-owner",
        when: { field: "crm.owner.status", equals: "owned" },
        assign: { owner: true },
      },
      ...territoriesFixture.map((territory): RoutingRule => ({
        id: territory.id,
        when: {
          all: [
            { field: "company.country", in: territory.countries },
            ...(territory.minimumEmployees !== undefined
              ? [{ field: "company.employeeCount", gte: territory.minimumEmployees }]
              : []),
            ...(territory.maximumEmployees !== undefined
              ? [{ field: "company.employeeCount", lte: territory.maximumEmployees }]
              : []),
          ],
        },
        assign: { pool: territory.id },
      })),
      {
        id: "unresolved-company",
        when: { field: "company.status", in: ["not_found", "unavailable"] },
        redirect: "/success.html",
        reason: "company_data_unavailable",
      },
    ],
    fallback: { redirect: "/success.html" },
    store,
  });
