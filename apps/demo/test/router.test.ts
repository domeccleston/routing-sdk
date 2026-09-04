import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sqliteStore } from "@open-routing/store-sqlite";
import { pdl } from "@open-routing/pdl";

import {
  createRouter,
  type CompanyEnrichmentProvider,
  type CrmOwnershipProvider,
  type InferInput,
  SubmissionValidationError,
} from "@open-routing/core";
import { contactSalesSchema, createContactSalesRouter } from "../router.config.js";
import { routingCases } from "../fixtures/routing/scenarios.js";

let store: ReturnType<typeof sqliteStore>;
let router: ReturnType<typeof createContactSalesRouter>;
beforeEach(() => {
  store = sqliteStore(":memory:", contactSalesSchema);
  router = createContactSalesRouter(store);
});
afterEach(() => {
  store.close();
  vi.unstubAllGlobals();
});
describe("router contract", () => {
  it("routes using normalized PDL data and replays without another enrichment request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            status: 200,
            id: "acme",
            likelihood: 9,
            employee_count: 600,
            location: { country: "united states" },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const liveRouter = createContactSalesRouter(store, pdl({ apiKey: "test" }));
    const input = { ...routingCases[0]!.input, workEmail: "buyer@unknown.example" };
    const result = await liveRouter.assign(input, { idempotencyKey: "pdl-lead" });
    expect(result).toMatchObject({
      outcome: "assigned",
      poolId: "us-enterprise",
      personId: "rep_amelia",
      facts: { company: { status: "found", company: { country: "US", employeeCount: 600 } } },
    });
    expect(await liveRouter.assign(input, { idempotencyKey: "pdl-lead" })).toEqual(result);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("infers the decide input from the configured form schema", () => {
    type Input = InferInput<typeof contactSalesSchema>;

    expectTypeOf<Input>().toMatchTypeOf<{
      fullName: string;
      workEmail: string;
      companyName: string;
      companySize: "1-50" | "51-200" | "201-500" | "501-1000" | "1001+";
      requestedSeats: number;
      requestType: "sales" | "support" | "partnership";
      message?: string;
    }>();
  });

  it("rejects an invalid submission before calling providers", async () => {
    const enrichment: CompanyEnrichmentProvider = {
      name: "never-called",
      enrich: vi.fn(),
    };
    const ownership: CrmOwnershipProvider = {
      name: "never-called",
      findOwner: vi.fn(),
    };
    const invalidRouter = createRouter({
      schema: contactSalesSchema,
      providers: { enrichment, ownership },
      people: {},
      pools: {},
      store,
      rules: [],
      fallback: { redirect: "/success.html" },
    });

    await expect(
      invalidRouter.assign({ workEmail: "not-an-email" } as never, {
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(SubmissionValidationError);
    expect(enrichment.enrich).not.toHaveBeenCalled();
    expect(ownership.findOwner).not.toHaveBeenCalled();
  });

  it.each(routingCases)("$name", async ({ input, expected }) => {
    const decision = await router.assign(input, { idempotencyKey: randomUUID() });

    expect(decision.outcome).toBe(expected.outcome);
    expect(decision.ruleId).toBe(expected.route);
    if (expected.repId) {
      expect(decision.outcome).toBe("assigned");
      if (decision.outcome === "assigned") {
        expect(decision.personId).toBe(expected.repId);
        expect(decision.redirectUrl).toBe("https://cal.com/dom-eccleston/30min");
      }
    }
  });

  it("distinguishes provider unavailability from not found", async () => {
    const unavailableRouter = createRouter({
      schema: contactSalesSchema,
      providers: {
        enrichment: {
          name: "unavailable",
          async enrich() {
            return { status: "unavailable", reason: "timeout" };
          },
        },
        ownership: {
          name: "empty-crm",
          async findOwner() {
            return { status: "company_not_found" };
          },
        },
      },
      people: {},
      pools: {},
      store,
      rules: [
        {
          id: "unresolved-company",
          when: {
            field: "company.status",
            in: ["not_found", "unavailable"],
          },
          redirect: "/success.html",
          reason: "company_data_unavailable",
        },
      ],
      fallback: { redirect: "/success.html" },
    });

    const input = router.parse({
      fullName: "Timeout Buyer",
      workEmail: "buyer@timeout.example",
      companyName: "Timeout Inc",
      companySize: "1-50",
      requestedSeats: 5,
      requestType: "sales",
    });
    const decision = await unavailableRouter.assign(input, { idempotencyKey: randomUUID() });

    expect(decision.facts.company).toEqual({ status: "unavailable", reason: "timeout" });
    expect(decision.warnings).toContain("enrichment:timeout");
  });

  it("returns a serializable explanation for every decision", async () => {
    const decision = await router.assign(routingCases[0]!.input, { idempotencyKey: randomUUID() });
    const serialized = JSON.parse(JSON.stringify(decision)) as typeof decision;

    expect(serialized.id).toBeTruthy();
    expect(serialized.trace.length).toBeGreaterThan(0);
    expect(serialized.trace.some(({ matched }) => matched)).toBe(true);
  });
});
