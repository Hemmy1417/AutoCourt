import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright owns tests/e2e (run via `npx playwright test` in its own
    // CI job); vitest collecting a Playwright spec throws at import time.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
  },
});
