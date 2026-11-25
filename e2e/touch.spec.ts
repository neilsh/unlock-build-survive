import { expect, test, type Page } from '@playwright/test';

async function startCreative(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__GAME_DEBUG__), null, { timeout: 30_000 });
  await page.getByTestId('menu-creative').click();
}

test.describe('touch controls', () => {
  test.describe('touch device', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

    test('shows the joystick and jump button and survives a drag', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.emulateMedia({ media: 'screen' });
      await startCreative(page);
      const stick = page.getByTestId('touch-joystick');
      await expect(stick).toBeVisible();
      await expect(page.getByTestId('touch-jump')).toBeVisible();
      const box = (await stick.boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 40, { steps: 4 });
      await page.mouse.up();
      expect(errors).toEqual([]);
    });
  });

  test.describe('mouse device', () => {
    test('hides touch controls', async ({ page }) => {
      await startCreative(page);
      await expect(page.getByTestId('touch-controls')).toHaveCount(0);
    });
  });
});
