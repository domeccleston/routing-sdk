# Demo application

This app combines the SDK features in one end-to-end flow. For small, independent
scenarios, see [the examples](../../examples/README.md).

A contact-sales form, routing server and local admin dashboard using the SDK:

1. Receive an HTML form POST.
2. Parse it against a typed schema.
3. Resolve company enrichment and CRM ownership (offline fixtures by default).
4. Assign the CRM owner, or round-robin within a matching territory pool.
5. Commit the assignment and rotation, log the decision, and issue a `303` redirect.
6. Go directly to the selected Cal.com calendar or the success page.
7. Run background research, notify, review if needed, then update the CRM.

All demo representatives currently use `https://cal.com/dom-eccleston/30min`.
US Enterprise rotates between Amelia and Marcus; the other pools currently have
one member. Reload the form for a new opportunity. Retrying the same form POST
reuses its hidden submission key and returns the original assignment.

## Layout

```text
router.config.ts   Form schema, people, pools and routing rules
src/               Server and application-owned workflow/provider configuration
fixtures/          Demo providers, simulated research/CRM, and sample data
public/            Contact form and success page
scripts/           Offline workflow demo and live Attio end-to-end runner
test/              Automated tests, including opt-in live research
.data/             Ignored local databases and research session artifacts
```

The reusable agent, sandbox and provider adapters live in
[@open-routing/research](../../packages/research/README.md). `src/research.ts`
only supplies business instructions and maps its result into the application
workflow. `src/update-attio.ts` owns the explicit CRM write policy.

## Run

From the repository root:

| Command                                              | Behavior                                             |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `pnpm run dev`                                       | Offline demo at <http://localhost:3000>              |
| `pnpm run dev:attio`                                 | Real Attio, simulated research                       |
| `pnpm run dev:research`                              | Real SDK research; CRM mode configured independently |
| `pnpm --filter @open-routing/demo run workflow:demo` | Offline workflow walkthrough                         |

For Attio, configure `ATTIO_API_KEY` and `ATTIO_WORKSPACE_MEMBER_ID` in the
ignored root `.env.local`. See the [root README](../../README.md) for the required
Attio attributes and live test setup. All demo rep IDs map to that single member.

For research, put `OPENROUTER_API_KEY`, `PARALLEL_API_KEY`, and optionally
`RESEARCH_MODEL` in the ignored root `.env.research.local`. Start Docker and run
`pnpm run research:build` once. The default model is `openai/gpt-5.6-luna`.

The server uses demo research unless `RESEARCH_LIVE=1`. `ATTIO_LIVE` independently
controls real CRM writes. Notifications are simulated. Demo research controls
on the form are ignored in live research mode. Live and demo modes use separate
workflow definitions; workers must run in the corresponding mode to drain them.

Research returns findings and a policy review, not executable CRM changes.
`needs-review` and `inconclusive` hold the workflow; `consistent` continues.
A reviewer can retain the assignment and release the CRM step. Legacy demo
qualification proposals use their existing allowlisted action.

## Test

`pnpm test` is offline by default. Live commands make paid provider calls:

- `pnpm run test:research:live`: one company-size routing smoke test.
- `pnpm run test:research:review`: size mismatch, existing-owner precedence and an unknown company.
- `pnpm run test:attio:e2e`: real form-to-Attio integration against a labelled test company.

Research tests use isolated in-memory workflow queues and never execute CRM
writes or real notifications. Reports and Pi transcripts remain under
`.data/research-review/<case>/<session-id>/`. They are sensitive, ignored local
artifacts—not content to commit or publish. No test creates a real calendar booking.
