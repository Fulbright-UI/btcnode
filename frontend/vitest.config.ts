import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    // Node 25 and later bring their own localStorage, which hides happy-dom's
    execArgv: ['--no-experimental-webstorage'],
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/*.test.ts', 'src/test/**'],
      reporter: ['text-summary'],
      // just below the measured values; raise them as tests are added
      thresholds: { statements: 98, branches: 96, functions: 99, lines: 99 },
    },
  },
});
