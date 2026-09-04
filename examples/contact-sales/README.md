# Contact-sales example

A self-contained example showing the SDK's initial use case:

1. Receive an HTML form POST.
2. Parse it against a typed schema.
3. Resolve fixture enrichment and Attio-shaped ownership data.
4. Assign the CRM owner, or round-robin within a matching territory pool.
5. Commit the assignment and rotation, log the decision, and issue a `303` redirect.
6. Go directly to the selected Cal.com calendar or the success page.

All demo representatives currently use `https://cal.com/dom-eccleston/30min`.
US Enterprise rotates between Amelia and Marcus; the other pools currently have
one member. Reload the form for a new opportunity. Retrying the same form POST
reuses its hidden submission key and returns the original assignment.

From the repository root, run `npm run dev` and open
<http://localhost:3000>.
