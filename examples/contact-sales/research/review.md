# Minimal live research review — 2026-09-04

Ran three independent Pi/Docker sessions using `openai/gpt-5.6-luna` through
OpenRouter and real Parallel search. Expected conclusions were not supplied to
the agent. Each case used an isolated in-memory SQLite workflow, a synthetic
submission and synthetic enrichment/ownership. No real CRM writes, messages or
bookings were made.

| Case                                                       | Time | Manual assessment                                                                                                                                                       |
| ---------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linear, initial headcount 750                              | 73s  | Found contradictory public estimates; recommended verification, not an invented exact count. Correctly separated rule application from input quality.                   |
| GitHub, authoritative existing owner outside its territory | 36s  | Retained owner precedence; recognized Microsoft parent context without substituting parent size. Added unnecessary review noise despite a policy-consistent assignment. |
| Unverifiable company on an example.com subdomain           | 32s  | Identified reserved domain, rejected unrelated namesakes, left ICP fit unknown and retained unresolved routing.                                                         |

The three live tests and nine existing boundary tests passed. The live checks
cover saved reports, transition to notification/approval, no CRM execution, and
submission replay. These are integration checks; the quality judgments above
are manual, not an accuracy benchmark. Typechecking, lint, formatting and Knip
also passed for the review changes.

## Findings

1. **Research proposals do not match the action contract.** Linear proposed
   `company.employeeCount` with a request to re-enrich rather than a numeric
   replacement. Replaying acceptance against the in-memory Attio adapter threw
   `Unsupported proposed change`. That adapter only accepts
   `qualification: strong-fit`. Separate advisory findings, follow-up requests,
   and executable changes before wiring real research into the approval UI.
2. **The original live smoke command is not repeatable.** Re-running
   `npm run test:research:live` failed before researching its new lead: the shared
   database retains the prior run's pending notification stage, which the worker
   claims first. Use isolated run state or a research-only test definition.
3. **The agent over-flags policy-consistent cases.** In the GitHub case, it
   acknowledged that the existing owner wins, yet proposed reviewing the owner
   because of territory membership. It also requested exact-headcount review
   despite every estimate landing above the same threshold. Findings that do
   not change the decision should not automatically require an approval hold.

Spot checks against [Linear's About page](https://linear.app/about) and
[Microsoft's completed acquisition announcement](https://blogs.microsoft.com/blog/2018/10/26/microsoft-completes-github-acquisition/)
support the broad company descriptions. Exact third-party headcount estimates
were not independently established; the reports appropriately treated them as
uncertain. The source arrays mix supporting evidence with contextual URLs
(including the unresolvable submitted domain), so they are not proof of citation
quality by themselves.

## Reproduce

```sh
RUN_RESEARCH_INTEGRATION_TESTS=1 node --env-file=.env.research.local \
  node_modules/vitest/vitest.mjs run \
  examples/contact-sales/test/pi-research.live.test.ts \
  examples/contact-sales/test/pi-research.test.ts
```

Reports, source excerpts and full Pi sessions remain in the ignored
`examples/contact-sales/.data/research-review/` directory. Production behavior
was not changed as part of this review.
