/** A phone that cannot make a WebGL context must see a message, never a blank page. */
import { expect, test } from '@playwright/test';

test('shows a visible message instead of a blank page when WebGL is unavailable', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: (type: string) => unknown };
    const original = proto.getContext;
    proto.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith('webgl') || type === 'experimental-webgl') return null;
      return Reflect.apply(original, this, [type, ...rest]);
    };
  });
  await page.goto('/');
  const box = page.getByTestId('startup-error');
  await expect(box).toBeVisible({ timeout: 30_000 });
  await expect(box).toContainText("can't draw the 3D island");
  await expect(page.getByTestId('startup-error-detail')).toContainText(/WebGL/i);
  await expect(page.getByTestId('startup-error-reload')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('shows a message when the game script itself cannot run', async ({ page }) => {
  await page.route('**/src/main.tsx*', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#ubs-boot-error')).toBeVisible({ timeout: 15_000 });
});
