import { createRouter, type CompanyEnrichmentProvider } from "open-routing";
import { pdl } from "@open-routing/pdl";

const enrichment: CompanyEnrichmentProvider =
  process.env.PDL_LIVE === "1"
    ? pdl()
    : {
        name: "demo-enrichment",
        async enrich() {
          return { status: "found", company: { employeeCount: 750, country: "US" } };
        },
      };

const router = createRouter({
  schema: { email: { type: "email", required: true, role: "person.email" } },
  people: {
    enterprise: { name: "Enterprise rep", bookingUrl: "https://cal.com/dom-eccleston/30min" },
    commercial: { name: "Commercial rep", bookingUrl: "https://cal.com/dom-eccleston/30min" },
  },
  providers: { enrichment },
  rules: [
    {
      id: "enterprise",
      when: { field: "company.employeeCount", gte: 500 },
      assign: { person: "enterprise" },
    },
    {
      id: "commercial",
      when: { field: "company.employeeCount", lte: 499 },
      assign: { person: "commercial" },
    },
  ],
  fallback: { redirect: "/success" },
  database: ":memory:",
});
try {
  const result = await router.assign(
    { email: `buyer@${process.env.COMPANY_DOMAIN ?? "example.com"}` },
    { idempotencyKey: "lead-1" },
  );
  console.log(
    JSON.stringify({
      person: result.personId ?? null,
      company: result.facts.company,
      redirect: result.redirectUrl,
    }),
  );
} finally {
  await router.close();
}
