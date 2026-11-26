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

test.describe('gamepad status', () => {
  test('menu says no pad is detected, then names the pad once the browser exposes one', async ({ page }) => {
    await page.addInitScript(() => {
      window.fakePad = { axes: [0, 0, 0, 0], down: new Set<number>() };
      let exposed = false;
      (window as unknown as { exposePad: () => void }).exposePad = () => {
        exposed = true;
      };
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () =>
          exposed
            ? [
                {
                  id: 'Late Pad',
                  index: 0,
                  connected: true,
                  mapping: '',
                  timestamp: 1,
                  axes: [0, 0, 0, 0],
                  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
                },
              ]
            : [null, null, null, null],
      });
    });
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__GAME_DEBUG__), null, { timeout: 30_000 });
    await expect(page.getByTestId('menu-gamepad-status')).toContainText('No gamepad detected');
    await page.evaluate(() => (window as unknown as { exposePad: () => void }).exposePad());
    await expect(page.getByTestId('menu-gamepad-status')).toContainText('Late Pad');
    await expect(page.getByTestId('menu-gamepad-warning')).toBeVisible();
  });
});

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

test.describe('gamepad settings', () => {
  test('the pad opens Settings with A, changes a toggle, and B backs out', async ({ page }) => {
    await installFakePad(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__GAME_DEBUG__), null, { timeout: 30_000 });
    await page.getByTestId('menu-settings').focus();
    await press(page, A, async () => {
      await expect(page.getByTestId('settings-modal')).toBeVisible();
    });
    await expect(page.getByTestId('settings-gamepad-status')).toContainText('Fake Standard Pad');
    await page.getByTestId('settings-invert-look').focus();
    await press(page, A, async () => {
      await expect(page.getByTestId('settings-invert-look')).toHaveAttribute('aria-pressed', 'true');
    });
    await press(page, 1, async () => {
      await expect(page.getByTestId('settings-modal')).toBeHidden();
    });
  });
});
