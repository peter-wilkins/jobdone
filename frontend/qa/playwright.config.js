import { defineConfig, devices } from '@playwright/test';
/* global process */

const baseURL = process.env.QA_BASE_URL || 'http://localhost:5173';

export default defineConfig({
  testDir: './smoke',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]],
  use: {
    baseURL,
    channel: process.env.QA_BROWSER_CHANNEL || 'chrome',
    launchOptions: {
      args: ['--disable-crash-reporter', '--disable-crashpad'],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
