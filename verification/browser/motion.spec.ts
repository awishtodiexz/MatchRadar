import { test, expect } from '@playwright/test';
import { installBridge } from './bridge';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';

// The gate pins reducedMotion: 'reduce' globally, so this spec emulates the OS
// preference explicitly in both directions and proves the in-app Reduce motion
// setting honours the same contract.
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.route('https://**/*', (route) => route.abort());
});

const changedSnapshot = () => {
  const snapshot = structuredClone(mockSnapshot);
  snapshot.updatedAt = '2026-10-28T12:01:00Z';
  snapshot.matches = snapshot.matches.map((match) =>
    match.status === 'live' ? { ...match, homeScore: (match.homeScore ?? 0) + 1 } : match,
  );
  return snapshot;
};

const pushSnapshot = (page: import('@playwright/test').Page, snapshot: unknown) =>
  page.evaluate((value) => window.dispatchEvent(new CustomEvent('test:set-snapshot', { detail: value })), snapshot);

test('the score flash animates only while the OS preference allows motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await installBridge(page);
  await page.goto('/');
  await pushSnapshot(page, changedSnapshot());
  const card = page.locator('.match-card.score-changed').first();
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS('animation-name', 'score-flash');
  // The media-query blanket rule must cut the same animation when the OS asks.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(card).toHaveCSS('animation-name', 'none');
});

test('the in-app Reduce motion setting stops the same animation', async ({ page }) => {
  const inApp = structuredClone(mockSnapshot);
  inApp.settings = { ...inApp.settings, reducedMotion: true };
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await installBridge(page, { snapshot: inApp });
  await page.goto('/');
  await expect(page.locator('.shell.reduced')).toHaveCount(1);
  // A pushed snapshot's settings replace the confirmed ones, so the fixture
  // must carry the flag it is testing.
  await pushSnapshot(page, { ...changedSnapshot(), settings: inApp.settings });
  const card = page.locator('.match-card.score-changed').first();
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS('animation-name', 'none');
});
