import { expect, test, type Page } from '@playwright/test';

async function openGame(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__GAME_DEBUG__), null, { timeout: 30_000 });
}

test.describe('settings screen', () => {
  test('opens from the main menu and the pause menu, and closes with Escape', async ({ page }) => {
    await openGame(page);
    await page.getByTestId('menu-settings').click();
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await Promise.all(
      ['audio', 'controls', 'graphics', 'gameplay'].map((section) =>
        expect(page.getByTestId(`settings-section-${section}`)).toBeVisible(),
      ),
    );
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-modal')).toBeHidden();
    await expect(page.getByTestId('main-menu')).toBeVisible();

    await page.getByTestId('menu-creative').click();
    await page.getByTestId('menu-open').click();
    await page.getByTestId('menu-settings').click();
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await page.getByTestId('settings-close').click();
    await expect(page.getByTestId('settings-modal')).toBeHidden();
  });

  test('changes apply live, persist across a reload, and reset restores defaults', async ({ page }) => {
    await openGame(page);
    await page.getByTestId('menu-settings').click();
    await page.getByTestId('settings-sfx-volume').fill('40');
    await page.getByTestId('settings-look-sensitivity').fill('150');
    await page.getByTestId('settings-invert-look').click();
    await page.getByTestId('settings-quality-low').click();
    await page.getByTestId('settings-hp-bars').click();
    await page.getByTestId('settings-mute').click();
    await expect(page.getByTestId('settings-quality-low')).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await page.waitForFunction(() => Boolean(window.__GAME_DEBUG__), null, { timeout: 30_000 });
    await page.getByTestId('menu-settings').click();
    await expect(page.getByTestId('settings-sfx-volume')).toHaveValue('40');
    await expect(page.getByTestId('settings-look-sensitivity')).toHaveValue('150');
    await expect(page.getByTestId('settings-invert-look')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('settings-quality-low')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('settings-hp-bars')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('settings-mute')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('settings-reset').click();
    await expect(page.getByTestId('settings-sfx-volume')).toHaveValue('100');
    await expect(page.getByTestId('settings-look-sensitivity')).toHaveValue('100');
    await expect(page.getByTestId('settings-invert-look')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('settings-quality-high')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('settings-hp-bars')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('settings-mute')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('settings-music-volume')).toHaveValue('60');
  });

  test('the health bar setting hides HP in Survival mode', async ({ page }) => {
    await openGame(page);
    await page.getByTestId('menu-settings').click();
    await page.getByTestId('settings-hp-bars').click();
    await page.getByTestId('settings-close').click();
    await page.getByTestId('menu-survival').click();
    await expect(page.getByTestId('player-hp')).toBeVisible();
    await expect(page.getByTestId('player-hp')).not.toContainText('HP');

    await page.getByTestId('menu-open').click();
    await page.getByTestId('menu-settings').click();
    await page.getByTestId('settings-hp-bars').click();
    await page.getByTestId('settings-close').click();
    await expect(page.getByTestId('player-hp')).toContainText('HP');
  });

  test('works in 2P split-screen and Village modes', async ({ page }) => {
    await openGame(page);
    await page.getByTestId('mp-split').click();
    await page.getByTestId('menu-village').click();
    await page.getByTestId('menu-open').click();
    await page.getByTestId('menu-settings').click();
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await page.getByTestId('settings-hp-bars').click();
    await page.getByTestId('settings-close').click();
    await page.getByTestId('menu-resume').click();
    await expect(page.getByTestId('p2-hp')).toBeVisible();
    await expect(page.getByTestId('p2-hp')).not.toContainText('HP');
  });
});
