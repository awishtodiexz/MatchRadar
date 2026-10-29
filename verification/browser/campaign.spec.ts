import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T12:00:00Z') });
  await page.route('https://**/*', route => route.abort());
  await page.goto('/');
  await expect(page.getByText('DEMO DATA', { exact:true })).toBeVisible();
});

test('explores filters, bells, search, simulation and details', async ({ page }) => {
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
  await expect(page.getByRole('button',{name:'Arsenal',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Teams'}).press('End');
  await expect(page.getByRole('tab',{name:'App',exact:true})).toBeFocused();
  const controls=page.getByRole('region',{name:'Demo controls'});
  for (const stage of ['First half','Half-time','Second half','Full-time']) {
    await page.getByRole('button',{name:'Advance match'}).click();
    await expect(controls).toContainText(stage);
  }
  await expect(page.getByRole('button',{name:'Advance match'})).toBeDisabled();
  await page.getByRole('button',{name:'Back to matches'}).click();
  await page.getByRole('button',{name:'Results',exact:true}).click();
  await page.getByRole('button',{name:'Match details: Manchester City versus Manchester United'}).click();
  await expect(page.locator('.detail-score')).toContainText('2 : 1');
  await page.getByRole('tab',{name:'Timeline'}).click();
  await expect(page.getByText(/scores a penalty/)).toBeVisible();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:'App',exact:true}).click();
  await page.getByRole('button',{name:'Reset demo'}).click();
  await expect(controls).toContainText('Scheduled');
  await page.getByRole('button',{name:'Back to matches'}).click();
  await page.getByRole('button',{name:'Upcoming',exact:true}).click();
  await page.getByRole('button',{name:'Match details: Manchester City versus Manchester United'}).click();
  await expect(page.getByText('No event timeline is available for this match.')).toBeVisible();
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
      const advance=page.getByRole('button',{name:'Advance match'});
      await advance.scrollIntoViewIfNeeded(); await expect(advance).toBeInViewport();
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
