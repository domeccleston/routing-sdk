import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { routingCases } from "../fixtures/routing/scenarios.js";

async function fixture<T>(relativePath: string): Promise<T> {
  const path = fileURLToPath(new URL(`../fixtures/${relativePath}`, import.meta.url));
  return JSON.parse(await readFile(path, "utf8")) as T;
}

describe("routing fixtures", () => {
  it("uses unique IDs and valid rep references", async () => {
    const reps = await fixture<Array<{ id: string; bookingUrl: string }>>("routing/reps.json");
    const territories = await fixture<Array<{ id: string; repIds: string[] }>>(
      "routing/territories.json",
    );

    expect(new Set(reps.map(({ id }) => id)).size).toBe(reps.length);
    expect(new Set(territories.map(({ id }) => id)).size).toBe(territories.length);

    const repIds = new Set(reps.map(({ id }) => id));
    for (const territory of territories) {
      expect(territory.repIds.length).toBeGreaterThan(0);
      expect(territory.repIds.every((id) => repIds.has(id))).toBe(true);
    }
  });

  it("keeps CRM owners resolvable to configured reps", async () => {
    const reps = await fixture<Array<{ id: string }>>("routing/reps.json");
    const companies = await fixture<{
      data: Array<{ values: { account_owner: Array<{ referenced_actor_id: string }> } }>;
    }>("attio/companies.json");

    const repIds = new Set(reps.map(({ id }) => id));
    const ownerIds = companies.data.flatMap(({ values }) =>
      values.account_owner.map(({ referenced_actor_id }) => referenced_actor_id),
    );

    expect(ownerIds.every((id) => repIds.has(id))).toBe(true);
  });

  it("defines unique scenario names", () => {
    expect(new Set(routingCases.map(({ name }) => name)).size).toBe(routingCases.length);
  });
});
