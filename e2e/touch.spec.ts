import { expect, test, type Page } from '@playwright/test';

async function openGame(page: Page) {
  // A real gamepad plugged into the test machine would otherwise open menus behind the test's back.
  await page.addInitScript(() => {
    navigator.getGamepads = () => [];
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__GAME_DEBUG__), null, { timeout: 30_000 });
}

async function startCreative(page: Page) {
  await openGame(page);
  await page.getByTestId('menu-creative').click();
}

const LANDSCAPE = { width: 844, height: 390 };
const PORTRAIT = { width: 390, height: 844 };

/** Every visible button on screen is a comfortable finger target. */
async function expectTappable(page: Page) {
  const small = await page.evaluate(() => {
    const bad: string[] = [];
    for (const b of document.querySelectorAll('button')) {
      const r = b.getBoundingClientRect();
      const style = getComputedStyle(b);
      if (r.width === 0 || r.height === 0 || style.visibility === 'hidden') continue;
      if (b.tabIndex === -1) continue; // full-screen modal backdrops
      if (Math.min(r.width, r.height) < 40) {
        const label = b.getAttribute('data-testid') ?? b.textContent;
        bad.push(`${label} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return bad;
  });
  expect(small).toEqual([]);
}

/** Drags the view down with a finger-like drag so the crosshair lands on the island floor just ahead. */
async function lookDown(page: Page) {
  const box = (await page.locator('canvas').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // A little sideways too: straight ahead the crosshair would graze the edge between two grid cells.
  await page.mouse.move(x + 40, y + 200, { steps: 8 });
  await page.mouse.up();
}

for (const [name, viewport] of [
  ['landscape phone', LANDSCAPE],
  ['portrait phone', PORTRAIT],
] as const) {
  test.describe(`touch controls · ${name}`, () => {
    test.use({ hasTouch: true, isMobile: true, viewport });

    test('shows the joystick and action buttons and survives a drag', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.emulateMedia({ media: 'screen' });
      await startCreative(page);
      const stick = page.getByTestId('touch-joystick');
      await expect(stick).toBeVisible();
      await expect(page.getByTestId('touch-jump')).toBeVisible();
      await expect(page.getByTestId('touch-build')).toBeVisible();
      await expect(page.getByTestId('touch-break')).toBeVisible();
      const box = (await stick.boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 40, { steps: 4 });
      await page.mouse.up();
      expect(errors).toEqual([]);
    });

    test('the page never scrolls or zooms, and the HUD stays inside the screen', async ({ page }) => {
      await startCreative(page);
      const meta = await page.locator('meta[name="viewport"]').getAttribute('content');
      expect(meta).toContain('user-scalable=no');
      expect(meta).toContain('viewport-fit=cover');
      const layout = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        scrollH: document.documentElement.scrollHeight,
        w: window.innerWidth,
        h: window.innerHeight,
        overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY,
      }));
      expect(layout.scrollW).toBeLessThanOrEqual(layout.w);
      expect(layout.scrollH).toBeLessThanOrEqual(layout.h);
      expect(layout.overscroll).toBe('none');
      await page.mouse.wheel(0, 400);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const ids = ['touch-joystick', 'touch-jump', 'touch-build', 'test-disaster', 'menu-open'];
      const boxes = await Promise.all(ids.map((id) => page.getByTestId(id).boundingBox()));
      ids.forEach((id, i) => {
        const b = boxes[i]!;
        expect(b.x, id).toBeGreaterThanOrEqual(0);
        expect(b.y, id).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, id).toBeLessThanOrEqual(viewport.width);
        expect(b.y + b.height, id).toBeLessThanOrEqual(viewport.height);
      });
    });

    test('buttons are big enough to tap in the HUD, the tools drawer and the disaster drawer', async ({
      page,
    }) => {
      await startCreative(page);
      await expectTappable(page);
      await page.getByTestId('build-drawer-toggle').tap();
      await expect(page.getByTestId('tool-block')).toBeVisible();
      await expectTappable(page);
      await page.getByTestId('build-drawer-toggle').tap();
      await page.getByTestId('disaster-picker-toggle').tap();
      await expect(page.getByTestId('disaster-hail')).toBeVisible();
      await expectTappable(page);
    });

    test('tools drawer picks tool and material; the disaster drawer picks a disaster', async ({ page }) => {
      await startCreative(page);
      await expect(page.getByTestId('tool-block')).toHaveCount(0); // folded away by default
      await page.getByTestId('build-drawer-toggle').tap();
      await page.getByTestId('tool-paint').tap();
      await page.getByTestId('material-stone').tap();
      await expect(page.getByTestId('tool-paint')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('material-stone')).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('build-drawer-toggle').tap();
      await expect(page.getByTestId('touch-build')).toContainText('Paint');
      await page.getByTestId('disaster-picker-toggle').tap();
      await page.getByTestId('disaster-hail').tap();
      await expect(page.getByTestId('disaster-hail')).toHaveAttribute('aria-pressed', 'true');
    });

    test('Build and Break buttons place and remove a block at the crosshair', async ({ page }) => {
      await startCreative(page);
      await lookDown(page);
      const blocks = () => page.evaluate(() => window.__GAME_DEBUG__!.getGraph().blocks.length);
      expect(await blocks()).toBe(0);
      await page.getByTestId('touch-build').tap();
      await expect.poll(blocks).toBe(1);
      await page.getByTestId('touch-break').tap();
      await expect.poll(blocks).toBe(0);
    });

    test('a quick tap on the 3D view only looks around, it does not build', async ({ page }) => {
      await startCreative(page);
      await lookDown(page);
      const box = (await page.locator('canvas').boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.__GAME_DEBUG__!.getGraph().blocks.length)).toBe(0);
    });

    test('Village Island is playable: card, tools drawer, build and test buttons', async ({ page }) => {
      await openGame(page);
      await page.getByTestId('menu-village').click();
      await expect(page.getByTestId('village-panel')).toBeVisible();
      await expect(page.getByTestId('touch-build')).toBeVisible();
      await expect(page.getByTestId('build-drawer-toggle')).toBeVisible();
      await expect(page.getByTestId('test-disaster')).toBeVisible();
      await expectTappable(page);
    });

    test('starts on medium graphics and the Settings screen fits the screen', async ({ page }) => {
      await openGame(page);
      await page.getByTestId('menu-settings').tap();
      await expect(page.getByTestId('settings-quality-medium')).toHaveAttribute('aria-pressed', 'true');
      const modal = (await page.getByTestId('settings-modal').boundingBox())!;
      expect(modal.x).toBeGreaterThanOrEqual(0);
      expect(modal.x + modal.width).toBeLessThanOrEqual(viewport.width);
      expect(modal.y + modal.height).toBeLessThanOrEqual(viewport.height);
      await expectTappable(page);
    });

    test('the pause menu opens from the HUD and resumes', async ({ page }) => {
      await startCreative(page);
      await page.getByTestId('menu-open').tap();
      await expect(page.getByTestId('main-menu')).toBeVisible();
      await expect(page.getByTestId('touch-controls')).toHaveCount(0);
      await page.getByTestId('menu-resume').tap();
      await expect(page.getByTestId('main-menu')).toBeHidden();
      await expect(page.getByTestId('touch-controls')).toBeVisible();
    });
  });
}

test.describe('mouse device', () => {
  test('hides touch controls and keeps the full desktop HUD', async ({ page }) => {
    await startCreative(page);
    await expect(page.getByTestId('touch-controls')).toHaveCount(0);
    await expect(page.getByTestId('tool-block')).toBeVisible();
    await expect(page.getByTestId('disaster-picker-toggle')).toHaveCount(0);
  });

  test('starts on high graphics', async ({ page }) => {
    await openGame(page);
    await page.getByTestId('menu-settings').click();
    await expect(page.getByTestId('settings-quality-high')).toHaveAttribute('aria-pressed', 'true');
  });
});
