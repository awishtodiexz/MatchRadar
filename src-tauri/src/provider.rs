use crate::model::{Match,Team};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde_json::Value;
use std::time::Duration as StdDuration;

#[derive(Debug)]
pub struct FetchError { pub message:String, pub retry_after:Option<u64> }
fn field<'a>(v:&'a Value,key:&str)-> &'a str { v.get(key).and_then(Value::as_str).unwrap_or("") }
fn team(side:&Value)->Option<Team> { let t=side.get("team")?; let id=field(t,"id"); let name=field(t,"displayName"); if id.is_empty()||name.is_empty(){return None} let logo=field(t,"logo"); Some(Team{id:id.into(),name:name.into(),short:field(t,"abbreviation").into(),logo:if logo.starts_with("https://a.espncdn.com/"){Some(logo.into())}else{None}}) }
fn score(side:&Value)->Option<u32> { side.get("score").and_then(|s|s.as_str().and_then(|s|s.parse().ok()).or_else(||s.as_u64().and_then(|n|u32::try_from(n).ok()))) }
fn parse_kickoff(value:&str)->Option<DateTime<Utc>> {
 DateTime::parse_from_rfc3339(value).ok().or_else(|| {
  // ESPN commonly emits UTC timestamps without seconds, e.g. 2026-10-31T12:30Z.
  let base=value.strip_suffix('Z')?;
  if base.len()!=16 { return None; }
  DateTime::parse_from_rfc3339(&format!("{base}:00Z")).ok()
 }).map(|date|date.with_timezone(&Utc))
}
fn normalize(event:&Value)->Option<Match> {
 let id=field(event,"id"); let kickoff=parse_kickoff(field(event,"date"))?; if id.is_empty(){return None}
 let competition=event.get("competitions")?.as_array()?.first()?; let competitors=competition.get("competitors")?.as_array()?;
 let home=competitors.iter().find(|c|field(c,"homeAway")=="home")?; let away=competitors.iter().find(|c|field(c,"homeAway")=="away")?;
 let status=event.get("status").or_else(||competition.get("status"))?; let kind=status.get("type")?; let name=field(kind,"name").to_ascii_lowercase(); let state=field(kind,"state");
 let mapped=if name.contains("postpon") {"postponed"} else if name.contains("cancel") {"cancelled"} else if name.contains("suspend") {"suspended"} else if name.contains("halftime")||name.contains("half_time") {"halftime"} else {match state {"pre"=>"scheduled","in"=>"live","post"=>"fulltime",_=>"unknown"}};
 let detail=if mapped=="live" { let clock=field(status,"displayClock"); if clock.is_empty(){field(kind,"shortDetail")}else{clock} } else {field(kind,"shortDetail")};
 Some(Match{id:id.into(),home:team(home)?,away:team(away)?,home_score:score(home),away_score:score(away),kickoff:kickoff.to_rfc3339(),status:mapped.into(),detail:if detail.is_empty(){mapped.into()}else{detail.into()},competition:"Premier League".into()})
}
fn parse_response(status:u16, retry_after:Option<u64>, body:&str, query:&str)->Result<Vec<Match>,FetchError> {
 if !(200..300).contains(&status) { return Err(FetchError{message:format!("ESPN scoreboard dates={query}: HTTP {status}"),retry_after}); }
 let json:Value=serde_json::from_str(body).map_err(|e|FetchError{message:format!("ESPN scoreboard dates={query}: invalid JSON: {e}"),retry_after:None})?;
 let events=json.get("events").and_then(Value::as_array).ok_or_else(||FetchError{message:format!("ESPN scoreboard dates={query}: missing events array"),retry_after:None})?;
 let matches:Vec<_>=events.iter().filter_map(normalize).collect();
 if !events.is_empty() && matches.is_empty() { return Err(FetchError{message:format!("ESPN scoreboard dates={query}: no valid fixtures in {} events",events.len()),retry_after:None}); }
 Ok(matches)
}
pub fn client()->Result<reqwest::Client,FetchError> { reqwest::Client::builder().timeout(StdDuration::from_secs(15)).build().map_err(|e|FetchError{message:format!("ESPN HTTP client: {e}"),retry_after:None}) }
async fn query(client:&reqwest::Client, dates:&str)->Result<Vec<Match>,FetchError> {
 let response=client.get("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard").query(&[("dates",dates),("limit","200")]).send().await.map_err(|e|FetchError{message:format!("ESPN scoreboard dates={dates}: {e}"),retry_after:None})?;
 let status=response.status().as_u16(); let retry_after=response.headers().get("retry-after").and_then(|h|h.to_str().ok()).and_then(|s|s.parse().ok());
 let body=response.text().await.map_err(|e|FetchError{message:format!("ESPN scoreboard dates={dates}: response read failed: {e}"),retry_after:None})?;
 parse_response(status,retry_after,&body,dates)
}
pub fn merge(base:Vec<Match>, updates:Vec<Match>)->Vec<Match> {
 let mut by_id:std::collections::HashMap<String,Match>=base.into_iter().map(|m|(m.id.clone(),m)).collect();
 for m in updates { by_id.insert(m.id.clone(),m); }
 let mut result:Vec<_>=by_id.into_values().collect(); result.sort_by(|a,b|a.kickoff.cmp(&b.kickoff).then(a.id.cmp(&b.id))); result
}
pub async fn fixtures(client:&reqwest::Client, today:NaiveDate)->Result<Vec<Match>,FetchError> {
 let end=today+Duration::days(14); let first=(today-Duration::days(1)).format("%Y%m").to_string(); let last=end.format("%Y%m").to_string();
 let mut matches=query(client,&first).await?; if first!=last { matches=merge(matches,query(client,&last).await?); }
 let start=today-Duration::days(1); matches.retain(|m|parse_kickoff(&m.kickoff).is_some_and(|d|d.date_naive()>=start&&d.date_naive()<=end)); Ok(matches)
}
pub async fn scores(client:&reqwest::Client, today:NaiveDate, cached:&[Match])->Result<Vec<Match>,FetchError> {
 let mut matches=query(client,&today.format("%Y%m%d").to_string()).await?;
 if cached.iter().any(|m|(m.status=="live"||m.status=="halftime") && parse_kickoff(&m.kickoff).is_some_and(|d|d.date_naive()==today-Duration::days(1))) { matches=merge(matches,query(client,&(today-Duration::days(1)).format("%Y%m%d").to_string()).await?); }
 Ok(matches)
}
pub fn mock()->Vec<Match> { let now=Utc::now(); let team=|id:&str,name:&str,short:&str|Team{id:id.into(),name:name.into(),short:short.into(),logo:None}; let pairs=[("359","Arsenal","ARS","363","Chelsea","CHE","live",-1,Some(2),Some(1)),("364","Liverpool","LIV","331","Newcastle United","NEW","halftime",-1,Some(0),Some(0)),("382","Manchester City","MCI","360","Manchester United","MUN","scheduled",3,None,None),("367","Tottenham Hotspur","TOT","361","Aston Villa","AVL","scheduled",26,None,None),("337","Brighton","BHA","362","Everton","EVE","fulltime",-4,Some(1),Some(1)),("379","Wolves","WOL","371","West Ham","WHU","postponed",48,None,None)]; pairs.iter().enumerate().map(|(i,(hi,hn,hs,ai,an,as_,status,hours,home_score,away_score))|Match{id:format!("demo-{i}"),home:team(hi,hn,hs),away:team(ai,an,as_),home_score:*home_score,away_score:*away_score,kickoff:(now+Duration::hours(*hours)).to_rfc3339(),status:status.to_string(),detail:match *status{"live"=>"67′","halftime"=>"Half-time","fulltime"=>"Full-time","postponed"=>"Postponed",_=>"Scheduled"}.into(),competition:"Premier League".into()}).collect() }
#[cfg(test)] mod tests { use super::*; #[test] fn rejects_bad_fixture(){assert!(normalize(&serde_json::json!({"id":"1"})).is_none());} #[test] fn normalizes_home_away_by_role(){let v=serde_json::json!({"id":"1","date":"2026-08-22T14:00:00Z","status":{"type":{"state":"in","name":"STATUS_IN_PROGRESS"},"displayClock":"67'"},"competitions":[{"competitors":[{"homeAway":"away","score":"1","team":{"id":"2","displayName":"Away"}},{"homeAway":"home","score":"2","team":{"id":"1","displayName":"Home"}}]}]});let m=normalize(&v).unwrap();assert_eq!(m.home.name,"Home");assert_eq!(m.status,"live");assert_eq!(m.home_score,Some(2));} }
#[cfg(test)] mod response_tests {
 use super::*;
 fn event()->Value { serde_json::json!({"id":"1","date":"2026-10-31T12:30Z","status":{"type":{"state":"pre","name":"STATUS_SCHEDULED"}},"competitions":[{"competitors":[{"homeAway":"home","team":{"id":"1","displayName":"Home"}},{"homeAway":"away","team":{"id":"2","displayName":"Away"}}]}]}) }
 #[test] fn successful_response_accepts_espn_minute_timestamp(){let body=serde_json::json!({"events":[event()]}).to_string();let matches=parse_response(200,None,&body,"20261031").unwrap();assert_eq!(matches.len(),1);assert_eq!(matches[0].kickoff,"2026-10-31T12:30:00+00:00");}
 #[test] fn bad_request_reports_status_and_query(){let err=parse_response(400,None,"{}","20261031").err().unwrap();assert!(err.message.contains("HTTP 400"));assert!(err.message.contains("20261031"));}
 #[test] fn rejects_unexpected_json(){assert!(parse_response(200,None,"{}","202610").is_err());assert!(parse_response(200,None,"no json","202610").is_err());assert!(parse_response(200,None,"{\"events\":[{}]}","202610").is_err());}
 #[test] fn empty_events_are_success(){assert!(parse_response(200,None,"{\"events\":[]}","202610").unwrap().is_empty());}
 #[test] fn deduplicates_and_prefers_latest(){let m=normalize(&event()).unwrap();let mut update=m.clone();update.status="live".into();let merged=merge(vec![m],vec![update]);assert_eq!(merged.len(),1);assert_eq!(merged[0].status,"live");}
}
