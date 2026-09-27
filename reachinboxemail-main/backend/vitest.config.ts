import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 90_000,
    // Integration tests share Postgres/Redis/ES — run files one at a time.
    fileParallelism: false,
    // Child-process pool: worker threads crash (access violation) on some Windows setups.
    pool: "forks",
    isolate: true,
    // Isolate from any other instance sharing localhost Redis db 0 / the dev ES index.
    // dotenv never overrides existing process.env, so these win over .env.
    env: {
      REDIS_URL: "redis://localhost:6379/9",
      EMAIL_SEARCH_INDEX: "emails_test",
    },
    setupFiles: ["src/tests/setup.ts"],
  },
});
