import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    mockReset: true,
    testTimeout: 15_000, // userEvent typing into Cloudscape inputs is slow under parallel load
    server: { deps: { inline: [/@cloudscape-design/] } },
  },
});
