import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "jsdom", globals: true },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // server-only y next/headers no existen en jsdom; los silenciamos para
      // que los tests de helpers puros que importan módulos con "use server"
      // puedan resolverse sin error.
      "server-only": fileURLToPath(new URL("./src/__mocks__/server-only.ts", import.meta.url)),
      "next/headers": fileURLToPath(new URL("./src/__mocks__/next-headers.ts", import.meta.url)),
    },
  },
});
