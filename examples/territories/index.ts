import { createRouter } from "open-routing";

const router = createRouter({
  schema: { country: { type: "enum", values: ["US", "GB", "AU"], required: true } },
  people: Object.fromEntries(
    ["alice", "bob", "charlie"].map((id) => [
      id,
      { name: id, bookingUrl: "https://cal.com/dom-eccleston/30min" },
    ]),
  ),
  pools: {
    us: { members: ["alice", "bob"] },
    uk: { members: ["charlie"] },
  },
  rules: [
    { id: "us", when: { field: "input.country", equals: "US" }, assign: { pool: "us" } },
    { id: "uk", when: { field: "input.country", equals: "GB" }, assign: { pool: "uk" } },
  ],
  fallback: { redirect: "/success" },
  database: ":memory:",
});
try {
  const decisions = [];
  for (const [index, country] of (["US", "GB", "US", "AU"] as const).entries()) {
    const result = await router.assign({ country }, { idempotencyKey: `lead-${index}` });
    decisions.push({
      country,
      pool: result.poolId ?? null,
      person: result.personId ?? null,
      redirect: result.redirectUrl,
    });
  }
  console.log(JSON.stringify(decisions));
} finally {
  await router.close();
}
