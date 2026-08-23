import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@blackglass/contracts": fileURLToPath(
        new URL("../contracts/src/index.ts", import.meta.url),
      ),
      "@blackglass/domain": fileURLToPath(
        new URL("../domain/src/index.ts", import.meta.url),
      ),
    },
    conditions: ["development"],
  },
});
