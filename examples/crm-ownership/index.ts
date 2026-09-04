import { createRouter, type CrmOwnershipProvider } from "open-routing";
import { attio } from "@open-routing/attio";

const live = process.env.ATTIO_LIVE === "1";
const ownerId = live ? process.env.ATTIO_WORKSPACE_MEMBER_ID : "bob";
if (!ownerId || (live && !process.env.ATTIO_API_KEY))
  throw new Error("Live mode requires ATTIO_API_KEY and ATTIO_WORKSPACE_MEMBER_ID");
const ownership: CrmOwnershipProvider = live
  ? attio()
  : {
      name: "demo-crm",
      async findOwner() {
        return { status: "owned", company: { id: "demo-company" }, owner: { id: ownerId } };
      },
    };

const router = createRouter({
  schema: { email: { type: "email", required: true, role: "person.email" } },
  people: {
    alice: { name: "Alice", bookingUrl: "https://cal.com/dom-eccleston/30min" },
    [ownerId]: {
      name: "Existing account owner",
      bookingUrl: "https://cal.com/dom-eccleston/30min",
    },
  },
  pools: { sales: { members: ["alice", ownerId] } },
  providers: { ownership },
  rules: [
    {
      id: "existing-owner",
      when: { field: "crm.owner.status", equals: "owned" },
      assign: { owner: true },
    },
    { id: "new-account", assign: { pool: "sales" } },
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
      person: result.personId,
      rule: result.ruleId,
      nextInPool: (await router.getPoolState("sales"))?.nextPersonId,
    }),
  );
} finally {
  await router.close();
}
