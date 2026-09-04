import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["examples/**/*.test.ts", "packages/**/*.test.ts", "apps/**/*.test.ts"],
  },
});
