import { expect, test } from '@playwright/test';

test('voice feedback fills the review text box before sending', async ({ page }) => {
  let feedbackSaveRequests = 0;

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'permissions', {
      value: {
        query: async () => ({ state: 'granted' }),
      },
      configurable: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop() {} }],
        }),
      },
      configurable: true,
    });
    window.MediaRecorder = class {
      constructor() {
        this.ondataavailable = null;
        this.onstop = null;
      }

      start() {
        setTimeout(() => {
          this.ondataavailable?.({
            data: new Blob(['audio'], { type: 'audio/webm;codecs=opus' }),
          });
        }, 0);
      }

      stop() {
        setTimeout(() => this.onstop?.(), 0);
      }
    };
  });

  await page.route('**/health', route => route.fulfill({ status: 200, body: 'ok' }));
  await page.route('**/api/transcribe', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ transcript: 'Recorder transcript ready for approval.' }),
  }));
  await page.route('**/api/feedback/save', route => {
    feedbackSaveRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  await page.goto('/#feedback');

  await page.getByTitle('Record issue').click();
  await page.getByTitle('Stop').click();

  await expect(page.getByPlaceholder(/what went wrong/i)).toHaveValue('Recorder transcript ready for approval.');
  await expect(page.getByText('Review the text, then send report.')).toBeVisible();
  expect(feedbackSaveRequests).toBe(0);
});
