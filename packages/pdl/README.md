# `@open-routing/pdl`

Server-side People Data Labs company enrichment. Only an API key is required:

```ts
import { pdl } from "@open-routing/pdl";

const router = createRouter({
  schema,
  providers: {
    enrichment: pdl({ apiKey: process.env.PDL_API_KEY! }),
  },
  people,
  pools,
  rules,
  fallback,
  store,
});
```

The router derives a domain from your schema's `person.email` or `company.domain`
field. The adapter calls PDL's company-enrichment v5 endpoint once, authenticating
with `X-Api-Key` rather than putting the secret in the URL. Optional company name
is included as matching evidence. Never expose the key in browser code.

Normalized fields: `display_name` (or `name`) → `name`, `website` → `domain`,
`employee_count` → `employeeCount`, `location.country` → ISO alpha-2 `country`,
and `industry`. Unknown fields are omitted, never replaced with zero. Company size
and revenue ranges are not converted into invented numeric values. Unknown country
names are omitted rather than passed through to territory rules.

Options: `timeoutMs` defaults to 2000; `minLikelihood` defaults to 6 (range 1–10).
The confidence default follows [PDL's accuracy-sensitive matching guidance](https://docs.peopledatalabs.com/docs/input-parameters-company-enrichment-api).
PDL's [single-company response](https://docs.peopledatalabs.com/docs/output-response-company-enrichment-api)
is a top-level profile, not a `data` wrapper.

- HTTP 404 or a match below the configured confidence: `not_found`.
- 401/403: `unavailable` / `unauthorized`.
- 429: `unavailable` / `rate_limited`.
- Request/body deadline: `unavailable` / `timeout`.
- Other errors (including exhausted credits), malformed responses, and network
  failures: `unavailable` / `provider_error`.

Company-domain redirects are resolved before PDL enrichment by default:

```ts
pdl({ apiKey }); // resolveRedirects: true, redirectTimeoutMs: 800
pdl({ apiKey, resolveRedirects: false }); // use the submitted domain directly
```

Resolution starts at the company's HTTPS homepage and follows at most five HTTP
redirects using HEAD requests, with an 800ms total deadline (configurable separately
from the PDL timeout). Every hop is checked; private/reserved addresses, unsafe
schemes, credentials, custom ports, and known shared hosting/parking domains are
rejected. DNS is validated and the connection pinned to the checked address to
prevent DNS rebinding. Website requests carry no PDL credentials or form data.
Failures, loops, and unsafe destinations retain the submitted domain. There is no
HTTP retry for an unreachable HTTPS homepage and no JavaScript/meta-refresh support.

This affects only PDL's company lookup, not CRM ownership lookup or the visitor's
booking redirect. It does not change the form input or the email domain.

No automatic PDL retries, caching, page crawling, country web-search fallback,
free-email classification, or person enrichment. Those are separate policies.
Error bodies, raw profiles, and credentials are never returned or logged.

## Contact-sales example

Export `PDL_API_KEY` in your server environment and run `pnpm run dev`. With a key,
the example uses live PDL enrichment; without one, it keeps using fixtures. The dev
command does not automatically load `.env.local`. CRM ownership still uses fixtures.
Real lookups can consume PDL credits; synthetic `.example` presets are designed
for fixture mode. Tests mock requests and never call PDL or require a real key.
