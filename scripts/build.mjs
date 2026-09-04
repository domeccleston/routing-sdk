import { readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);
// Clear only generated package output so deleted source files cannot ship stale code.
for (const entry of await readdir(new URL("packages/", root), { withFileTypes: true })) {
  if (entry.isDirectory()) {
    await rm(new URL(`packages/${entry.name}/dist/`, root), { recursive: true, force: true });
  }
}
execFileSync("pnpm", ["--recursive", "--filter", "./packages/**", "run", "build"], {
  cwd: fileURLToPath(root),
  stdio: "inherit",
});
