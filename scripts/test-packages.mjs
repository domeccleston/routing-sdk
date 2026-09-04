import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const temporary = await realpath(await mkdtemp(join(tmpdir(), "open-routing-packages-")));
const consumer = join(temporary, "consumer");
const archives = join(temporary, "archives");
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

try {
  await mkdir(consumer);
  await mkdir(archives);
  const packages = [];
  for (const entry of await readdir(join(root, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, "packages", entry.name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    packages.push({ directory, manifest });
  }
  const versions = new Map(packages.map(({ manifest }) => [manifest.name, manifest.version]));
  const dependencies = {};
  for (const { directory, manifest } of packages) {
    run("pnpm", ["pack", "--pack-destination", archives], directory);
    const archive = join(
      archives,
      `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`,
    );
    const entries = run("tar", ["-tzf", archive], root).trim().split("\n");
    for (const entry of entries) {
      assert.match(
        entry,
        /^package\/(?:package\.json|README(?:\.md)?|LICENSE(?:\.md)?|dist\/.*|public\/.*|sandbox\/.*)$/i,
        `Unexpected package file: ${entry}`,
      );
      assert(
        !/(?:^|\/)(?:\.env[^/]*|\.data|fixtures?|tests?|node_modules)(?:\/|$)/.test(entry),
        entry,
      );
      assert(!/\.sqlite(?:-|$)|\.test\.|\.ts$/.test(entry) || entry.endsWith(".d.ts"), entry);
    }
    const packed = JSON.parse(run("tar", ["-xOf", archive, "package/package.json"], root));
    for (const [name, version] of Object.entries(packed.dependencies ?? {})) {
      assert(!/^(workspace:|link:|file:)/.test(version), `Unresolved dependency: ${name}`);
      if (versions.has(name)) assert.equal(version, versions.get(name));
    }
    for (const target of Object.values(packed.exports["."])) {
      assert(
        entries.includes(`package/${target.replace(/^\.\//, "")}`),
        `Missing export: ${target}`,
      );
    }
    dependencies[manifest.name] = `file:${archive}`;
    console.log(`Packed and inspected ${manifest.name}`);
  }
  // Overrides keep transitive SDK dependencies on these same tarballs, never the registry.
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "isolated-package-consumer",
        private: true,
        type: "module",
        packageManager: "pnpm@10.20.0",
        dependencies,
        devDependencies: {
          typescript: require("typescript/package.json").version,
          "@types/node": require("@types/node/package.json").version,
        },
        pnpm: { overrides: dependencies, onlyBuiltDependencies: ["better-sqlite3"] },
      },
      null,
      2,
    ),
  );
  await cp(new URL("./consumer/", import.meta.url), consumer, { recursive: true });
  console.log("Installing tarballs in an isolated consumer (no workspace links)...");
  run("pnpm", ["install", "--no-frozen-lockfile"], consumer);
  for (const name of Object.keys(dependencies)) {
    const resolved = run(
      process.execPath,
      ["--input-type=module", "-e", `console.log(import.meta.resolve(${JSON.stringify(name)}))`],
      consumer,
    ).trim();
    assert(
      resolved.startsWith(pathToFileURL(`${consumer}/`).href),
      `Package escaped the consumer: ${resolved}`,
    );
    assert(resolved.endsWith("/dist/index.js"), resolved);
  }
  run(
    "pnpm",
    [
      "exec",
      "tsc",
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2023",
      "types.ts",
    ],
    consumer,
  );
  console.log(run(process.execPath, ["runtime.mjs"], consumer).trim());
  console.log("Tarball consumption and declaration checks passed.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
