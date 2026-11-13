// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MatchOverview } from './MatchOverview';
import { mockSnapshot } from '../test-fixtures/fixtures';
import type { Match } from '../types';
import type { MatchSummary } from '../useMatchSummary';

afterEach(cleanup);
const base=mockSnapshot.matches[0];
const data:MatchSummary={matchId:base.id,updatedAt:'2026-11-08T17:00:00Z',stale:false,error:null,venue:null,events:[],statistics:[],players:[]};
const show=(match:Match,summary:MatchSummary|null=null)=>render(<MatchOverview match={match} data={summary}/>);

it('keeps the duplicated match headline out of Overview in all match states',()=>{
 for(const status of ['live','fulltime','scheduled','unknown'] as const) {
  const {container,unmount}=show({...base,status});
  expect(container.querySelector('.overview-intro')).toBeNull();
  expect(screen.queryByRole('heading',{level:2})).toBeNull();
  expect(screen.getByRole('region',{name:'Match information'})).toBeTruthy();unmount();
 }
});

it('shows structured incidents instead of repeating the scorer list and excludes disallowed goals and goal kicks',()=>{
  const {container}=show(base,{...data,
    scorers:[{teamId:base.home.id,teamName:base.home.name,name:'Bukayo Saka',minute:"23'",penalty:true,ownGoal:false}],
    events:[
      {id:'goal',teamId:base.home.id,minute:'23′',period:1,seconds:1380,kind:'penalty---scored',text:'Provider goal.',participants:['Bukayo Saka']},
      {id:'goal2',teamId:base.home.id,minute:"45+2'",period:1,seconds:2820,kind:'goal---header',text:'Provider header.',participants:['Bukayo Saka']},
      {id:'disallowed',teamId:base.home.id,minute:"60'",period:2,seconds:3600,kind:'goal---disallowed',text:'Disallowed.',participants:['Other Player']},
      {id:'goal-kick',teamId:base.away.id,minute:"61'",period:2,seconds:3660,kind:'goal-kick',text:'Goal kick.',participants:['Keeper']},
    ]});
  expect(container.querySelectorAll('.match-events .event')).toHaveLength(2);
  expect(container.querySelectorAll('.overview-scorers li')).toHaveLength(0);
  expect(screen.getByText("23'")).toBeTruthy();
  expect(screen.getByText("45+2'")).toBeTruthy();
  expect(screen.queryByText('Other Player')).toBeNull();expect(screen.queryByText('Keeper')).toBeNull();

});

it('keeps statistics and repeated navigation out of Overview',()=>{
 const {container}=show(base,{...data,statistics:[{teamId:base.home.id,name:'totalShots',label:'Shots',value:'12'}]});
 expect(container.querySelector('.overview-snapshot')).toBeNull();
 expect(screen.queryByText('Shots')).toBeNull();expect(screen.queryByRole('button')).toBeNull();
});

it('includes red cards as compact incidents rather than commentary paragraphs',()=>{
  show(base,{...data,events:[{id:'red',teamId:base.away.id,minute:"50'",period:2,seconds:3000,kind:'second-yellow-card',text:'Second yellow card.',participants:['Defender']} ]});
  expect(screen.getByText('Defender')).toBeTruthy();
  expect(screen.getByRole('img',{name:'Second yellow card'})).toBeTruthy();
  expect(screen.queryByText('Second yellow card.')).toBeNull();
});

it('shows the supplied match facts and omits missing fields',()=>{
 const {unmount}=show(base,{...data,referee:'Referee Name',venue:'Test Stadium',venueCity:'Test City',capacity:31876,attendance:31629});
 expect(screen.getByText('Referee Name')).toBeTruthy();expect(screen.getByText('Test Stadium')).toBeTruthy();expect(screen.getByText('Test City · Capacity 31,876')).toBeTruthy();
 expect(screen.getByText('31,629')).toBeTruthy();unmount();
 show({...base,competition:''},data);expect(screen.queryByText('Not provided')).toBeNull();expect(screen.getByText(/have not been announced/)).toBeTruthy();
});

it('lists competition, broadcast, referee, weather and attendance rows in order when fully supplied',()=>{
 show({...base,competition:'Premier League'},{...data,seasonName:'2026-27 English Premier League',matchweek:12,broadcasts:['Sky Sports','TNT Sports'],referee:'Referee Name',venue:'Test Stadium',venueCity:'Test City',capacity:31876,attendance:31629,weather:{temperatureF:54,condition:'Partly Cloudy'}});
 const info=screen.getByRole('region',{name:'Match information'});
 expect([...info.querySelectorAll('dt')].map(dt=>dt.textContent)).toEqual(['Competition','Stadium','Broadcast','Referee','Kick-off weather','Attendance']);
 expect(within(info).getByText('Premier League')).toBeTruthy();expect(within(info).getByText('Matchweek 12')).toBeTruthy();
 expect(within(info).getByText('Sky Sports · TNT Sports')).toBeTruthy();expect(within(info).getByText('Referee Name')).toBeTruthy();
 expect(within(info).getByText('12°C')).toBeTruthy();expect(within(info).getByText('Partly Cloudy')).toBeTruthy();
 expect(within(info).getByText('Test Stadium')).toBeTruthy();expect(within(info).getByText('31,629')).toBeTruthy();
});

it('collapses long broadcast lists to three names with a count and the full list in title',()=>{
 show({...base,competition:'Premier League'},{...data,broadcasts:['Sky Sports','TNT Sports','Peacock','ESPN+']});
 const row=screen.getByText('Sky Sports · TNT Sports · Peacock').closest('dd');
 expect(row?.getAttribute('title')).toBe('Sky Sports · TNT Sports · Peacock · ESPN+');
 expect(screen.getByText('+1 more')).toBeTruthy();
});

it('shows only competition and stadium when only the venue is supplied, with no placeholder text',()=>{
 const {unmount}=show({...base,competition:'Premier League'},{...data,venue:'Test Stadium'});
 const info=screen.getByRole('region',{name:'Match information'});
 expect([...info.querySelectorAll('dt')].map(dt=>dt.textContent)).toEqual(['Competition','Stadium']);
 expect(screen.queryByText('Broadcast')).toBeNull();expect(screen.queryByText('Referee')).toBeNull();expect(screen.queryByText('Kick-off weather')).toBeNull();
 expect(info.textContent).not.toMatch(/undefined|NaN|null|°F/);
 unmount();
});

it('falls back to the season years when the matchweek is absent',()=>{
 show({...base,competition:'Premier League'},{...data,seasonName:'2026-27 English Premier League',matchweek:null});
 expect(screen.getByText('Season 2026-27')).toBeTruthy();
});

it('surfaces triple-hyphen VAR reviews without treating them as goals',()=>{
 const {container}=show(base,{...data,events:[
  {id:'var',teamId:base.away.id,minute:"23'",period:1,seconds:1380,kind:'var---referee-decision-cancelled',text:'VAR Decision: Card upgraded Igor Thiago (Brentford).',participants:['Igor Thiago']},
 ]});
 expect(container.querySelector('.match-events .event.goal')).toBeNull();
 expect(screen.getByRole('img',{name:'VAR review · Referee decision cancelled'})).toBeTruthy();
 expect(screen.getByText('Igor Thiago')).toBeTruthy();
});

it('says an abandoned match was abandoned, not cancelled',()=>{
 const {unmount}=show({...base,status:'cancelled',detail:'Abandoned',homeScore:null,awayScore:null});
 expect(screen.getByText('This match was abandoned.')).toBeTruthy();
 expect(screen.queryByText('This match was cancelled.')).toBeNull();unmount();
 show({...base,status:'cancelled',detail:'Canceled',homeScore:null,awayScore:null});
 expect(screen.getByText('This match was cancelled.')).toBeTruthy();
});

it('marks a forfeit as an awarded result without inventing goalscorers',()=>{
 show({...base,status:'fulltime',detail:'Forfeit',homeScore:3,awayScore:0});
 expect(screen.getByText(/Result awarded by forfeit/)).toBeTruthy();
 expect(screen.queryByLabelText('Goalscorers')).toBeNull();
 expect(screen.queryByText('Scorers unavailable')).toBeNull();
});

it('reduces ESPN leader strings to the category figure with appearances as context',async()=>{
 const {leaderStat}=await import('./MatchPreview');
 expect(leaderStat('Goals','Matches: 10, Goals: 9')).toEqual({main:'9',apps:'10'});
 expect(leaderStat('Assists','Matches: 10, Assists: 3')).toEqual({main:'3',apps:'10'});
 expect(leaderStat('Shots','38')).toEqual({main:'38'});
 expect(leaderStat('Rating','n/a')).toEqual({main:'n/a'});
});

it("writes added time as 90+7' and names VAR rows in key moments",()=>{
 show(base,{...data,events:[
  {id:'g',teamId:base.home.id,minute:"90'+7'",period:2,seconds:5820,kind:'goal',text:'Late goal.',participants:['Late Scorer']},
  {id:'v',teamId:base.away.id,minute:"34'",period:1,seconds:2040,kind:'var-decision',text:'VAR Decision: Goal disallowed Matheus Cunha (Wolves).',participants:['Matheus Cunha']},
 ]});
 expect(screen.getByText("90+7'")).toBeTruthy();expect(screen.queryByText("90'+7'")).toBeNull();
 expect(screen.getByText('VAR · Goal disallowed')).toBeTruthy();expect(screen.getByText('Matheus Cunha')).toBeTruthy();
});

it('clamps a long broadcast value to two lines with the full list in a tooltip instead of cutting it',()=>{
 show({...base,competition:'Premier League'},{...data,broadcasts:['USA Network','Telemundo Deportes']});
 const value=screen.getByText('USA Network · Telemundo Deportes');
 expect(value.closest('dd')?.classList.contains('ov-clamp')).toBe(true);
 expect(value.closest('dd')?.getAttribute('title')).toBe('USA Network · Telemundo Deportes');
});
