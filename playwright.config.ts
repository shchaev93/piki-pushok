import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173/piki-pushok/' },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/piki-pushok/',
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'iphone-webkit',
      use: {
        browserName: 'webkit',
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'tablet-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
