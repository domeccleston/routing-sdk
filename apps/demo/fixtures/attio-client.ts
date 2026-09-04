import { createHash } from "node:crypto";
import { attio, type AttioValue } from "@open-routing/attio";
import companies from "./attio/companies.json" with { type: "json" };

/** Minimal in-memory Attio HTTP simulation. It cannot make network requests. */
export function createDemoAttio() {
  const records = new Map<
    string,
    { id: { record_id: string }; values: Record<string, AttioValue> }
  >(companies.data.map((company) => [company.id.record_id, structuredClone(company)]));
  const transport: typeof fetch = async (input, init) => {
    init?.signal?.throwIfAborted();
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? "{}"));
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify({ data }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.pathname.endsWith("/records/query")) {
      return json(
        [...records.values()].filter((record) =>
          JSON.stringify(record.values.domains).includes(JSON.stringify(body.filter?.domains)),
        ),
      );
    }
    const values = body.data?.values as Record<string, AttioValue> | undefined;
    if (!values) return json(null, 400);
    let record;
    if (init?.method === "PUT" && url.searchParams.get("matching_attribute") === "domains") {
      const domain = (values.domains as string[])?.[0];
      if (typeof domain !== "string") return json(null, 400);
      record = [...records.values()].find((r) =>
        JSON.stringify(r.values.domains).includes(JSON.stringify(domain)),
      );
      record ??= {
        id: { record_id: `demo_${createHash("sha256").update(domain).digest("hex").slice(0, 16)}` },
        values: {},
      };
    } else if (init?.method === "PATCH")
      record = records.get(decodeURIComponent(url.pathname.split("/").at(-1)!));
    if (!record) return json(null, 404);
    for (const [key, value] of Object.entries(values)) {
      // Normalize the attributes used by this demo into Attio read representations.
      record.values[key] =
        key === "domains"
          ? (value as string[]).map((domain) => ({ domain }))
          : typeof value === "string"
            ? [{ value }]
            : value;
    }
    records.set(record.id.record_id, record);
    return json(record);
  };
  return { client: attio({ apiKey: "demo-only", fetch: transport }), records };
}
