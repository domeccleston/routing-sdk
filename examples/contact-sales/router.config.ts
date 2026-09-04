import {
  createRouter,
  defineSchema,
  type RoutingRule,
  type SalesRep,
  type Territory,
} from "@open-routing/core";

import repsFixture from "./fixtures/routing/reps.json" with { type: "json" };
import rulesFixture from "./fixtures/routing/rules.json" with { type: "json" };
import territoriesFixture from "./fixtures/routing/territories.json" with { type: "json" };
import { fixtureEnrichment, fixtureOwnership } from "./src/fixture-providers.js";

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

export const router = createRouter({
  schema: contactSalesSchema,
  providers: {
    enrichment: fixtureEnrichment,
    ownership: fixtureOwnership,
  },
  reps: repsFixture as SalesRep[],
  territories: territoriesFixture as Territory[],
  rules: rulesFixture as RoutingRule[],
  successUrl: "/success.html",
});
