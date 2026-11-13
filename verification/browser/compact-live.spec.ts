import { test, expect } from '@playwright/test';
import raw from '../../tests/fixtures/summary-live-compact.json' with {type:'json'};
import { mockSnapshot } from '../../src/test-fixtures/fixtures';
import { installBridge } from './bridge';
import type { Match } from '../../src/types';
import type { MatchSummary } from '../../src/useMatchSummary';

const match:Match = {...mockSnapshot.matches[0],id:'401879244',home:{id:'331',name:'Brighton & Hove Albion',short:'BHA'},away:{id:'337',name:'Brentford',short:'BRE'},homeScore:2,awayScore:0};
const summary:MatchSummary = {
 matchId:match.id,venue:null,updatedAt:'2026-11-08T15:00:00Z',stale:false,error:null,statistics:[],coaches:[],
 events:raw.keyEvents.filter(e=>e.text).map(e=>({id:e.id,minute:e.clock.displayValue,period:e.period.number,seconds:e.clock.value,kind:e.type.type,text:e.text??'',teamId:e.team?.id??null,participants:(e.participants??[]).map(p=>p.athlete.displayName),shortText:e.shortText})),
 formations:Object.fromEntries(raw.rosters.map(t=>[t.team.id,t.formation])),
 players:raw.rosters.flatMap(t=>t.roster.map(p=>({teamId:t.team.id,name:p.athlete.displayName,position:p.position?.abbreviation??'',jersey:p.jersey,starter:p.starter,formationPlace:Number(p.formationPlace)||undefined,headshot:p.athlete.headshot?.href}))),
 substitutions:[{teamId:match.home.id,playerIn:'Test substitute',playerOut:'Charalambos Kostoulas',minute:"83'"}],
};
for(const width of [320,390]) for(const theme of ['dark','light'] as const) test(`compact real ESPN summary ${width} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:700});
 await page.route('https://**/*',route=>route.abort());
 await installBridge(page,{snapshot:{...mockSnapshot,settings:{...mockSnapshot.settings,theme},matches:[match]},summary});
 await page.goto('/');
 await page.getByRole('button',{name:/Match details:.*Brighton & Hove Albion.*Brentford/}).click();
 await expect(page.locator('.match-events .event')).toHaveCount(15);
 await expect(page.locator('.match-events').getByText('Diego G\u00f3mez',{exact:false})).toBeVisible();
 expect(await page.locator('.detail-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await expect(page.locator('.match-events').getByText('Pascal Gross',{exact:false})).toBeVisible();
 await expect(page.locator('.match-events .incident-score').last()).toHaveText('2\u20130');
 for(const row of await page.locator('.match-events .event').all()) expect((await row.boundingBox())?.height).toBeLessThanOrEqual(54);
 await page.screenshot({path:info.outputPath('summary.png')});
 await page.getByRole('tab',{name:'Lineups',exact:true}).click();
 await expect(page.locator('.detail-hero')).toBeHidden();
 await expect(page.locator('.mini-score')).toBeVisible();
 await expect(page.getByRole('button',{name:'Refresh match details'})).toBeVisible();
 await expect(page.locator('.lineup-help')).not.toHaveAttribute('open');
 await expect(page.locator('.badge-off')).toHaveText("83'");
 const marker=await page.locator('.badge-off').boundingBox();
 const shirt=await page.locator('.pitch-shirt').first().boundingBox();
 const playerName=await page.locator('.pitch-name').first().boundingBox();
 expect(marker&&shirt&&playerName&&marker.y>=shirt.y+shirt.height&&marker.y+marker.height<=playerName.y).toBe(true);
 await expect(page.locator('.coach-row')).toHaveCount(0);
 await expect(page.locator('.pitch-shirt')).toHaveCount(11);
 await expect(page.locator('.pitch-row').first()).toContainText('Kostoulas');
 await expect(page.locator('.pitch-player img')).toHaveCount(0);
 await expect.poll(async()=>{
   const pitch=await page.locator('.lineup-pitch').boundingBox();
   const body=await page.locator('.detail-body').boundingBox();
   return !!pitch&&!!body&&pitch.y>=body.y&&pitch.y+pitch.height<=body.y+body.height;
 }).toBe(true);
 expect(await page.locator('.detail-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.locator('.pitch-player').first().focus();
 await expect(page.locator('.pitch-inspection')).toContainText('Kostoulas');
 await page.keyboard.press('Escape');
 await expect(page.locator('.pitch-inspection')).toHaveCount(0);
 await expect(page.locator('.lineup-roster')).not.toHaveAttribute('open');
 await page.screenshot({path:info.outputPath('lineups.png')});
 await page.locator('.lineup-roster summary').click();
 await expect(page.locator('.lineup-roster .lineup-list li')).toHaveCount(11);
 await page.locator('.detail-body').evaluate(el=>{el.scrollTop=el.scrollHeight;});
 const sectionTabs=await page.locator('.centre-tabs').boundingBox();
 const teamTabs=await page.locator('.lineup-tabs').boundingBox();
 expect(sectionTabs).not.toBeNull();
 expect(teamTabs).not.toBeNull();
 if(sectionTabs&&teamTabs)expect(teamTabs.y).toBeGreaterThanOrEqual(sectionTabs.y+sectionTabs.height-1);
 await page.getByRole('tab',{name:/Brentford/}).click();
 await expect(page.getByRole('group',{name:'Brentford starting XI at kickoff'})).toBeInViewport({ratio:1});
 await expect(page.locator('.lineup-roster')).not.toHaveAttribute('open');
 await expect(page.locator('.pitch-inspection')).toHaveCount(0);
 await page.locator('.detail-body').evaluate(el=>{el.scrollTop=el.scrollHeight;});
 await page.getByRole('tab',{name:/Brentford/}).press('ArrowLeft');
 await expect(page.getByRole('group',{name:'Brighton & Hove Albion starting XI at kickoff'})).toBeInViewport({ratio:1});
 await page.getByRole('tab',{name:'Overview',exact:true}).click();
 await expect(page.locator('.detail-hero')).toBeVisible();
 await expect(page.locator('.mini-score')).toHaveCount(0);
});
