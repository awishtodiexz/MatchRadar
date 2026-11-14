import { test, expect } from '@playwright/test';
import { installBridge } from './bridge';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';
import type { MatchSummary } from '../../src/useMatchSummary';

const match=mockSnapshot.matches[0];
const summary:MatchSummary={
  matchId:match.id,updatedAt:'2026-11-14T12:00:00Z',stale:false,error:null,venue:'Test Stadium',
  events:Array.from({length:60},(_,index)=>({id:`event-${index}`,minute:`${index+1}'`,period:index<30?1:2,seconds:(index+1)*60,kind:index%3===0?'goal':'commentary',text:`Match event ${index+1}`,teamId:match.home.id})),
  statistics:[],
  players:[match.home,match.away].flatMap(team=>Array.from({length:18},(_,index)=>({teamId:team.id,name:`${team.short} player ${index+1}`,position:index===0?'GK':'FW',starter:index<11,jersey:String(index+1)})))
};

test.beforeEach(async({page})=>{
  await page.setViewportSize({width:320,height:460});
  await page.clock.install({time:new Date('2026-11-14T12:00:00Z')});
  await page.route('https://**/*',route=>route.abort());
});

test('commentary keeps its filter, order, and scroll through Settings, ticker mode, and reopening',async({page})=>{
  await installBridge(page,{summary});await page.goto('/');
  const card=page.getByRole('button',{name:/Match details:.*Arsenal.*Chelsea/});
  await expect(card).toBeVisible();
  await page.screenshot({path:'verification/artifacts/qol1-home.png',animations:'disabled'});
  await card.click();
  await page.getByRole('tab',{name:'Commentary',exact:true}).click();
  await page.getByRole('combobox',{name:'Commentary event type'}).selectOption('goals');
  await page.getByRole('combobox',{name:'Commentary order'}).selectOption('oldest');
  const body=page.locator('.detail-body');
  await body.evaluate(element=>{element.scrollTop=500;});
  await expect(body).toHaveJSProperty('scrollTop',500);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('test:emit',{detail:{event:'open-settings',payload:null}})));
  await page.getByRole('button',{name:'Back to match',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Commentary',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('combobox',{name:'Commentary event type'})).toHaveValue('goals');
  await expect(page.getByRole('combobox',{name:'Commentary order'})).toHaveValue('oldest');
  await expect(body).toHaveJSProperty('scrollTop',500);
  await page.getByRole('button',{name:'Ticker mode'}).click();
  await page.setViewportSize({width:320,height:112});
  await expect(page.getByRole('region',{name:'Match ticker'})).toBeVisible();
  await page.getByTitle('Open this match in MatchRadar').click();
  await page.setViewportSize({width:320,height:460});
  await expect(page.getByRole('tab',{name:'Commentary',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('tab',{name:'Commentary',exact:true})).toBeFocused();
  await expect(body).toHaveJSProperty('scrollTop',500);
  await page.getByRole('button',{name:'Back to matches',exact:true}).click();
  await expect(card).toBeFocused();
  await card.click();
  await expect(page.getByRole('combobox',{name:'Commentary event type'})).toHaveValue('goals');
  await expect(page.getByRole('combobox',{name:'Commentary order'})).toHaveValue('oldest');
  await expect(body).toHaveJSProperty('scrollTop',500);
  await body.evaluate(element=>{element.scrollTop=200;});
  await page.screenshot({path:'verification/artifacts/qol1-restored-commentary.png',animations:'disabled'});
});

test('lineup team and scroll survive changing sections and reopening the match',async({page})=>{
  await installBridge(page,{summary});await page.goto('/');
  const card=page.getByRole('button',{name:/Match details:.*Arsenal.*Chelsea/});
  await card.click();
  await page.getByRole('tab',{name:'Lineups',exact:true}).click();
  const away=page.getByRole('tab',{name:/Chelsea/});
  await away.click();
  await expect(page.locator('.detail-hero')).toBeHidden();
  const body=page.locator('.detail-body');
  await body.evaluate(element=>{element.scrollTop=220;});
  await expect(body).toHaveJSProperty('scrollTop',220);
  await page.getByRole('tab',{name:'Commentary',exact:true}).click();
  await page.getByRole('tab',{name:'Lineups',exact:true}).click();
  await expect(away).toHaveAttribute('aria-selected','true');
  await expect(body).toHaveJSProperty('scrollTop',220);
  await page.getByRole('button',{name:'Back to matches',exact:true}).click();
  await card.click();
  await expect(page.getByRole('tab',{name:'Lineups',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(away).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.detail-hero')).toBeHidden();
  await expect(body).toHaveJSProperty('scrollTop',220);
});

test('each match keeps its own section while a notification explicitly returns to Overview',async({page})=>{
  await installBridge(page,{summary});await page.goto('/');
  const first=page.getByRole('button',{name:/Match details:.*Arsenal.*Chelsea/});
  await first.click();
  await page.getByRole('tab',{name:'Stats',exact:true}).click();
  await page.getByRole('button',{name:'Back to matches',exact:true}).click();
  await page.getByRole('button',{name:/Match details:.*Liverpool.*Newcastle/}).click();
  await expect(page.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'Back to matches',exact:true}).click();
  await first.click();
  await expect(page.getByRole('tab',{name:'Stats',exact:true})).toHaveAttribute('aria-selected','true');
  await page.evaluate(id=>window.dispatchEvent(new CustomEvent('test:notification-click',{detail:id})),match.id);
  await expect(page.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');
});

test('expanded statistics and their category survive leaving the section and reopening',async({page})=>{
  const statistics=[{teamId:match.home.id,name:'totalShots',label:'Shots',value:'12'},...Array.from({length:24},(_,index)=>({teamId:match.home.id,name:`custom-${index}`,label:`Provider metric ${index+1}`,value:String(index)}))];
  await installBridge(page,{summary:{...summary,statistics}});await page.goto('/');
  const card=page.getByRole('button',{name:/Match details:.*Arsenal.*Chelsea/});
  await card.click();
  await page.getByRole('tab',{name:'Stats',exact:true}).click();
  await page.getByRole('button',{name:'Show all 25 statistics',exact:true}).click();
  const body=page.locator('.detail-body');
  await body.evaluate(element=>{element.scrollTop=400;});
  await expect(body).toHaveJSProperty('scrollTop',400);
  await page.getByRole('tab',{name:'Commentary',exact:true}).click();
  await page.getByRole('tab',{name:'Stats',exact:true}).click();
  await expect(page.getByRole('button',{name:'Show key statistics',exact:true})).toHaveAttribute('aria-expanded','true');
  await expect(body).toHaveJSProperty('scrollTop',400);
  await page.getByRole('combobox',{name:'Statistic group'}).selectOption('Other');
  await page.getByRole('button',{name:'Back to matches',exact:true}).click();
  await card.click();
  await expect(page.getByRole('tab',{name:'Stats',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('combobox',{name:'Statistic group'})).toHaveValue('Other');
  await expect(page.getByRole('row',{name:/Provider metric 24/})).toHaveCount(1);
});

test('unconfirmed kickoff changes from Starting soon to Awaiting update after the grace period',async({page})=>{
  const scheduled={...mockSnapshot.matches[2],kickoff:'2026-11-14T12:00:00Z'};
  await installBridge(page,{snapshot:{...mockSnapshot,matches:[scheduled]}});await page.goto('/');
  await expect(page.getByText('Soon',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/Match details:/}).click();
  await expect(page.getByText('Starting soon',{exact:true})).toBeVisible();
  await page.clock.fastForward(6*60_000);
  await expect(page.getByText('Awaiting match update',{exact:true})).toBeVisible();
  await expect(page.getByText('Starting soon',{exact:true})).toHaveCount(0);
  await page.screenshot({path:'verification/artifacts/qol1-awaiting-update.png',animations:'disabled'});
  await page.getByRole('button',{name:'Ticker mode'}).click();
  await expect(page.getByText('Awaiting update',{exact:true})).toBeVisible();
  await page.getByTitle('Open this match in MatchRadar').click();
  await page.getByRole('button',{name:'Back to matches',exact:true}).click();
  await expect(page.getByText('Awaiting update',{exact:true})).toBeVisible();
  await expect(page.getByText('Soon',{exact:true})).toHaveCount(0);
});
