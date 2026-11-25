import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    test: {
      passWithNoTests: true,
      projects: [
        {
          test: {
            name: 'shared',
            environment: 'node',
            include: ['test/shared/**/*.test.ts'],
          },
        },
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: './wrangler.jsonc' },
              miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
            }),
          ],
          test: {
            name: 'worker',
            include: ['test/worker/**/*.test.ts'],
            setupFiles: ['./test/worker/apply-migrations.ts'],
          },
        },
        {
          test: {
            name: 'web',
            environment: 'jsdom',
            environmentOptions: { jsdom: { url: 'http://localhost/' } },
            setupFiles: ['./test/web/setup.ts'],
            include: ['test/web/**/*.test.ts'],
          },
        },
      ],
    },
  };
});
