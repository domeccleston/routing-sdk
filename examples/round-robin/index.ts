import { createRouter } from "open-routing";

const router = createRouter({
  schema: { email: { type: "email", required: true } },
  people: {
    alice: { name: "Alice", bookingUrl: "https://cal.com/dom-eccleston/30min" },
    bob: { name: "Bob", bookingUrl: "https://cal.com/dom-eccleston/30min" },
  },
  pools: { sales: { members: ["alice", "bob"] } },
  rules: [{ id: "sales", assign: { pool: "sales" } }],
  fallback: { redirect: "/success" },
  database: ":memory:",
});
try {
  const first = await router.assign({ email: "first@example.com" }, { idempotencyKey: "lead-1" });
  const replay = await router.assign({ email: "first@example.com" }, { idempotencyKey: "lead-1" });
  const second = await router.assign({ email: "second@example.com" }, { idempotencyKey: "lead-2" });
  console.log(
    JSON.stringify({
      assigned: [first.personId, replay.personId, second.personId],
      next: (await router.getPoolState("sales"))?.nextPersonId,
    }),
  );
} finally {
  await router.close();
}
