import { test, expect } from '@playwright/test';
import { installBridge } from './bridge';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';

// Windows users on a 12-hour locale get "7:45 PM" in the narrow kickoff
// column. Keep it on one readable line instead of wrapping into two.
test.use({locale:'en-US'});

test('12-hour kickoff times stay on one line at 320px', async ({ page }) => {
  const match = {
    ...mockSnapshot.matches[0],
    status:'scheduled' as const,
    detail:'Scheduled',
    homeScore:null,
    awayScore:null,
    kickoff:'2026-10-29T19:45:00Z'
  };
  await page.setViewportSize({width:320,height:460});
  await page.clock.install({time:new Date('2026-10-29T12:00:00Z')});
  await page.route('https://**/*', route => route.abort());
  await installBridge(page, {snapshot:{...mockSnapshot, matches:[match]}});
  await page.goto('/');
  const time = page.locator('.fixture-time > span').first();
  await expect(time).toHaveText('7:45 PM');
  const geometry = await time.evaluate(el => ({
    rects: el.getClientRects().length,
    height: el.getBoundingClientRect().height,
    lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight)
  }));
  expect(geometry.rects).toBe(1);
  expect(geometry.height).toBeLessThanOrEqual(geometry.lineHeight + 1);
  expect(await page.locator('.match-list').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({path:'verification/artifacts/final/review/time-format-320.png', animations:'disabled'});
});
