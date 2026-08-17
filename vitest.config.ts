import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "engine",
          // El motor y la lógica de colocación del cliente: todo código puro,
          // sin navegador ni red.
          include: ["src/engine/**/*.test.ts", "src/client/**/*.test.ts"],
          environment: "node",
        },
      },
      "./vitest.worker.config.ts",
    ],
  },
});
