# Package builds and publication readiness

The SDK packages export compiled ESM JavaScript and `.d.ts` declarations from
`dist/`. Node.js 22+ is supported. Source tests can still import local source, but
cross-package imports, examples, and the demo resolve built package exports.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm test:packages
```

`build` clears generated package `dist/` directories and runs TypeScript in
dependency order. It does not bundle dependencies or native SQLite binaries.
`test:packages` builds before packing; do not run another build concurrently.

For development, `pnpm dev` builds once and starts the demo. Run `pnpm build:watch`
in another terminal to rebuild SDK edits. Individual example commands require an
initial `pnpm build`; workspace packages no longer export raw TypeScript.

## What the tarball test checks

All seven packages are packed with pnpm. The test checks file allowlists, export
targets, and replacement of `workspace:*` references with actual versions. It then
installs those tarballs into a temporary project outside the repository, overriding
internal dependencies to the same tarballs rather than fetching published SDKs.

The consumer typechecks against declarations without `skipLibCheck` and runs with
plain Node, without tsx. It verifies inferred schema types, imports every package,
assigns leads across a SQLite restart, and loads dashboard and research assets.
Registry access is required for third-party dependencies, and SQLite may require
native build tools. No paid provider calls, CRM writes, or Docker sessions run.
Temporary archives and the test database are removed after the test.

CI runs this consumer test after normal checks. Dashboard `public/` and research
`sandbox/` are included explicitly. Source trees, examples, test fixtures, private
environment files, and local databases are excluded from tarballs.

## Publication remains disabled

All packages retain `private: true`; there is no publishing workflow or registry
credential. Before release:

- Confirm ownership of `open-routing` and the `@open-routing` scope.
- Choose an OSS license and include it in each published package.
- Add repository metadata, initial versions, and public publication settings.
- Configure Changesets and an approved release workflow with trusted publishing.
- Document how consumers build or obtain the research Docker image.

The repository root, apps, and examples should stay private permanently.
