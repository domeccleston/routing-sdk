import { createRouter, type RouterConfig, type AssignmentStore } from "open-routing";
import { type ResearchInput } from "@open-routing/research";
import { attio } from "@open-routing/attio";
import { pdl } from "@open-routing/pdl";

const router = createRouter({
  schema: {
    email: { type: "email", required: true },
    country: { type: "enum", values: ["US", "GB"], required: true },
  },
  people: { alice: { name: "Alice", bookingUrl: "https://cal.com/alice/demo" } },
  rules: [{ id: "sales", assign: { person: "alice" } }],
  fallback: { redirect: "/success" },
  database: ":memory:",
  providers: {
    ownership: attio({ apiKey: "test-only" }),
    enrichment: pdl({ apiKey: "test-only" }),
  },
});
const lead = router.parse({ email: "buyer@example.com", country: "US" });
lead.email satisfies string;
lead.country satisfies "US" | "GB";
router.assign({ email: "buyer@example.com", country: "GB" }, { idempotencyKey: "one" });
// @ts-expect-error Required fields remain required in published declarations.
router.assign({ country: "US" }, { idempotencyKey: "two" });
// @ts-expect-error Enum literals must not widen to arbitrary strings.
router.assign({ email: "buyer@example.com", country: "AU" }, { idempotencyKey: "three" });
declare const customStore: AssignmentStore;
// @ts-expect-error database and store cannot both be supplied.
const invalid: RouterConfig<{}> = {
  schema: {},
  people: {},
  rules: [],
  fallback: { redirect: "/success" },
  database: ":memory:",
  store: customStore,
};
void invalid;
const research: ResearchInput = {
  company: { domain: "example.com" },
  business: { description: "Demo", icp: "Software" },
  assignment: {},
  routingPolicy: {},
};
void research;
router.close();
