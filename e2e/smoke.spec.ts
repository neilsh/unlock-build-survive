/**
 * OWNER: package F. Browser smoke tests against the Vite dev server (see playwright.config.ts).
 *
 * Tests marked `PENDING` depend on packages that are still stubs on main:
 *  - physics (pkg A): PhysicsSim is a no-op, so no disaster ever ends.
 *  - presets/build (pkg C): BuildController.loadPreset is a no-op, so towers and houses are empty.
 * Flip the flag to false when the package lands. Screenshots go to test-results/ (gitignored).
 */
import { expect, test, type Page } from '@playwright/test';

const PENDING = {
  physics: false, // pkg A
  presets: false, // pkg C
};

/**
 * The sim advances at most 0.05 s per rendered frame (PhysicsSim maxFrameDt), and under SwiftShader a
 * frame costs 100-300 ms, so a real-time 8 s disaster takes 15-45 s of wall time on CI. The disaster
 * tests therefore only check that the frame loop drives the sim (a little real time), then finish the
 * run with `advance`, which takes the same fixed steps synchronously.
 */
const FRAME_LOOP_TIMEOUT_MS = 30_000;

/** Ignore noise the browser emits on its own, not from the game. */
const IGNORED_CONSOLE = [/favicon/i, /Download the React DevTools/i];

async function openGame(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__GAME_DEBUG__), null, { timeout: 30_000 });
}

async function telemetry(page: Page) {
  return page.evaluate(() => window.__GAME_DEBUG__!.getTelemetry());
}

/** Starts an earthquake, checks real frames advance it, then runs it to the end without waiting on frames. */
async function runEarthquake(page: Page) {
  await page.evaluate(() => window.__GAME_DEBUG__!.startDisaster('earthquake', 1));
  await page.waitForFunction(
    () => {
      const t = window.__GAME_DEBUG__!.getTelemetry();
      return t.mode === 'simulating' && t.timeRemaining < 7.9;
    },
    null,
    { timeout: FRAME_LOOP_TIMEOUT_MS, polling: 100 },
  );
  return page.evaluate(() => window.__GAME_DEBUG__!.advance(60));
}

test.describe('boot', () => {
  test('loads with no console or page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      errors.push(`console.error: ${text}`);
    });

    await openGame(page);
    await page.screenshot({ path: 'test-results/boot.png' });

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('debug API starts in build mode with an empty island', async ({ page }) => {
    await openGame(page);
    const t = await telemetry(page);
    expect(t.mode).toBe('build');
    expect(t.blockCount).toBe(0);
    expect(t.strutCount).toBe(0);
  });
});

test.describe('strength picker', () => {
  test('picks a strength and shows the full countdown while building', async ({ page }) => {
    await openGame(page);
    await page.getByTestId('menu-creative').click(); // the main menu is open at boot
    await expect(page.getByTestId('countdown')).toHaveText('8');
    await page.getByTestId('strength-strong').click();
    await expect(page.getByTestId('strength-strong')).toHaveAttribute('aria-pressed', 'true');
    expect((await telemetry(page)).strength).toBe('strong');
    await page.getByTestId('strength-gentle').click();
    expect((await telemetry(page)).strength).toBe('gentle');
  });
});

test.describe('towers and houses', () => {
  test.fixme(PENDING.presets || PENDING.physics, 'needs presets (pkg C) and PhysicsSim (pkg A)');

  test('tower fails, reports a first break, and rewinds', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => window.__GAME_DEBUG__!.loadPreset('tower'));
    expect((await telemetry(page)).blockCount).toBeGreaterThan(0);

    const end = await runEarthquake(page);
    expect(end.mode).toBe('failed');
    expect(end.firstBrokenId).not.toBeNull();
    await expect(page.getByTestId('lose-banner')).toBeVisible();
    await expect(page.getByTestId('result-banner')).toBeVisible();
    await expect(page.getByTestId('star-row')).toBeVisible();
    // The countdown stays at 0 after the run instead of jumping back to 8.
    await expect(page.getByTestId('countdown')).toHaveText('0');
    await page.screenshot({ path: 'test-results/tower-failed.png' });

    await page.evaluate(() => window.__GAME_DEBUG__!.rewind());
    const after = await telemetry(page);
    expect(after.mode).toBe('build');
    expect(after.firstBrokenId).toBeNull();
    expect(after.blockCount).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/tower-rewound.png' });
  });

  test('house survives the disaster and the run is won', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => window.__GAME_DEBUG__!.loadPreset('house'));
    expect((await telemetry(page)).blockCount).toBeGreaterThan(0);

    const end = await runEarthquake(page);
    expect(end.mode).toBe('survived');
    expect(end.firstBrokenId).toBeNull();
    await expect(page.getByTestId('win-banner')).toBeVisible();
    await expect(page.getByTestId('star-row')).toBeVisible();
    await expect(page.getByTestId('countdown')).toHaveText('0');
    await page.screenshot({ path: 'test-results/house-survived.png' });
  });
});

test.describe('music settings', () => {
  test('music volume slider is saved and restored after a reload', async ({ page }) => {
    await openGame(page);
    await page.getByTestId('menu-creative').click();
    const slider = page.getByTestId('music-volume');
    await slider.fill('25');
    await expect(slider).toHaveValue('25');
    await page.getByTestId('mute-toggle').click();
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__GAME_DEBUG__), null, { timeout: 30_000 });
    await page.getByTestId('menu-creative').click();
    await expect(page.getByTestId('music-volume')).toHaveValue('25');
    await expect(page.getByTestId('mute-toggle')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('split-screen co-op', () => {
  test('2P Split-Screen shows both viewports and runs without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      errors.push(`console.error: ${text}`);
    });

    await openGame(page);
    await page.getByTestId('mp-split').click();
    await expect(page.getByTestId('mp-split')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('menu-creative').click();

    await expect(page.getByTestId('mp-badge')).toContainText('Split-Screen');
    await expect(page.getByTestId('split-overlay')).toBeAttached();
    // P1's crosshair sits in the left half only.
    const box = await page.getByTestId('fp-crosshair').boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.width).toBeLessThanOrEqual(viewport.width / 2 + 1);
    // Each player has their own HP readout and build panel.
    await expect(page.getByTestId('p2-hp')).toBeVisible();
    await expect(page.getByTestId('p2-tool-block')).toBeVisible();
    await page.getByTestId('p2-tool-erase').click();
    await expect(page.getByTestId('p2-tool-erase')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tool-block')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(500); // let a few split-screen frames render
    await page.screenshot({ path: 'test-results/split-screen.png' });

    // Leaving split-screen restores the single full-width view.
    await page.getByTestId('menu-open').click();
    await page.getByTestId('mp-solo').click();
    await page.getByTestId('menu-creative').click();
    await expect(page.getByTestId('split-overlay')).toHaveCount(0);

    expect(errors, errors.join('\n')).toEqual([]);
  });
});
