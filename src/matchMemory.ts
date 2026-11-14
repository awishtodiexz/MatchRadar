export const MATCH_SECTIONS = ['Overview','Stats','Lineups','Commentary'] as const;
export type MatchSection = typeof MATCH_SECTIONS[number];
export const COMMENTARY_TYPES = ['all','key','goals','cards','substitutions','shots','stoppages'] as const;
export type CommentaryType = typeof COMMENTARY_TYPES[number];

export interface MatchViewState {
  section:MatchSection;
  eventType:CommentaryType;
  newestFirst:boolean;
  lineupTeamId:string|null;
  statisticGroup:string;
  statisticsExpanded:boolean;
}
export interface MatchMemory {
  view:MatchViewState;
  scroll:Partial<Record<MatchSection,number>>;
}
export const createMatchMemory = ():MatchMemory => ({
  view:{section:'Overview',eventType:'all',newestFirst:true,lineupTeamId:null,statisticGroup:'All',statisticsExpanded:false},
  scroll:{}
});
