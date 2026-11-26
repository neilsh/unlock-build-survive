/**
 * Production bundle on an emulated phone, served under the GitHub Pages base path
 * (project "production-mobile" in playwright.config.ts). Guards against a blank page on a real device.
 */
import { expect, test, type Page } from '@playwright/test';

/** Collects anything that would show up as a red error in a phone's console. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return errors;
}

test('the built game loads on a phone and shows the main menu', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('canvas')).toHaveCount(1);
  expect(await page.evaluate(() => document.getElementById('root')!.childElementCount)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('never a blank page: without WebGL the built game explains itself', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: (type: string) => unknown };
    const original = proto.getContext;
    proto.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith('webgl') || type === 'experimental-webgl') return null;
      return Reflect.apply(original, this, [type, ...rest]);
    };
  });
  await page.goto('./');
  await expect(page.getByTestId('startup-error')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('startup-error-detail')).toContainText(/WebGL/i);
  // Something visible, not just the sky-blue page background.
  expect((await page.evaluate(() => document.body.innerText)).length).toBeGreaterThan(40);
  expect(errors).toEqual([]);
});

test('never a blank page: if the game script fails to load a message appears', async ({ page }) => {
  await page.route('**/assets/index-*.js', (route) => route.abort());
  await page.goto('./');
  await expect(page.locator('#ubs-boot-error')).toBeVisible({ timeout: 15_000 });
});

test('a lost graphics context shows a reload prompt, then drawing resumes when it comes back', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // Count real draw calls so "recovered" means pixels are being drawn again, not just that a message went away.
  await page.addInitScript(() => {
    const w = window as unknown as { draws: number };
    w.draws = 0;
    const proto = WebGL2RenderingContext.prototype;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced'] as const) {
      const original = proto[name] as (...a: unknown[]) => void;
      (proto as unknown as Record<string, unknown>)[name] = function (this: unknown, ...a: unknown[]) {
        w.draws++;
        return original.apply(this, a);
      };
    }
  });
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60_000 });
  const draws = () => page.evaluate(() => (window as unknown as { draws: number }).draws);
  await expect.poll(draws, { timeout: 30_000 }).toBeGreaterThan(0);

  // Simulate the phone taking the GL context away.
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    // Keep the handle: a lost context no longer hands the extension out.
    const ext = gl!.getExtension('WEBGL_lose_context')!;
    (window as unknown as { loseCtxHandle: typeof ext }).loseCtxHandle = ext;
    ext.loseContext();
  });
  await expect(page.getByTestId('graphics-problem')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('graphics-problem-reload')).toBeVisible();

  // The browser hands the context back: the message goes away and frames are drawn again.
  const drawsWhileLost = await draws();
  await page.evaluate(() => {
    (window as unknown as { loseCtxHandle: { restoreContext(): void } }).loseCtxHandle.restoreContext();
  });
  await expect(page.getByTestId('graphics-problem')).toBeHidden({ timeout: 10_000 });
  await expect.poll(draws, { timeout: 15_000 }).toBeGreaterThan(drawsWhileLost + 20);
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect(errors).toEqual([]);
});
