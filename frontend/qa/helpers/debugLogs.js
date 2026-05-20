import { expect } from '@playwright/test';

const DEBUG_STORAGE_KEY = 'jobdone-debug-logs';

export async function enableDebugLogs(page) {
  const logs = [];
  page.on('console', message => {
    if (message.text().startsWith('[JobDone debug]')) {
      logs.push(message.text());
    }
  });

  await page.addInitScript(({ key }) => {
    window.__JOBDONE_QA_DEBUG__ = true;
    window.localStorage.setItem(key, 'true');
  }, { key: DEBUG_STORAGE_KEY });

  return logs;
}

export async function expectDebugLog(logs, pattern) {
  await expect.poll(
    () => logs.some(line => pattern.test(line)),
    { message: `Expected debug log matching ${pattern}` }
  ).toBe(true);
}
