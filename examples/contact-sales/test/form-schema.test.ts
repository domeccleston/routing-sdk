import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import schema from "../fixtures/routing/form-schema.json" with { type: "json" };
import { contactSalesSchema } from "../router.config.js";

describe("example contact-sales form", () => {
  it("keeps the portable schema fixture aligned with the typed configuration", () => {
    expect(schema).toEqual(contactSalesSchema);
  });

  it("has exactly the fields declared by the routing schema", async () => {
    const formPath = fileURLToPath(
      new URL("../public/index.html", import.meta.url),
    );
    const html = await readFile(formPath, "utf8");
    const formMarkup = html.match(/<form[^>]*>([\s\S]*?)<\/form>/)?.[1] ?? "";
    const formFieldNames = [...formMarkup.matchAll(/\bname="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined)
      .sort();

    expect(formFieldNames).toEqual(Object.keys(schema).sort());
  });

  it("keeps HTML select values aligned with enum schemas", async () => {
    const formPath = fileURLToPath(
      new URL("../public/index.html", import.meta.url),
    );
    const html = await readFile(formPath, "utf8");

    for (const [name, definition] of Object.entries(schema)) {
      if (!("values" in definition)) continue;

      const select = html.match(
        new RegExp(`<select name="${name}"[^>]*>([\\s\\S]*?)<\\/select>`),
      );
      expect(select, `missing select for ${name}`).not.toBeNull();

      const values = [...(select?.[1] ?? "").matchAll(/<option value="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((value): value is string => Boolean(value));

      expect(values).toEqual(definition.values);
    }
  });
});
