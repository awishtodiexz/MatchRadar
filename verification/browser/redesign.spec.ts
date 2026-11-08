import { test, expect } from '@playwright/test';
import { installBridge } from './bridge';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';
import type { MatchSummary } from '../../src/useMatchSummary';

const match = mockSnapshot.matches[0];
const squad = (teamId:string) => Array.from({length:11},(_,i)=>({teamId,name:`Test Player ${i+1}`,position:i===0?'GK':i<5?'CB':i<8?'CM':'FW',starter:true,jersey:String(i+1),formationPlace:i+1}));
const summary:MatchSummary = {
  matchId:match.id,updatedAt:'2026-11-08T15:00:00Z',stale:false,error:null,venue:'Test Stadium',attendance:54000,
  events:Array.from({length:18},(_,i)=>({id:`event-${i}`,minute:`${i*4}'`,period:i<11?1:2,seconds:i*240,kind:i%3===0?'goal':i%3===1?'yellow-card':'substitution',text:`Provider event ${i+1}: a long match description that must remain readable inside a narrow widget.`,teamId:i%2?match.away.id:match.home.id})),
  players:[...squad(match.home.id),...squad(match.away.id)],formations:{[match.home.id]:'4-3-3',[match.away.id]:'4-3-3'},
  statistics:[['possessionPct','Possession','0.6','0.4'],['totalShots','Shots','12','3'],['shotsOnTarget','On target','6','2'],['yellowCards','Yellow cards','1','3']].flatMap(([name,label,home,away])=>[{teamId:match.home.id,name,label,value:home},{teamId:match.away.id,name,label,value:away}]),
};

for(const width of [320,390]) for(const theme of ['dark','light'] as const) {
  test(`unified match layout ${width} ${theme}`,async({page},info)=>{
    await page.setViewportSize({width,height:700});
    await page.route('https://**/*',route=>route.abort());
    await installBridge(page,{snapshot:{...mockSnapshot,settings:{...mockSnapshot.settings,theme}},summary});
    await page.goto('/');
    await page.screenshot({path:info.outputPath('fixtures.png')});
    await page.getByRole('button',{name:'Match details: Arsenal versus Chelsea'}).click();
    await expect(page.locator('.overview-intro')).toHaveCount(0);
    await expect(page.locator('.match-events .event')).toHaveCount(18);
    await expect(page.getByLabel('Match snapshot')).toHaveCount(0);
    await expect(page.getByRole('button',{name:/Full statistics|Match commentary/})).toHaveCount(0);
    expect(await page.locator('.detail-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('summary.png')});
    for(const tab of ['Stats','Lineups','Commentary']) {
      await page.getByRole('tab',{name:tab,exact:true}).click();
      expect(await page.locator('.detail-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      if(tab==='Stats') {
        await expect(page.getByRole('row',{name:/Possession/})).toContainText('60%');
        await expect(page.getByRole('row',{name:/Possession/})).toContainText('40%');
      }
      if(tab==='Lineups') {
        await expect(page.locator('.pitch-shirt')).toHaveCount(11);
        await page.getByRole('tab',{name:/Chelsea/}).click();
        await expect(page.locator('.pitch-player').first()).toHaveAttribute('title',/Chelsea/);
        await expect(page.locator('.pitch-shirt')).toHaveCount(11);
      }
      if(tab==='Commentary') await expect(page.locator('.event-list li').first()).toContainText('Provider event 18');
      await page.screenshot({path:info.outputPath(tab.toLowerCase()+'.png')});
    }
    await page.locator('.detail-body').evaluate(el=>{el.scrollTop=260;});
    await expect(page.locator('.mini-score')).toBeVisible();
    const tabs = page.getByRole('tablist',{name:'Match centre sections'});
    await expect(tabs).toBeInViewport();
    const top = await tabs.boundingBox();
    expect(top?.y).toBeLessThan(110);
    await page.screenshot({path:info.outputPath('collapsed.png')});
    await page.getByRole('tab',{name:'Overview',exact:true}).click();
    await expect(page.locator('.mini-score')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'Match details: Arsenal versus Chelsea'})).toBeFocused();
  });
}
