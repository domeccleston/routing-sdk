import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import companies from "./fixtures/companies.json" with { type: "json" };
import workspaceMembers from "./fixtures/workspace-members.json" with { type: "json" };

export interface FakeAttio {
  baseUrl: string;
  close(): Promise<void>;
}

async function readJson(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function stop(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function startFakeAttio(): Promise<FakeAttio> {
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");

    if (request.method === "GET" && request.url === "/v2/workspace_members") {
      response.end(JSON.stringify(workspaceMembers));
      return;
    }

    if (request.method === "POST" && request.url === "/v2/objects/companies/records/query") {
      const body = (await readJson(request)) as { filter?: { domains?: string } };
      const domain = body.filter?.domains;
      const matchingCompanies = companies.data.filter((company) =>
        company.values.domains.some((entry) => entry.domain === domain),
      );

      response.end(JSON.stringify({ data: matchingCompanies }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "not_found" } }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v2`,
    close: () => stop(server),
  };
}
