import { defineConfig, devices } from '@playwright/test';
/* global process */

const shouldStartLocalServer = !process.env.QA_BASE_URL;
const localPort = process.env.QA_PORT || '5174';
const resolvedBaseURL = process.env.QA_BASE_URL || `http://127.0.0.1:${localPort}`;

export default defineConfig({
  testDir: './smoke',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  webServer: shouldStartLocalServer ? {
    command: `npm run dev -- --host 127.0.0.1 --port ${localPort} --strictPort`,
    url: resolvedBaseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  } : undefined,
  use: {
    baseURL: resolvedBaseURL,
    channel: process.env.QA_BROWSER_CHANNEL || 'chrome',
    launchOptions: {
      args: ['--disable-crash-reporter', '--disable-crashpad'],
    },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chrome-mobile',
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],
});
