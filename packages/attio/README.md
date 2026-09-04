# `@open-routing/attio`

Attio CRM ownership provider for `@open-routing/core`.

```ts
import { attio } from "@open-routing/attio";

const ownership = attio({
  apiKey: process.env.ATTIO_API_KEY!,
});
```

The adapter returns normalized owner identities and distinguishes owned,
unowned, missing-company, and unavailable states. Booking URLs remain outside
the CRM adapter.

## Company writes

The same client exposes Attio-specific operations. Application code owns field
mapping, research interpretation, approval and owner policy.

```ts
const client = attio({ apiKey: process.env.ATTIO_API_KEY! });
const receipt = await client.updateCompany({
  recordId: "existing-attio-record-id",
  values: { routing_research: "Research brief", routing_qualification: "strong-fit" },
  signal,
});

const createdOrUpdated = await client.upsertCompany({
  matchingAttribute: "domains",
  values: { domains: ["example.com"], name: "Example" },
  signal,
});
```

Receipts contain `{ recordId, url }`. Attribute slugs, types, select options and
workspace member IDs must already be valid for your workspace. The adapter does
not create schema or map router rep IDs automatically. Required write scopes are
`record_permission:read-write` and `object_configuration:read`.

`updateCompany` uses PATCH. Attio prepends supplied multiselect values rather than
replacing them. `upsertCompany` uses PUT and a unique `matching_attribute`; other
multiselect attributes are replaced by the supplied values. Only pass fields you
intend to change. See [update](https://docs.attio.com/rest-api/endpoint-reference/companies/update-a-company-record)
and [upsert](https://docs.attio.com/rest-api/endpoint-reference/records/upsert-a-record).

Writes throw `AttioWriteError` with a sanitized `code` and optional HTTP `status`.
There are no hidden retries, no native idempotency guarantee, and no research or
workflow dependency. Redirects are rejected to avoid forwarding authorization.
An injected `fetch` transport supports offline examples and contract tests.

The contact-sales demo applies approved qualification changes to
`routing_qualification` and saves the brief to `routing_research`. It preserves
existing owners and assigns an owner only when none was found. This read/write
sequence is not an atomic compare-and-set: live deployments need a conflict policy
for concurrent owner edits. Repeated scalar writes converge, but older lead updates
can overwrite newer values; ordering/reconciliation is application responsibility.

The demo's transport is in-memory and cannot call the network. Its fake rep IDs
double as workspace member IDs. Do not point that demo mapping at a real workspace:
configure real IDs and attributes first. The server does not enable live writes
merely because `ATTIO_API_KEY` is present. Creating person records, adding notes,
and changing meeting hosts remain out of scope.
