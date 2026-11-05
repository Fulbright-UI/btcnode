import { defineConfig, devices } from '@playwright/test';

// The page against the mock node (backend/test/mock-server.ts), which serves
// the built frontend on :3000. Build shared and frontend first.
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:3000' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter ./backend mock',
    url: 'http://127.0.0.1:3000/api/health',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
});
