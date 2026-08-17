import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "engine",
          include: ["src/engine/**/*.test.ts"],
          environment: "node",
        },
      },
      "./vitest.worker.config.ts",
    ],
  },
});
