use serde::{Deserialize,Serialize};
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Team { pub id:String, pub name:String, pub short:String, pub logo:Option<String> }
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Match { pub id:String, pub home:Team, pub away:Team, pub home_score:Option<u32>, pub away_score:Option<u32>, pub kickoff:String, pub status:String, pub detail:String, pub competition:String }
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(default,rename_all="camelCase")]
pub struct Settings { pub favorites:Vec<String>, pub followed_only:bool, pub compact:bool, pub always_on_top:bool, pub reduced_motion:bool, pub opacity:u8, pub reminders:bool, pub reminder_minutes:u32, pub starts:bool, pub goals:bool, pub mock:bool }
impl Default for Settings { fn default()->Self { Self { favorites:["359","363","364","382","360","367"].iter().map(|s|s.to_string()).collect(), followed_only:false,compact:false,always_on_top:true,reduced_motion:false,opacity:96,reminders:true,reminder_minutes:15,starts:true,goals:false,mock:false } } }
#[derive(Clone,Debug,Default,Serialize,Deserialize)]
#[serde(default,rename_all="camelCase")]
pub struct Snapshot { pub matches:Vec<Match>, pub updated_at:Option<String>, pub error:Option<String>, pub settings:Settings, pub sent_notifications:Vec<String> }
