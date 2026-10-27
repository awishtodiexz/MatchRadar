#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod model;
mod provider;
use chrono::{DateTime, Utc};
use model::{Settings, Snapshot};
use std::{collections::HashSet, fs, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager, menu::{Menu, MenuItem}, tray::TrayIconBuilder};
use tauri_plugin_notification::NotificationExt;

struct State { snapshot: Mutex<Snapshot>, path: PathBuf, wake: tokio::sync::Notify, refresh_lock: tokio::sync::Mutex<()> }
fn persist(state: &State) { if let Ok(snapshot) = state.snapshot.lock() { if let Ok(data) = serde_json::to_vec(&*snapshot) { let _ = fs::write(&state.path, data); } } }
#[tauri::command]
fn get_snapshot(state: tauri::State<'_, State>) -> Result<Snapshot,String> { state.snapshot.lock().map(|s|s.clone()).map_err(|e|e.to_string()) }
#[tauri::command]
fn save_settings(settings: Settings, app: tauri::AppHandle, state: tauri::State<'_, State>) -> Result<(),String> {
    if let Some(window)=app.get_webview_window("main") { let _=window.set_always_on_top(settings.always_on_top); }
    { let mut snapshot=state.snapshot.lock().map_err(|e|e.to_string())?; if snapshot.settings.mock != settings.mock { snapshot.matches.clear(); snapshot.updated_at=None; snapshot.error=None; } snapshot.settings=settings; }
    persist(&state); state.wake.notify_one(); Ok(())
}
#[tauri::command]
fn refresh(state: tauri::State<'_, State>) { state.wake.notify_one(); }
#[tauri::command]
fn test_notification(app: tauri::AppHandle) -> Result<(),String> { app.notification().builder().title("MatchRadar").body("You're all set for matchday.").show().map_err(|e|e.to_string()) }

fn notifications(app: &tauri::AppHandle, old: &Snapshot, next: &mut Snapshot) {
    let now=Utc::now(); let settings=&next.settings;
    let mut sent: HashSet<String>=old.sent_notifications.iter().cloned().collect();
    for m in &next.matches {
        if !settings.favorites.contains(&m.home.id) && !settings.favorites.contains(&m.away.id) { continue; }
        let name=format!("{} vs {}",m.home.name,m.away.name);
        let kickoff=DateTime::parse_from_rfc3339(&m.kickoff).ok().map(|d|d.with_timezone(&Utc));
        let mut alerts=Vec::new();
        if let Some(kickoff)=kickoff { let minutes=(kickoff-now).num_seconds(); if settings.reminders && m.status=="scheduled" && minutes>0 && minutes<=settings.reminder_minutes as i64*60 { alerts.push((format!("{}:reminder",m.id),format!("{} kicks off soon",name))); } }
        let previous=old.matches.iter().find(|p|p.id==m.id);
        if settings.starts && m.status=="live" && previous.is_some_and(|p|p.status=="scheduled") { alerts.push((format!("{}:start",m.id),format!("{} is underway",name))); }
        if settings.goals && (m.status=="live" || m.status=="halftime") { if let Some(p)=previous { if let (Some(h),Some(a),Some(ph),Some(pa))=(m.home_score,m.away_score,p.home_score,p.away_score) { if h>ph || a>pa { alerts.push((format!("{}:score:{}:{}",m.id,h,a),format!("{} · {}–{}",name,h,a))); } } } }
        for (id,body) in alerts { if !sent.contains(&id) && app.notification().builder().title("MatchRadar").body(&body).show().is_ok() { sent.insert(id); } }
    }
    next.sent_notifications=sent.into_iter().collect(); if next.sent_notifications.len()>1000 { next.sent_notifications.drain(..next.sent_notifications.len()-1000); }
}

async fn poll(app: tauri::AppHandle) {
    let mut failures=0u32;
    loop {
        let state=app.state::<State>();
        let _guard=state.refresh_lock.lock().await;
        let settings=state.snapshot.lock().unwrap().settings.clone();
        let mut retry_after=None;
        if settings.mock { let mut s=state.snapshot.lock().unwrap(); s.matches=provider::mock(); s.updated_at=Some(Utc::now().to_rfc3339()); s.error=None; failures=0; }
        else { match provider::fetch().await {
            Ok(matches)=>{ let mut s=state.snapshot.lock().unwrap(); let old=s.clone(); s.matches=matches; s.updated_at=Some(Utc::now().to_rfc3339()); s.error=None; notifications(&app,&old,&mut s); failures=0; },
            Err(e)=>{ retry_after=e.retry_after; let mut s=state.snapshot.lock().unwrap(); s.error=Some(e.message); failures=failures.saturating_add(1); }
        }}
        persist(&state); let _=app.emit("snapshot-updated",());
        let delay={let s=state.snapshot.lock().unwrap(); if failures>0 { retry_after.unwrap_or(60u64.saturating_mul(2u64.saturating_pow(failures.min(5)))).min(3600) } else if s.matches.iter().any(|m|m.status=="live"||m.status=="halftime") {60} else if s.matches.iter().any(|m|DateTime::parse_from_rfc3339(&m.kickoff).ok().is_some_and(|d| {let secs=(d.with_timezone(&Utc)-Utc::now()).num_seconds(); secs>0 && secs<24*3600})) {300} else {1800}};
        drop(_guard);
        tokio::select! { _=tokio::time::sleep(Duration::from_secs(delay))=>{}, _=state.wake.notified()=>{} }
    }
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app,_,_| { if let Some(w)=app.get_webview_window("main") { let _=w.show(); let _=w.unminimize(); let _=w.set_focus(); } }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            let dir=app.path().app_data_dir()?; fs::create_dir_all(&dir)?; let path=dir.join("state.json");
            let snapshot=fs::read(&path).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_default();
            app.manage(State{snapshot:Mutex::new(snapshot),path,wake:tokio::sync::Notify::new(),refresh_lock:tokio::sync::Mutex::new(())});
            let show=MenuItem::with_id(app,"show","Show / Hide",true,None::<&str>)?;
            let settings=MenuItem::with_id(app,"settings","Settings",true,None::<&str>)?;
            let quit=MenuItem::with_id(app,"quit","Quit",true,None::<&str>)?;
            let menu=Menu::with_items(app,&[&show,&settings,&quit])?;
            let mut tray=TrayIconBuilder::new().menu(&menu).tooltip("MatchRadar").on_menu_event(|app,event| { match event.id.as_ref() { "quit"=>app.exit(0), "show"|"settings"=>{if let Some(w)=app.get_webview_window("main"){ if event.id.as_ref()=="show" && w.is_visible().unwrap_or(false) {let _=w.hide();} else {let _=w.show();let _=w.unminimize();let _=w.set_focus(); if event.id.as_ref()=="settings" {let _=app.emit("open-settings",());}} }}, _=>{} } });
            if let Some(icon)=app.default_window_icon() { tray=tray.icon(icon.clone()); } tray.build(app)?;
            if let Some(w)=app.get_webview_window("main") { let state=app.state::<State>(); let _=w.set_always_on_top(state.snapshot.lock().unwrap().settings.always_on_top); }
            tauri::async_runtime::spawn(poll(app.handle().clone())); Ok(())
        })
        .on_window_event(|window,event| { if let tauri::WindowEvent::CloseRequested {api,..}=event { api.prevent_close(); let _=window.hide(); } })
        .invoke_handler(tauri::generate_handler![get_snapshot,save_settings,refresh,test_notification])
        .run(tauri::generate_context!()).expect("failed to run MatchRadar");
}
