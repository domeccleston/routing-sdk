import type { ResearchAgent, ResearchSearch } from "./types.js";

export function pi(options: {
  provider: string;
  model: string;
  apiKey: string;
  apiKeyEnv?: string;
}): ResearchAgent {
  if (!options.apiKey || !options.model || !options.provider)
    throw new Error("Pi provider, model and API key are required");
  const keys: Record<string, string> = {
    openrouter: "OPENROUTER_API_KEY",
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
  };
  const key = options.apiKeyEnv ?? keys[options.provider];
  if (!key || !/^[A-Z][A-Z0-9_]*$/.test(key))
    throw new Error("Supply apiKeyEnv for this Pi provider");
  return {
    command: [
      "pi",
      "--provider",
      options.provider,
      "--model",
      options.model,
      "--session",
      "/work/session.jsonl",
      "--mode",
      "json",
      "--print",
      "@/work/instructions.md",
      "@/work/context.json",
    ],
    env: { [key]: options.apiKey },
  };
}

export function parallel(options: { apiKey: string }): ResearchSearch {
  if (!options.apiKey) throw new Error("Parallel API key is required");
  return {
    env: { PARALLEL_API_KEY: options.apiKey },
    instructions:
      'Parallel search is available via `node /work/search.mjs "your search objective"`. You may also call its API directly or use other public web sources.',
    files: {
      "search.mjs": `const objective = process.argv.slice(2).join(" ");
if (!objective) throw new Error("Supply a search objective");
const response = await fetch("https://api.parallel.ai/v1/search", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": process.env.PARALLEL_API_KEY },
  body: JSON.stringify({ objective, search_queries: [objective] }),
});
if (!response.ok) throw new Error("Parallel search failed: HTTP " + response.status);
console.log(JSON.stringify(await response.json(), null, 2));
`,
    },
  };
}
