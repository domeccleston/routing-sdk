export type ResearchInput = {
  company: { name?: string; domain: string };
  business: { description: string; icp: string };
  assignment: unknown;
  routingPolicy: unknown;
  context?: unknown;
};

export type ResearchReport = {
  brief: string;
  findings: { description: string; sources: string[] }[];
  review: { status: "consistent" | "needs-review" | "inconclusive"; reason: string };
};
export type ResearchResult = ResearchReport & { session: { id: string } };

/** Paths are inside the sandbox; credentials are passed as environment values. */
export type ResearchAgent = { command: string[]; env: Record<string, string> };
export type ResearchSearch = {
  instructions: string;
  env: Record<string, string>;
  files: Record<string, string>;
};
export type ResearchSandbox = {
  run(options: {
    id: string;
    directory: string;
    agent: ResearchAgent;
    signal?: AbortSignal;
  }): Promise<void>;
};
