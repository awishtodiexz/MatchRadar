import { test, expect } from '@playwright/test';

import { installBridge } from './bridge';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T12:00:00Z') });
  await page.route('https://**/*', route => route.abort());
  await installBridge(page);
  await page.goto('/');
  await expect(page.getByRole('button',{name:/Match details:.*Arsenal.*Chelsea/})).toBeVisible();
});

test('explores filters, bells, search and details', async ({ page }) => {
  for (const name of ['All','Live','Upcoming','Results']) {
    await page.getByRole('button',{name,exact:true}).click();
    await expect(page.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByRole('button',{name:/^Match details:/}).first()).toBeVisible();
  }
  await page.getByRole('button',{name:'All',exact:true}).click();
  await page.getByRole('button',{name:/Match alerts: Arsenal versus Chelsea/}).click();
  await expect(page.getByRole('button',{name:'Team default',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'On',exact:true}).click();
  await expect(page.getByRole('button',{name:'On',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Muted',exact:true}).click();
  await expect(page.getByRole('button',{name:'Muted',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:/Match details:.*Arsenal.*Chelsea/}).click();
  await page.getByRole('button',{name:/^Match alerts: /}).click();
  await page.getByRole('button',{name:'Team default',exact:true}).click();
  await page.keyboard.press('Escape');
  for (const name of ['Overview','Commentary','Stats','Lineups']) {
    await page.getByRole('tab',{name,exact:true}).click();
    await expect(page.getByRole('tabpanel',{name})).toBeVisible();
  }
  const longName=page.getByText('Jordan Alexander West-Northumberland',{exact:true});
  await longName.scrollIntoViewIfNeeded();
  await expect(longName).toBeVisible();
  await page.getByRole('tab',{name:'Lineups'}).press('Home');
  await expect(page.getByRole('tab',{name:'Overview'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:/Match details:.*Arsenal.*Chelsea/})).toBeFocused();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search clubs'}).fill('no club matches this');
  await expect(page.getByText(/No clubs match/)).toBeVisible();
  await page.getByRole('searchbox',{name:'Search clubs'}).press('Escape');
  await expect(page.getByRole('searchbox',{name:'Search clubs'})).toHaveValue('');
  await expect(page.getByRole('searchbox',{name:'Search clubs'})).toBeFocused();
  await expect(page.getByRole('button',{name:'Arsenal',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Teams'}).press('End');
  await expect(page.getByRole('tab',{name:'App',exact:true})).toBeFocused();
  await expect(page.getByRole('region',{name:'Demo controls'})).toHaveCount(0);
  await page.getByRole('button',{name:'Back to matches'}).click();
  await page.getByRole('button',{name:'Upcoming',exact:true}).click();
  await page.getByRole('button',{name:/Match details:.*Manchester City.*Manchester United/}).click();
  await expect(page.getByText('Lineups and live coverage appear closer to kick-off.')).toBeVisible();
  await page.getByRole('tab',{name:'Stats'}).click();
  await expect(page.getByRole('tabpanel',{name:'Stats'})).toBeVisible();
});

test('following-only empty state explains the filter and offers recovery', async ({ page }) => {
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  for(const club of ['Arsenal','Chelsea','Liverpool','Manchester City','Manchester United','Tottenham Hotspur']) {
    const button=page.getByRole('button',{name:club,exact:true});
    await expect(button).toHaveAttribute('aria-pressed','true');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed','false');
  }
  await page.getByRole('button',{name:'Back to matches'}).click();
  await page.getByRole('button',{name:'Following only',exact:true}).click();
  await expect(page.getByRole('heading',{name:'No matches involving followed clubs'})).toBeVisible();
  await page.getByRole('button',{name:'Show all matches'}).click();
  await expect(page.getByRole('button',{name:/Match details:.*Arsenal.*Chelsea/})).toBeVisible();
  await expect(page.getByRole('button',{name:'All',exact:true})).toHaveAttribute('aria-pressed','true');
});

for (const width of [320,390]) for (const theme of ['dark','light']) for (const compact of [false,true]) {
  test(`visual ${width} ${theme} compact ${compact}`, async ({ page }, info) => {
    await page.setViewportSize({width,height:compact?460:700});
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('tab',{name:'Appearance'}).click();
    await page.getByRole('combobox',{name:'Theme'}).selectOption(theme);
    if(compact) await page.getByText('Compact layout',{exact:true}).click();
    for(const opacity of [70,100]) {
      const slider=page.getByRole('slider',{name:'Panel opacity'});await slider.focus();await slider.press(opacity===70?'Home':'End');
      await expect(slider).toHaveValue(String(opacity));
      for(const section of ['Teams','Appearance','Alerts','App']) {
        await page.getByRole('tab',{name:section,exact:true}).click();
        expect(await page.locator('.settings-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
        await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeInViewport();
      }
      const refresh=page.getByRole('button',{name:'Refresh data'});
      await refresh.scrollIntoViewIfNeeded(); await expect(refresh).toBeInViewport();
      await page.screenshot({path:info.outputPath(`${width}-${theme}-${compact}-${opacity}-settings.png`),animations:'disabled'});
      await page.getByRole('button',{name:/^Back to match/}).click();
      if(await page.getByRole('heading',{name:'Match details',exact:true}).isVisible())await page.getByRole('button',{name:'Back to matches',exact:true}).click();
      await page.screenshot({path:info.outputPath(`${width}-${theme}-${compact}-${opacity}-home.png`),animations:'disabled'});
      await page.getByRole('button',{name:/Match details:.*Arsenal.*Chelsea/}).click();
      for(const section of ['Commentary','Stats','Lineups']) {
        await page.getByRole('tab',{name:section,exact:true}).click();
        expect(await page.locator('.detail-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
        await page.screenshot({path:info.outputPath(`${width}-${theme}-${compact}-${opacity}-${section}.png`),animations:'disabled'});
        if(section==='Lineups') {
          const longName=page.getByText('Jordan Alexander West-Northumberland',{exact:true});
          await longName.scrollIntoViewIfNeeded();
          await expect(longName).toBeInViewport();
          expect(await page.locator('.detail-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
        }
      }
      await page.getByRole('button',{name:'Settings',exact:true}).click();
      await page.getByRole('tab',{name:'Appearance'}).click();
    }
  });
}
