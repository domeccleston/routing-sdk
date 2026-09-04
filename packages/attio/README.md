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
