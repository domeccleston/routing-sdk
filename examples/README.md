# Examples

Each directory is an independent, single-scenario program. Examples import SDK packages, never each other or the demo application.

Run `pnpm install` at the repository root, then follow an example’s README.

| Example                                | Scenario                                        | Default services                     |
| -------------------------------------- | ----------------------------------------------- | ------------------------------------ |
| [round-robin](round-robin)             | Rotate between people; retry safely             | None                                 |
| [territories](territories)             | Select a territory, then rotate within its pool | None                                 |
| [crm-ownership](crm-ownership)         | Prefer an existing account owner                | Simulated; Attio opt-in              |
| [enrichment](enrichment)               | Route on enriched company size                  | Simulated; PDL opt-in                |
| [research](research)                   | Research a company and review an assignment     | Live model + search, Docker required |
| [workflow-approval](workflow-approval) | Pause and resume background work for review     | None                                 |

The five offline scenarios use in-memory SQLite and are exercised by `pnpm test`. Research is explicitly live and may incur charges.

Routing examples use `open-routing`. They set `database: ":memory:"` for repeatable
runs; omit it to persist state in `.data/routing.sqlite`. The workflow example
supplies a store explicitly because it also operates on its workflow queue.

For the complete form, dashboard, research, and CRM workflow, use the [demo application](../apps/demo/README.md). Run it from the root with `pnpm run dev`.
