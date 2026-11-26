import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    fakePad: { axes: number[]; down: Set<number> };
  }
}

/** Installs a fake standard gamepad whose state the test drives through `window.fakePad`. */
async function installFakePad(page: Page) {
  await page.addInitScript(() => {
    window.fakePad = { axes: [0, 0, 0, 0], down: new Set<number>() };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [
        {
          id: 'Fake Standard Pad',
          index: 0,
          connected: true,
          mapping: 'standard',
          timestamp: performance.now(),
          axes: window.fakePad.axes,
          buttons: Array.from({ length: 17 }, (_, i) => ({
            pressed: window.fakePad.down.has(i),
            value: window.fakePad.down.has(i) ? 1 : 0,
          })),
        },
      ],
    });
  });
}

/** Holds a button until `effect` is observed (frames are slow under SwiftShader), then releases it. */
async function press(page: Page, button: number, effect: () => Promise<void>) {
  await page.evaluate((b) => window.fakePad.down.add(b), button);
  try {
    await effect();
  } finally {
    await page.evaluate((b) => window.fakePad.down.delete(b), button);
    await page.waitForTimeout(300);
  }
}

const START = 9;
const A = 0;

test.describe('gamepad (solo)', () => {
  test('menu navigation, Start pause/resume', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await installFakePad(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__GAME_DEBUG__), null, { timeout: 30_000 });
    await expect(page.getByTestId('menu-gamepad-hint')).toBeVisible();

    // A focuses the first menu item; then A on the Creative button starts the game.
    await press(page, A, () => expect(page.locator('[data-gamepad-focus]')).toHaveCount(1));
    await page.getByTestId('menu-creative').focus();
    await press(page, A, () => expect(page.getByTestId('main-menu')).toHaveCount(0));

    // Start pauses; D-pad moves focus; Start resumes.
    await press(page, START, () => expect(page.getByTestId('main-menu')).toBeVisible());
    await press(page, A, () => expect(page.locator('[data-gamepad-focus]')).toHaveCount(1));
    await press(page, START, () => expect(page.getByTestId('main-menu')).toHaveCount(0));
    expect(errors).toEqual([]);
  });
});
