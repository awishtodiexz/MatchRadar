import { test, expect } from '@playwright/test';
import { installBridge } from './bridge';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';

async function openApp(page: import('@playwright/test').Page, options: Parameters<typeof installBridge>[1] = {}) {
  await page.clock.install({time:new Date('2026-10-29T12:00:00Z')});
  await page.route('https://**/*',route=>route.abort());
  await installBridge(page,options);await page.goto('/');
}

for (const [width,theme,compact] of [[320,'light',true],[390,'dark',false]] as const) {
  test(`details and alerts walkthrough ${width} ${theme}`,async({page},info)=>{
    await page.setViewportSize({width,height:compact?460:700});await openApp(page);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('tab',{name:'Appearance'}).click();
    await page.getByRole('combobox',{name:'Theme'}).selectOption(theme);
    if(compact)await page.getByText('Compact view',{exact:true}).click();
    await page.getByRole('button',{name:'Back to matches'}).click();
    for(const [name,status] of [
      ['Arsenal versus Chelsea','LIVE'],['Liverpool versus Newcastle United','HALF-TIME'],
      ['Manchester City versus Manchester United','SCHEDULED'],['Brighton & Hove Albion versus Everton','FULL-TIME']
    ]) {
      const card=page.getByRole('button',{name:`Match details: ${name}`});
      await card.scrollIntoViewIfNeeded();await card.click();
      await expect(page.getByRole('heading',{name:'Match details'})).toBeFocused();
      await expect(page.locator('.detail-status')).toContainText(status);
      await expect(page.locator('.detail-body')).toBeVisible();
      expect(await page.locator('.detail-body').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
      if(status==='FULL-TIME') {
        await page.getByRole('button',{name:/^Match alerts: /}).click();
        await expect(page.getByText('This match has ended.',{exact:true})).toBeVisible();
        await expect(page.getByRole('button',{name:'Notify me about this match'})).toHaveCount(0);
        await page.getByRole('button',{name:/^Match alerts: /}).click();
      }
      await page.screenshot({path:info.outputPath(`${status.replace(/[^a-z0-9]/gi,'')}.png`),animations:'disabled'});
      await page.keyboard.press('Escape');await expect(card).toBeFocused();
    }
  });
}

test('keyboard bell and details stay synchronized with team preferences',async({page})=>{
  await openApp(page);
  const bell=page.getByRole('button',{name:/Enable all alerts \(using team settings\): Arsenal versus Chelsea/});
  await bell.focus();await page.keyboard.press('Space');
  const enabled=page.getByRole('button',{name:/Mute match alerts \(all alerts on\): Arsenal versus Chelsea/});
  await expect(enabled).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Match details: Arsenal versus Chelsea'}).click();
  await page.getByRole('button',{name:/^Match alerts: /}).click();
  await expect(page.getByText('All alerts on',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Mute this match'}).click();
  await expect(page.getByText('Muted',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Use team settings'}).click();
  await expect(page.getByText('Team settings',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^Match alerts: /}).click();
  await page.keyboard.press('Escape');await expect(bell).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:'Alerts'}).click();
  await expect(page.getByText('The reminder time also applies to match bells.')).toBeVisible();
  await page.getByText('Goals',{exact:true}).click();
  await page.getByRole('button',{name:'Back to matches'}).click();
  await expect(bell).toHaveAttribute('data-alert-state','team');
  await bell.click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:'Alerts'}).click();
  await page.getByRole('button',{name:'Reset match bells to team defaults'}).click();
  await expect(page.getByRole('tabpanel',{name:'Alerts'})).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeFocused();
});

test('toolbar and settings expose consistent status and preferences',async({page})=>{
  await openApp(page);
  await expect(page.getByRole('status').filter({hasText:'SCORES CHECKED'})).toBeVisible();
  const pin=page.getByRole('button',{name:'Always on top'});
  await expect(pin).toHaveAttribute('aria-pressed','true');await expect(pin).toHaveAttribute('title',/unpin/);
  await pin.click();await expect(pin).toHaveAttribute('aria-pressed','false');
  const following=page.getByRole('button',{name:'Following only'});
  await following.click();await expect(following).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Settings'})).toBeFocused();
  await expect(page.getByRole('checkbox',{name:'Following only'})).toBeChecked();
  const teams=page.getByRole('tab',{name:'Teams'});await teams.focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Appearance'})).toBeFocused();
  await expect(page.getByRole('checkbox',{name:'Always on top'})).not.toBeChecked();
  await page.keyboard.press('End');await expect(page.getByRole('tab',{name:'App',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeFocused();
  await expect(following).toHaveAttribute('aria-pressed','true');
});

for(const details of ['pending','error'] as const) {
  test(`summary ${details} state remains usable`,async({page},info)=>{
    await page.setViewportSize({width:320,height:460});
    await openApp(page,{details});
    await page.getByRole('button',{name:'Match details: Arsenal versus Chelsea'}).click();
    await expect(page.getByRole('heading',{name:'Match details'})).toBeFocused();
    if(details==='pending') await expect(page.getByLabel('Loading match details')).toBeVisible();
    else {await expect(page.getByText(/Match details unavailable/)).toBeVisible();await expect(page.getByRole('button',{name:'Retry details'})).toBeVisible();await expect(page.getByText('Match information is unavailable right now.')).toHaveCount(0);}
    await page.getByRole('button',{name:/^Match alerts: /}).click();
    await expect(page.getByRole('button',{name:'Notify me about this match'})).toBeVisible();
    await page.screenshot({path:info.outputPath(`${details}.png`),animations:'disabled'});
    await page.getByRole('button',{name:/^Match alerts: /}).click();
    await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Match details: Arsenal versus Chelsea'})).toBeFocused();
  });
}

test('cached score failures retain cards and expose retry',async({page})=>{
  const snapshot=structuredClone(mockSnapshot);
  snapshot.error='Scoreboard unavailable';snapshot.scoreError='HTTP 503';snapshot.partial=true;
  snapshot.matches=snapshot.matches.map(m=>({...m,scoreStale:m.status==='live'||m.status==='halftime'}));
  await openApp(page,{snapshot});
  await expect(page.getByText('Partial update · some data may be stale')).toBeVisible();
  await expect(page.getByLabel('Premier League: saved scores, awaiting live update')).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Match details: Arsenal versus Chelsea'})).toBeVisible();
});
