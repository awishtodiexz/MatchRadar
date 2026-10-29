import { test, expect } from '@playwright/test';

import { installBridge } from './bridge';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T12:00:00Z') });
  await page.route('https://**/*', route => route.abort());
  await installBridge(page);
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Match details: Arsenal versus Chelsea'})).toBeVisible();
});

test('explores filters, bells, search and details', async ({ page }) => {
  for (const name of ['All','Live','Following','Upcoming','Results']) {
    await page.getByRole('button',{name,exact:true}).click();
    await expect(page.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByRole('button',{name:/^Match details:/}).first()).toBeVisible();
  }
  await page.getByRole('button',{name:'All',exact:true}).click();
  await page.getByRole('button',{name:/Enable all alerts.*Arsenal versus Chelsea/}).click();
  await expect(page.getByRole('button',{name:/Mute match alerts.*Arsenal versus Chelsea/})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:/Mute match alerts.*Arsenal versus Chelsea/}).click();
  await expect(page.getByRole('button',{name:/Enable all alerts \(match muted\).*Arsenal versus Chelsea/})).toBeVisible();
  await page.getByRole('button',{name:'Match details: Arsenal versus Chelsea'}).click();
  await page.getByRole('button',{name:'Use team settings'}).click();
  for (const name of ['Overview','Timeline','Stats','Lineups']) {
    await page.getByRole('tab',{name,exact:true}).click();
    await expect(page.getByRole('tabpanel',{name})).toBeVisible();
  }
  const longName=page.getByText('Jordan Alexander West-Northumberland',{exact:true});
  await longName.scrollIntoViewIfNeeded();
  await expect(longName).toBeVisible();
  await page.getByRole('tab',{name:'Lineups'}).press('Home');
  await expect(page.getByRole('tab',{name:'Overview'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Match details: Arsenal versus Chelsea'})).toBeFocused();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search clubs'}).fill('no club matches this');
  await expect(page.getByText(/No clubs match/)).toBeVisible();
  await page.getByRole('button',{name:'Clear search'}).click();
  await expect(page.getByRole('searchbox',{name:'Search clubs'})).toBeFocused();
  await expect(page.getByRole('button',{name:'Arsenal',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Teams'}).press('End');
  await expect(page.getByRole('tab',{name:'App',exact:true})).toBeFocused();
  await expect(page.getByRole('region',{name:'Demo controls'})).toHaveCount(0);
  await page.getByRole('button',{name:'Back to matches'}).click();
  await page.getByRole('button',{name:'Upcoming',exact:true}).click();
  await page.getByRole('button',{name:'Match details: Manchester City versus Manchester United'}).click();
  await expect(page.getByText('Match information will appear when available.')).toBeVisible();
  await expect(page.getByRole('tab',{name:'Stats'})).toHaveCount(0);
});

test('following-only empty state explains the filter and offers recovery', async ({ page }) => {
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByText('Following only',{exact:true}).click();
  for(const club of ['Arsenal','Chelsea','Liverpool','Manchester City','Manchester United','Tottenham Hotspur']) {
    const button=page.getByRole('button',{name:club,exact:true});
    await expect(button).toHaveAttribute('aria-pressed','true');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed','false');
  }
  await page.getByRole('button',{name:'Back to matches'}).click();
  await expect(page.getByRole('heading',{name:'No followed-team matches'})).toBeVisible();
  await page.getByRole('button',{name:'Show all matches'}).click();
  await expect(page.getByRole('button',{name:'Match details: Arsenal versus Chelsea'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Following only'})).toHaveAttribute('aria-pressed','false');
});

for (const width of [320,390]) for (const theme of ['dark','light']) for (const compact of [false,true]) {
  test(`visual ${width} ${theme} compact ${compact}`, async ({ page }, info) => {
    await page.setViewportSize({width,height:compact?460:700});
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('tab',{name:'Appearance'}).click();
    await page.getByRole('combobox',{name:'Theme'}).selectOption(theme);
    if(compact) await page.getByText('Compact view',{exact:true}).click();
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
      await page.getByRole('button',{name:'Back to matches'}).click();
      await page.screenshot({path:info.outputPath(`${width}-${theme}-${compact}-${opacity}-home.png`),animations:'disabled'});
      await page.getByRole('button',{name:'Match details: Arsenal versus Chelsea'}).click();
      for(const section of ['Timeline','Stats','Lineups']) {
        await page.getByRole('tab',{name:section,exact:true}).click();
        expect(await page.locator('.detail-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
        await page.screenshot({path:info.outputPath(`${width}-${theme}-${compact}-${opacity}-${section}.png`),animations:'disabled'});
        if(section==='Lineups') {
          const longName=page.getByText('Jordan Alexander West-Northumberland',{exact:true});
          await longName.scrollIntoViewIfNeeded();
          await expect(longName).toBeInViewport();
          expect(await page.locator('.detail-body').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
        }
      }
      await page.getByRole('button',{name:'Settings',exact:true}).click();
      await page.getByRole('tab',{name:'Appearance'}).click();
    }
  });
}
