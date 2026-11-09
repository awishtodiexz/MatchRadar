import { test, expect } from '@playwright/test';
import raw from '../../tests/fixtures/summary-brighton-full.json' with {type:'json'};
import { installBridge } from './bridge';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';
import type { MatchSummary } from '../../src/useMatchSummary';
import type { Match } from '../../src/types';

const sides=raw.summary.header.competitions[0].competitors;
const home=sides.find(side=>side.homeAway==='home')!,away=sides.find(side=>side.homeAway==='away')!;
const team=(side:typeof home)=>({id:side.team.id,name:side.team.displayName,short:side.team.abbreviation});
const match:Match={id:'401879244',league:'premierLeague',competition:'Premier League',kickoff:raw.summary.header.competitions[0].date,status:'fulltime',detail:'Full-time',home:team(home),away:team(away),homeScore:2,awayScore:0};
const summary:MatchSummary={matchId:match.id,venue:raw.summary.gameInfo.venue.fullName,venueCity:raw.summary.gameInfo.venue.address.city,attendance:raw.summary.gameInfo.attendance,updatedAt:'2026-11-08T17:00:00Z',stale:false,error:null,players:[],
 events:raw.summary.keyEvents.filter(event=>event.text).map(event=>({id:event.id,minute:event.clock.displayValue,period:event.period.number,seconds:event.clock.value,kind:event.type.type,text:event.text??'',teamId:event.team?.id??null,participants:(event.participants??[]).map(person=>person.athlete.displayName)})),
 statistics:raw.summary.boxscore.teams.flatMap(side=>side.statistics.map(stat=>({teamId:side.team.id,name:stat.name,label:stat.label,value:stat.displayValue}))),
};
// Add representative richer fields from the captured match-specific totals.
for(const [index,totals] of raw.teamStatistics.entries()) {
 for(const group of totals.splits.categories) for(const stat of group.stats) {
  if(['expectedGoals','bigChanceCreated','attemptsIbox','duelsWon','ballRecovery','ppda','goalsPrevented'].includes(stat.name)) summary.statistics.push({teamId:index===0?home.team.id:away.team.id,name:stat.name,label:stat.displayName,value:stat.displayValue});
 }
}
const commentary=raw.summary.commentary.flatMap(entry=>{
 if(!entry.play||!entry.time.displayValue||summary.events.some(event=>event.id===entry.play?.id)) return [];
 return [{id:`c-${entry.sequence}`,minute:entry.time.displayValue,period:entry.play.period.number,seconds:entry.time.value,kind:entry.play.type.type,text:entry.text,teamId:entry.play.team?.displayName===home.team.displayName?home.team.id:entry.play.team?.displayName===away.team.displayName?away.team.id:null,participants:(entry.play.participants??[]).map(person=>person.athlete.displayName)}];
});
summary.events.push(...commentary);

for(const [width,theme] of [[320,'light'],[390,'dark']] as const) test(`comprehensive match details ${width} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:760});await page.route('https://**/*',route=>route.abort());
 await installBridge(page,{snapshot:{...mockSnapshot,matches:[match],settings:{...mockSnapshot.settings,theme}},summary});await page.goto('/');
 await page.getByRole('button',{name:'Match details: Brighton & Hove Albion versus Brentford'}).click();
 await expect(page.locator('.overview-intro')).toHaveCount(0);
 await expect(page.locator('.match-events .summary-icon[aria-label="Substitution"]')).toHaveCount(10);
 await expect(page.locator('.incident-score').last()).toHaveText('2–0');
 await page.screenshot({path:info.outputPath('overview-incidents.png')});
 await page.getByRole('heading',{name:'Match information'}).scrollIntoViewIfNeeded();
 await expect(page.getByText('American Express Stadium (Falmer)',{exact:true})).toBeVisible();
 await expect(page.getByText('31,629',{exact:true})).toBeVisible();
 await expect(page.getByText('Not provided',{exact:true})).toHaveCount(2);
 await page.screenshot({path:info.outputPath('match-information.png')});
 await page.getByRole('tab',{name:'Stats',exact:true}).click();
 await expect(page.getByRole('row',{name:/Expected goals \(xG\)/})).toContainText('2.20');
 await expect(page.getByRole('row',{name:/Expected goals \(xG\)/})).toContainText('0.73');
 await page.screenshot({path:info.outputPath('statistics.png')});
 await page.getByRole('combobox',{name:'Statistic group'}).selectOption('Defending');
 await expect(page.getByRole('row',{name:/Ball recoveries/})).toContainText('40');
 await expect(page.getByRole('row',{name:/Expected goals/})).toHaveCount(0);
 await page.getByRole('tab',{name:'Commentary',exact:true}).click();
 await page.getByRole('combobox',{name:'Commentary event type'}).selectOption('substitutions');
 await expect(page.locator('.commentary .event')).toHaveCount(10);
 await page.getByRole('combobox',{name:'Commentary order'}).selectOption('oldest');
 const oldest=await page.locator('.commentary .event time').first().textContent();
 await page.getByRole('combobox',{name:'Commentary order'}).selectOption('newest');
 expect(await page.locator('.commentary .event time').first().textContent()).not.toBe(oldest);
 await page.getByRole('combobox',{name:'Commentary event type'}).selectOption('shots');
 expect(await page.locator('.commentary .event').count()).toBeGreaterThan(10);
 await page.getByRole('button',{name:'All',exact:true}).click();
 expect(await page.locator('.commentary .event').count()).toBeGreaterThan(80);
 expect(await page.locator('.detail-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('commentary.png')});
});
