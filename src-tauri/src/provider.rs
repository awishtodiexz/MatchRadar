use crate::model::{Match,Team};
use chrono::{Duration,Utc};
use serde_json::Value;
use std::time::Duration as StdDuration;

pub struct FetchError { pub message:String, pub retry_after:Option<u64> }
fn field<'a>(v:&'a Value,key:&str)-> &'a str { v.get(key).and_then(Value::as_str).unwrap_or("") }
fn team(side:&Value)->Option<Team> { let t=side.get("team")?; let id=field(t,"id"); let name=field(t,"displayName"); if id.is_empty()||name.is_empty(){return None} let logo=field(t,"logo"); Some(Team{id:id.into(),name:name.into(),short:field(t,"abbreviation").into(),logo:if logo.starts_with("https://a.espncdn.com/"){Some(logo.into())}else{None}}) }
fn score(side:&Value)->Option<u32> { side.get("score").and_then(|s|s.as_str().and_then(|s|s.parse().ok()).or_else(||s.as_u64().and_then(|n|u32::try_from(n).ok()))) }
fn normalize(event:&Value)->Option<Match> {
 let id=field(event,"id"); let kickoff=field(event,"date"); if id.is_empty() || chrono::DateTime::parse_from_rfc3339(kickoff).is_err(){return None}
 let competition=event.get("competitions")?.as_array()?.first()?; let competitors=competition.get("competitors")?.as_array()?;
 let home=competitors.iter().find(|c|field(c,"homeAway")=="home")?; let away=competitors.iter().find(|c|field(c,"homeAway")=="away")?;
 let status=event.get("status").or_else(||competition.get("status"))?; let kind=status.get("type")?; let name=field(kind,"name").to_ascii_lowercase(); let state=field(kind,"state");
 let mapped=if name.contains("postpon") {"postponed"} else if name.contains("cancel") {"cancelled"} else if name.contains("suspend") {"suspended"} else if name.contains("halftime")||name.contains("half_time") {"halftime"} else {match state {"pre"=>"scheduled","in"=>"live","post"=>"fulltime",_=>"unknown"}};
 let detail=if mapped=="live" { let clock=field(status,"displayClock"); if clock.is_empty(){field(kind,"shortDetail")}else{clock} } else {field(kind,"shortDetail")};
 Some(Match{id:id.into(),home:team(home)?,away:team(away)?,home_score:score(home),away_score:score(away),kickoff:kickoff.into(),status:mapped.into(),detail:if detail.is_empty(){mapped.into()}else{detail.into()},competition:"Premier League".into()})
}
pub async fn fetch()->Result<Vec<Match>,FetchError> {
 let client=reqwest::Client::builder().timeout(StdDuration::from_secs(15)).build().map_err(|e|FetchError{message:e.to_string(),retry_after:None})?;
 let start=Utc::now().date_naive(); let end=start+Duration::days(14); let dates=format!("{}-{}",start.format("%Y%m%d"),end.format("%Y%m%d"));
 let response=client.get("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard").query(&[("dates",dates),("limit","200".into())]).send().await.map_err(|e|FetchError{message:e.to_string(),retry_after:None})?;
 if !response.status().is_success(){let status=response.status();let retry_after=response.headers().get("retry-after").and_then(|h|h.to_str().ok()).and_then(|s|s.parse().ok());return Err(FetchError{message:format!("ESPN returned {status}"),retry_after});}
 let json:Value=response.json().await.map_err(|e|FetchError{message:e.to_string(),retry_after:None})?;
 let events=json.get("events").and_then(Value::as_array).ok_or_else(||FetchError{message:"Unexpected ESPN response".into(),retry_after:None})?;
 Ok(events.iter().filter_map(normalize).collect())
}
pub fn mock()->Vec<Match> { let now=Utc::now(); let team=|id:&str,name:&str,short:&str|Team{id:id.into(),name:name.into(),short:short.into(),logo:None}; let pairs=[("359","Arsenal","ARS","363","Chelsea","CHE","live",-1,Some(2),Some(1)),("364","Liverpool","LIV","331","Newcastle United","NEW","halftime",-1,Some(0),Some(0)),("382","Manchester City","MCI","360","Manchester United","MUN","scheduled",3,None,None),("367","Tottenham Hotspur","TOT","361","Aston Villa","AVL","scheduled",26,None,None),("337","Brighton","BHA","362","Everton","EVE","fulltime",-4,Some(1),Some(1)),("379","Wolves","WOL","371","West Ham","WHU","postponed",48,None,None)]; pairs.iter().enumerate().map(|(i,(hi,hn,hs,ai,an,as_,status,hours,home_score,away_score))|Match{id:format!("demo-{i}"),home:team(hi,hn,hs),away:team(ai,an,as_),home_score:*home_score,away_score:*away_score,kickoff:(now+Duration::hours(*hours)).to_rfc3339(),status:status.to_string(),detail:match *status{"live"=>"67′","halftime"=>"Half-time","fulltime"=>"Full-time","postponed"=>"Postponed",_=>"Scheduled"}.into(),competition:"Premier League".into()}).collect() }
#[cfg(test)] mod tests { use super::*; #[test] fn rejects_bad_fixture(){assert!(normalize(&serde_json::json!({"id":"1"})).is_none());} #[test] fn normalizes_home_away_by_role(){let v=serde_json::json!({"id":"1","date":"2026-08-22T14:00Z","status":{"type":{"state":"in","name":"STATUS_IN_PROGRESS"},"displayClock":"67'"},"competitions":[{"competitors":[{"homeAway":"away","score":"1","team":{"id":"2","displayName":"Away"}},{"homeAway":"home","score":"2","team":{"id":"1","displayName":"Home"}}]}]});let m=normalize(&v).unwrap();assert_eq!(m.home.name,"Home");assert_eq!(m.status,"live");assert_eq!(m.home_score,Some(2));} }
