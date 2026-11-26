/** Browser smoke test for Village Island: bigger island, villagers, HP bars, lose on a villager KO. */
import { expect, test, type Page } from '@playwright/test';

async function openGame(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__GAME_DEBUG__), null, { timeout: 30_000 });
}

test.describe('village island', () => {
  test('starts on a bigger island with villagers and a village panel', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await openGame(page);
    await page.getByTestId('menu-village').click();

    await expect(page.getByTestId('village-panel')).toBeVisible();
    await expect(page.getByTestId('village-villagers')).toContainText('3 / 3');
    await expect(page.getByTestId('mode-badge')).toContainText('Village Island');

    // The big island fits a block the standard 8x8 island would reject.
    const placed = await page.evaluate(() => ({
      far: window.__GAME_DEBUG__!.placeBlock(13, 0, 13, 'wood'),
      beyond: window.__GAME_DEBUG__!.placeBlock(14, 0, 0, 'wood'),
    }));
    expect(placed).toEqual({ far: true, beyond: false });
    expect(errors).toEqual([]);
  });

  test('building a shelter adds beds; an unprotected village is lost when a villager is knocked out', async ({
    page,
  }) => {
    await openGame(page);
    await page.getByTestId('menu-village').click();
    await expect(page.getByTestId('village-beds')).toContainText('Shelter beds: 0');

    await page.evaluate(() => {
      const d = window.__GAME_DEBUG__!;
      for (const [x, y, z] of [
        [4, 0, 5],
        [6, 0, 5],
        [5, 0, 4],
        [5, 1, 5],
      ] as const)
        d.placeBlock(x, y, z, 'wood');
    });
    await expect(page.getByTestId('village-beds')).toContainText('Shelter beds: 2');

    // Three villagers, two beds: the third is left in the open, gets knocked out by a strong storm, and the village is lost.
    await page.evaluate(() => window.__GAME_DEBUG__!.startDisaster('hurricane', 1, 'strong'));
    await page.evaluate(() => window.__GAME_DEBUG__!.advance(12));
    await expect(page.getByTestId('village-over-banner')).toBeVisible();
    await expect(page.getByTestId('lose-banner')).toContainText('Village Lost');

    await page.getByTestId('village-retry').click();
    await expect(page.getByTestId('village-over-banner')).toBeHidden();
    await expect(page.getByTestId('village-villagers')).toContainText('3 / 3');
  });

  test('a village with enough shelter clears the round and moves on', async ({ page }) => {
    await openGame(page);
    await page.getByTestId('menu-village').click();
    await page.evaluate(() => {
      const d = window.__GAME_DEBUG__!;
      // Two huts: four beds for three villagers.
      for (const [x, y, z] of [
        [4, 0, 5],
        [6, 0, 5],
        [5, 0, 4],
        [5, 1, 5],
        [8, 0, 9],
        [10, 0, 9],
        [9, 0, 8],
        [9, 1, 9],
      ] as const)
        d.placeBlock(x, y, z, 'wood');
    });
    await page.getByTestId('test-disaster').click();
    await page.waitForFunction(() => window.__GAME_DEBUG__!.getTelemetry().mode === 'simulating', null, {
      timeout: 30_000,
    });
    await page.evaluate(() => window.__GAME_DEBUG__!.advance(12));
    await expect(page.getByTestId('village-cleared-banner')).toBeVisible();
    await page.getByTestId('village-next-round').click();
    await expect(page.getByTestId('mode-badge')).toContainText('Round 2');
    await expect(page.getByTestId('village-villagers')).toContainText('/ 4');
  });

  test('Alone and Village are separate choices: exit, continue and 2P work with both', async ({ page }) => {
    await openGame(page);
    await expect(page.getByTestId('modes-alone')).toBeVisible();
    await expect(page.getByTestId('modes-village')).toBeVisible();
    const place = (x: number) => page.evaluate((c) => window.__GAME_DEBUG__!.placeBlock(c, 0, c, 'wood'), x);

    // Village + 2P split-screen
    await page.getByTestId('mp-split').click();
    await page.getByTestId('menu-village').click();
    await expect(page.getByTestId('village-panel')).toBeVisible();
    expect(await place(13)).toBe(true);

    // Save, exit to the menu, continue: still the village on the big island
    await page.getByTestId('menu-open').click();
    await page.getByTestId('menu-save').dispatchEvent('click');
    await page.getByTestId('menu-exit').dispatchEvent('click');
    await page.getByTestId('exit-confirm-yes').dispatchEvent('click');
    await expect(page.getByTestId('village-panel')).toBeHidden();
    await page.getByTestId('menu-continue').dispatchEvent('click');
    await expect(page.getByTestId('village-panel')).toBeVisible();
    expect((await page.evaluate(() => window.__GAME_DEBUG__!.getGraph())).blocks).toHaveLength(1);

    // Exit, then play Alone: standard 8x8 island, no villagers
    await page.getByTestId('menu-open').click();
    await page.getByTestId('menu-exit').dispatchEvent('click');
    await page.getByTestId('exit-confirm-yes').dispatchEvent('click');
    await page.getByTestId('menu-creative').click();
    await expect(page.getByTestId('village-panel')).toBeHidden();
    expect(await place(13)).toBe(false);
    expect(await place(7)).toBe(true);
  });

  test('Village Creative: everything unlocked, no block limit, any disaster, nobody loses', async ({
    page,
  }) => {
    await openGame(page);
    await page.getByTestId('menu-village-creative').click();
    await expect(page.getByTestId('village-panel')).toContainText('Village Creative');
    await expect(page.getByTestId('village-villagers')).toContainText('6 / 6');
    await expect(page.getByTestId('block-count')).toBeHidden();
    await expect(page.getByTestId('material-diamond')).toBeEnabled();
    await expect(page.getByTestId('disaster-meteor')).toBeEnabled();
    expect(await page.evaluate(() => window.__GAME_DEBUG__!.placeBlock(13, 0, 13, 'wood'))).toBe(true);

    // No shelter at all and a strong storm: villagers get knocked out, but the village is not lost.
    await page.getByTestId('disaster-hurricane').click();
    await page.getByTestId('strength-strong').click();
    await page.getByTestId('test-disaster').click();
    await page.waitForFunction(() => window.__GAME_DEBUG__!.getTelemetry().mode === 'simulating', null, {
      timeout: 30_000,
    });
    await page.evaluate(() => window.__GAME_DEBUG__!.advance(12));
    await expect(page.getByTestId('village-over-banner')).toBeHidden();
    await expect(page.getByTestId('village-cleared-banner')).toBeHidden();
    await page.getByTestId('test-disaster').click(); // rewind
    await expect(page.getByTestId('village-villagers')).toContainText('6 / 6');
  });
});
