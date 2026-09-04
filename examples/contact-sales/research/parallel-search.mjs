// Convenience CLI, not an agent tool boundary. The agent can also use curl,
// write scripts, install libraries, and browse other public sources directly.
const objective = process.argv.slice(2).join(" ");
if (!objective) throw new Error("Usage: node /opt/research/parallel-search.mjs <search objective>");
const response = await fetch("https://api.parallel.ai/v1/search", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": process.env.PARALLEL_API_KEY },
  body: JSON.stringify({ objective, search_queries: [objective] }),
});
if (!response.ok) throw new Error(`Parallel search failed: HTTP ${response.status}`);
console.log(JSON.stringify(await response.json(), null, 2));
