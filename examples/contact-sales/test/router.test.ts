import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  createRouter,
  type CompanyEnrichmentProvider,
  type CrmOwnershipProvider,
  type InferInput,
  SubmissionValidationError,
} from "@open-routing/core";
import {
  contactSalesSchema,
  router,
} from "../router.config.js";
import { routingCases } from "../fixtures/routing/scenarios.js";

describe("router contract", () => {
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
      reps: [],
      territories: [],
      rules: [],
      successUrl: "/success.html",
    });

    await expect(
      invalidRouter.decide({ workEmail: "not-an-email" } as never),
    ).rejects.toBeInstanceOf(SubmissionValidationError);
    expect(enrichment.enrich).not.toHaveBeenCalled();
    expect(ownership.findOwner).not.toHaveBeenCalled();
  });

  it.each(routingCases)("$name", async ({ input, expected }) => {
    const decision = await router.decide(input);

    expect(decision.outcome).toBe(expected.outcome);
    expect(decision.route).toBe(expected.route);
    if (expected.repId) {
      expect(decision.outcome).toBe("routed");
      if (decision.outcome === "routed") {
        expect(decision.target.repId).toBe(expected.repId);
        expect(decision.target.url).toBe("https://cal.com/dom-eccleston/30min");
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
      reps: [],
      territories: [],
      rules: [
        {
          id: "unresolved-company",
          priority: 1,
          when: {
            field: "company.status",
            operator: "in",
            value: ["not_found", "unavailable"],
          },
          outcome: { type: "unresolved", reason: "company_data_unavailable" },
        },
      ],
      successUrl: "/success.html",
    });

    const input = router.parse({
      fullName: "Timeout Buyer",
      workEmail: "buyer@timeout.example",
      companyName: "Timeout Inc",
      companySize: "1-50",
      requestedSeats: 5,
      requestType: "sales",
    });
    const decision = await unavailableRouter.decide(input);

    expect(decision.facts.company).toEqual({ status: "unavailable", reason: "timeout" });
    expect(decision.warnings).toContain("enrichment:timeout");
  });

  it("returns a serializable explanation for every decision", async () => {
    const decision = await router.decide(routingCases[0]!.input);
    const serialized = JSON.parse(JSON.stringify(decision)) as typeof decision;

    expect(serialized.id).toBeTruthy();
    expect(serialized.trace.length).toBeGreaterThan(0);
    expect(serialized.trace.some(({ matched }) => matched)).toBe(true);
  });
});
