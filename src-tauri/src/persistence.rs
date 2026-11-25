//! Snapshot replacement and recovery. Callers serialize saves with the snapshot lock.
use crate::model::{Snapshot, SNAPSHOT_FORMAT_VERSION};
use serde::Deserialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

pub struct Loaded {
    pub snapshot: Snapshot,
    pub notice: Option<String>,
}

pub fn load(path: &Path) -> Result<Loaded, String> {
    sweep_temps(path);
    load_with(&Disk, path)
}

/// Reset only proven corrupt state, after preserving every damaged copy.
/// A read or recovery failure must never be treated as an empty installation.
pub fn start_over(path: &Path) -> Result<Loaded, String> {
    sweep_temps(path);
    start_over_with(&Disk, path)
}

// A save killed between temp creation and rename leaves <name>.tmp-<pid>-<n>
// debris nothing else reclaims. Best-effort removal at launch; the .corrupt-
// diagnostic copies are intentionally left alone.
fn sweep_temps(path: &Path) {
    let Some(parent) = path.parent() else {
        return;
    };
    let Some(prefix) = path.file_name().map(|name| {
        let mut prefix = name.to_string_lossy().into_owned();
        prefix.push_str(".tmp-");
        prefix
    }) else {
        return;
    };
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = fs::remove_file(entry.path());
        }
    }
}
fn start_over_with(storage: &impl Storage, path: &Path) -> Result<Loaded, String> {
    let backup_path = sibling(path, ".bak");
    let primary = inspect(storage, path)?;
    let backup = inspect(storage, &backup_path)?;
    if matches!(primary, Existing::Valid(..)) || matches!(backup, Existing::Valid(..)) {
        return Err(
            "Refuse to reset valid saved state; recovery must succeed before startup".into(),
        );
    }
    for (file, existing) in [(path, &primary), (backup_path.as_path(), &backup)] {
        match existing {
            Existing::Invalid(bytes, _) => {
                archive(storage, file, bytes)?;
            }
            Existing::Oversized => {
                move_aside(storage, file)?;
            }
            _ => {}
        }
    }
    let snapshot = Snapshot::default();
    let bytes = serde_json::to_vec(&snapshot).map_err(|e| format!("Serialize defaults: {e}"))?;
    publish(storage, &backup_path, &bytes)?;
    publish(storage, path, &bytes)?;
    Ok(Loaded {
        snapshot,
        notice: Some("Damaged saved state was archived; started with defaults".into()),
    })
}

fn snapshot_bytes(snapshot: &Snapshot) -> Result<Vec<u8>, String> {
    if snapshot.format_version != SNAPSHOT_FORMAT_VERSION {
        return Err(format!(
            "Refuse to save MatchRadar state with format version {}",
            snapshot.format_version
        ));
    }
    let mut bytes =
        serde_json::to_vec(snapshot).map_err(|e| format!("Serialize MatchRadar state: {e}"))?;
    if bytes.len() as u64 > MAX_STATE_BYTES {
        // The details cache dominates state size; trimming it is better than
        // writing a state the read cap would refuse at the next launch.
        let mut trimmed = snapshot.clone();
        trimmed.detail_cache.truncate(8);
        bytes =
            serde_json::to_vec(&trimmed).map_err(|e| format!("Serialize MatchRadar state: {e}"))?;
    }
    if bytes.len() as u64 > MAX_STATE_BYTES {
        return Err(format!(
            "MatchRadar state exceeds {MAX_STATE_BYTES} bytes; nothing was written"
        ));
    }
    Ok(bytes)
}

pub fn save(path: &Path, snapshot: &Snapshot) -> Result<(), String> {
    save_with(&Disk, path, &snapshot_bytes(snapshot)?)
}

// A small seam for deterministic read/write/replace failures, without OS permission tricks.
trait Storage {
    fn read(&self, path: &Path) -> io::Result<Vec<u8>>;
    fn publish(&self, path: &Path, bytes: &[u8]) -> io::Result<()>;
    fn archive(&self, path: &Path, bytes: &[u8]) -> io::Result<PathBuf>;
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()>;
}

// The byte buffers are short-lived around a single read; boxing would complicate
// the recovery paths for no measurable benefit.
#[allow(clippy::large_enum_variant)]
enum Existing {
    Missing,
    Valid(Vec<u8>, Snapshot),
    Invalid(Vec<u8>, String),
    // Over the read cap: never materialized, so it can only be moved, not parsed
    // or archived by bytes.
    Oversized,
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    name.into()
}

fn validate(bytes: &[u8]) -> Result<Snapshot, String> {
    serde_json::from_slice(bytes).map_err(|e| e.to_string())
}

/// Every other external input is size-bounded; the state file is the last one.
/// Refuse to materialize or parse anything beyond a generous snapshot size.
const MAX_STATE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FormatHeader {
    #[serde(default)]
    format_version: u64,
}

fn inspect(storage: &impl Storage, path: &Path) -> Result<Existing, String> {
    match storage.read(path) {
        Ok(bytes) if bytes.len() as u64 > MAX_STATE_BYTES => Ok(Existing::Oversized),
        Ok(bytes) => {
            // Check the version before decoding fields whose types may have changed.
            let decoded = match serde_json::from_slice::<FormatHeader>(&bytes) {
                Ok(header) if header.format_version > SNAPSHOT_FORMAT_VERSION => {
                    return Err(format!(
                        "MatchRadar state {} uses newer snapshot format version {} (supported: {}); open it with a newer version of MatchRadar. Original left untouched",
                        path.display(),
                        header.format_version,
                        SNAPSHOT_FORMAT_VERSION
                    ));
                }
                Ok(_) => validate(&bytes),
                Err(error) => Err(error.to_string()),
            };
            Ok(match decoded {
                Ok(snapshot) => Existing::Valid(bytes, snapshot),
                Err(error) => Existing::Invalid(bytes, error),
            })
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Existing::Missing),
        // Disk::read reports an oversized file this way without materializing it.
        Err(error) if error.kind() == io::ErrorKind::InvalidData => Ok(Existing::Oversized),
        // Permission failures are not a new installation or evidence of corruption.
        Err(error) => Err(format!(
            "Read MatchRadar state {}: {error}; no defaults were written",
            path.display()
        )),
    }
}

// An oversized file was never read, so it is preserved by rename, not by bytes.
fn move_aside(storage: &impl Storage, path: &Path) -> Result<PathBuf, String> {
    let target = sibling(
        path,
        &format!(
            ".corrupt-{}-{}",
            std::process::id(),
            NEXT_FILE.fetch_add(1, Ordering::Relaxed)
        ),
    );
    storage
        .rename(path, &target)
        .map(|_| target.clone())
        .map_err(|e| format!("Preserve oversized state {}: {e}", path.display()))
}

fn archive(storage: &impl Storage, path: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    storage.archive(path, bytes).map_err(|e| {
        format!(
            "Preserve damaged state {}: {e}; original left untouched",
            path.display()
        )
    })
}

fn publish(storage: &impl Storage, path: &Path, bytes: &[u8]) -> Result<(), String> {
    storage
        .publish(path, bytes)
        .map_err(|e| format!("Save MatchRadar state to {}: {e}", path.display()))
}

fn load_with(storage: &impl Storage, path: &Path) -> Result<Loaded, String> {
    let primary = inspect(storage, path)?;
    if let Existing::Valid(_, mut snapshot) = primary {
        snapshot.migrate_format();
        return Ok(Loaded {
            snapshot,
            notice: None,
        });
    }
    let backup_path = sibling(path, ".bak");
    let backup = inspect(storage, &backup_path)?;
    let mut diagnosis = String::new();
    if let Existing::Invalid(bytes, error) = &primary {
        let preserved = archive(storage, path, bytes)?;
        diagnosis = format!(
            "Invalid primary ({error}); preserved at {}. ",
            preserved.display()
        );
    }
    if let Existing::Oversized = &primary {
        let preserved = move_aside(storage, path)?;
        diagnosis = format!("Oversized primary; moved to {}. ", preserved.display());
    }
    match backup {
        Existing::Valid(bytes, mut snapshot) => {
            // Restore without rotating the damaged primary into the valid backup.
            publish(storage, path, &bytes)?;
            snapshot.migrate_format();
            Ok(Loaded {
                snapshot,
                notice: Some(format!(
                    "{diagnosis}Recovered MatchRadar state from {}",
                    backup_path.display()
                )),
            })
        }
        Existing::Missing if matches!(primary, Existing::Missing) => Ok(Loaded {
            snapshot: Snapshot::default(),
            notice: None,
        }),
        Existing::Missing => Err(format!(
            "{diagnosis}No backup at {}; recovery required; no defaults were written",
            backup_path.display()
        )),
        Existing::Invalid(bytes, error) => {
            let preserved = archive(storage, &backup_path, &bytes)?;
            Err(format!("{diagnosis}Invalid backup ({error}); preserved at {}; recovery required; no defaults were written", preserved.display()))
        }
        Existing::Oversized => {
            let preserved = move_aside(storage, &backup_path)?;
            Err(format!("{diagnosis}Oversized backup; moved to {}; recovery required; no defaults were written", preserved.display()))
        }
    }
}

fn save_with(storage: &impl Storage, path: &Path, bytes: &[u8]) -> Result<(), String> {
    validate(bytes).map_err(|e| format!("Refuse invalid outgoing MatchRadar state: {e}"))?;
    let primary = inspect(storage, path)?;
    if let Existing::Invalid(_, error) = &primary {
        return Err(format!(
            "Refuse to overwrite damaged state {}: {error}; restart to attempt backup recovery",
            path.display()
        ));
    }
    let backup_path = sibling(path, ".bak");
    let backup = inspect(storage, &backup_path)?;
    match &primary {
        Existing::Valid(previous, _) => {
            if let Existing::Invalid(damaged, _) = &backup {
                archive(storage, &backup_path, damaged)?;
            }
            if let Existing::Oversized = &backup {
                move_aside(storage, &backup_path)?;
            }
            // Only bytes that deserialize successfully may replace the backup.
            publish(storage, &backup_path, previous)?;
        }
        Existing::Missing | Existing::Oversized => {
            if let Existing::Oversized = &primary {
                move_aside(storage, path)?;
            }
            match backup {
                Existing::Missing => publish(storage, &backup_path, bytes)?,
                Existing::Valid(_, _) => (), // Preserve existing recovery data.
                Existing::Oversized => {
                    // A never-loadable backup is worse than a fresh good copy.
                    move_aside(storage, &backup_path)?;
                    publish(storage, &backup_path, bytes)?;
                }
                Existing::Invalid(_, _) => {
                    return Err(format!(
                    "Primary state missing but backup {} is damaged; restart to attempt recovery",
                    backup_path.display()
                ))
                }
            }
        }
        Existing::Invalid(_, _) => unreachable!(),
    }
    publish(storage, path, bytes)
}

struct Disk;
static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

fn exclusive(path: &Path, label: &str) -> io::Result<(PathBuf, File)> {
    loop {
        let unique = NEXT_FILE.fetch_add(1, Ordering::Relaxed);
        let candidate = sibling(path, &format!(".{label}-{}-{unique}", std::process::id()));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((candidate, file)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
}

struct Temporary(PathBuf);
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn atomic_write(
    path: &Path,
    bytes: &[u8],
    prepare: impl FnOnce(&mut File, &[u8]) -> io::Result<()>,
    replace: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    let (name, mut file) = exclusive(path, "tmp")?;
    let temporary = Temporary(name);
    // Close even on failure before Drop removes the temp (important on Windows).
    let prepared = prepare(&mut file, bytes);
    drop(file);
    prepared?;
    replace(&temporary.0, path)
}

fn write_synced(file: &mut File, bytes: &[u8]) -> io::Result<()> {
    file.write_all(bytes)?;
    file.sync_all()
}

impl Storage for Disk {
    fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
        if fs::metadata(path)?.len() > MAX_STATE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "state file exceeds the size limit",
            ));
        }
        fs::read(path)
    }
    fn publish(&self, path: &Path, bytes: &[u8]) -> io::Result<()> {
        // std::fs::rename replaces on Windows (MoveFileExW / FileRenameInfoEx).
        // Same-directory paths avoid cross-volume copy/delete. Never unlink the target.
        atomic_write(path, bytes, write_synced, |from, to| fs::rename(from, to))
    }
    fn archive(&self, path: &Path, bytes: &[u8]) -> io::Result<PathBuf> {
        let (name, mut file) = exclusive(path, "corrupt")?;
        // Keep even a partial diagnostic copy on failure; the original is still present.
        write_synced(&mut file, bytes)?;
        Ok(name)
    }
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        fs::rename(from, to)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::HashMap};

    #[derive(Default)]
    struct Memory {
        files: RefCell<HashMap<PathBuf, Vec<u8>>>,
        denied: RefCell<Option<PathBuf>>,
        failed_publish: RefCell<Option<PathBuf>>,
        failed_archive: RefCell<bool>,
    }
    impl Storage for Memory {
        fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
            if self.denied.borrow().as_deref() == Some(path) {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            self.files
                .borrow()
                .get(path)
                .cloned()
                .ok_or(io::ErrorKind::NotFound.into())
        }
        fn publish(&self, path: &Path, bytes: &[u8]) -> io::Result<()> {
            if self.failed_publish.borrow().as_deref() == Some(path) {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            self.files.borrow_mut().insert(path.into(), bytes.into());
            Ok(())
        }
        fn archive(&self, path: &Path, bytes: &[u8]) -> io::Result<PathBuf> {
            if *self.failed_archive.borrow() {
                return Err(io::ErrorKind::WriteZero.into());
            }
            let archived = sibling(path, ".corrupt-test");
            self.files
                .borrow_mut()
                .insert(archived.clone(), bytes.into());
            Ok(archived)
        }
        fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
            let mut files = self.files.borrow_mut();
            match files.remove(from) {
                Some(bytes) => {
                    files.insert(to.into(), bytes);
                    Ok(())
                }
                None => Err(io::ErrorKind::NotFound.into()),
            }
        }
    }
    fn primary() -> &'static Path {
        Path::new("state.json")
    }
    fn old() -> Vec<u8> {
        br#"{"settings":{"favorites":["370"],"compact":true}}"#.to_vec()
    }
    fn next() -> Vec<u8> {
        serde_json::to_vec(&Snapshot::default()).unwrap()
    }
    fn put(fs: &Memory, path: &Path, bytes: &[u8]) {
        fs.files.borrow_mut().insert(path.into(), bytes.into());
    }

    #[test]
    fn missing_is_new_but_unreadable_or_damaged_is_not() {
        let fs = Memory::default();
        assert!(load_with(&fs, primary()).unwrap().notice.is_none());
        assert!(fs.files.borrow().is_empty());
        *fs.denied.borrow_mut() = Some(primary().into());
        let error = load_with(&fs, primary()).err().unwrap();
        assert!(error.contains("Read MatchRadar state") && error.contains("no defaults"));
        assert!(fs.files.borrow().is_empty());
        *fs.denied.borrow_mut() = None;
        for damaged in [
            b"{partial".as_slice(),
            br#"{"settings":{"favorites":42}}"#,
            b"null",
        ] {
            put(&fs, primary(), damaged);
            assert!(load_with(&fs, primary()).is_err());
            assert_eq!(fs.read(primary()).unwrap(), damaged);
            assert_eq!(
                fs.read(&sibling(primary(), ".corrupt-test")).unwrap(),
                damaged
            );
        }
    }

    #[test]
    fn valid_backup_recovers_corrupt_primary_without_rotating_damage() {
        let fs = Memory::default();
        put(&fs, primary(), b"truncated");
        put(&fs, &sibling(primary(), ".bak"), &old());
        let loaded = load_with(&fs, primary()).unwrap();
        assert_eq!(loaded.snapshot.settings.favorites, ["370"]);
        assert!(loaded.snapshot.settings.compact);
        assert!(loaded.notice.unwrap().contains("Recovered"));
        assert_eq!(fs.read(primary()).unwrap(), old());
        assert_eq!(fs.read(&sibling(primary(), ".bak")).unwrap(), old());
        assert_eq!(
            fs.read(&sibling(primary(), ".corrupt-test")).unwrap(),
            b"truncated"
        );
        save_with(&fs, primary(), &next()).unwrap();
        assert_eq!(fs.read(&sibling(primary(), ".bak")).unwrap(), old());
    }

    #[test]
    fn missing_primary_recovers_backup_and_damaged_backup_never_means_new_install() {
        let fs = Memory::default();
        put(&fs, &sibling(primary(), ".bak"), &old());
        assert!(load_with(&fs, primary()).unwrap().notice.is_some());
        fs.files.borrow_mut().remove(primary());
        put(&fs, &sibling(primary(), ".bak"), b"bad backup");
        assert!(load_with(&fs, primary()).is_err());
        assert!(!fs.files.borrow().contains_key(primary()));
        assert_eq!(fs.read(&sibling(primary(), ".bak")).unwrap(), b"bad backup");
    }

    #[test]
    fn both_invalid_and_recovery_failures_preserve_all_originals() {
        let fs = Memory::default();
        put(&fs, primary(), b"bad primary");
        put(&fs, &sibling(primary(), ".bak"), b"bad backup");
        assert!(load_with(&fs, primary()).is_err());
        assert_eq!(fs.read(primary()).unwrap(), b"bad primary");
        assert_eq!(fs.read(&sibling(primary(), ".bak")).unwrap(), b"bad backup");
        put(&fs, &sibling(primary(), ".bak"), &old());
        *fs.failed_archive.borrow_mut() = true;
        assert!(load_with(&fs, primary()).is_err());
        *fs.failed_archive.borrow_mut() = false;
        *fs.failed_publish.borrow_mut() = Some(primary().into());
        assert!(load_with(&fs, primary()).is_err());
        assert_eq!(fs.read(primary()).unwrap(), b"bad primary");
        assert_eq!(fs.read(&sibling(primary(), ".bak")).unwrap(), old());
    }

    #[test]
    fn save_validates_both_sides_and_keeps_last_good_state_on_publish_failure() {
        let fs = Memory::default();
        put(&fs, primary(), &old());
        put(&fs, &sibling(primary(), ".bak"), &next());
        let untouched = fs.files.borrow().clone();
        assert!(save_with(&fs, primary(), b"invalid outgoing").is_err());
        assert_eq!(*fs.files.borrow(), untouched);
        *fs.failed_publish.borrow_mut() = Some(sibling(primary(), ".bak"));
        assert!(save_with(&fs, primary(), &next()).is_err());
        assert_eq!(*fs.files.borrow(), untouched);
        *fs.failed_publish.borrow_mut() = Some(primary().into());
        assert!(save_with(&fs, primary(), &next()).is_err());
        assert_eq!(fs.read(primary()).unwrap(), old());
        assert_eq!(fs.read(&sibling(primary(), ".bak")).unwrap(), old());
        put(&fs, primary(), b"externally corrupted");
        assert!(save_with(&fs, primary(), &next()).is_err());
        assert_eq!(fs.read(&sibling(primary(), ".bak")).unwrap(), old());
    }

    #[test]
    fn corrupt_backup_is_archived_and_only_replaced_with_valid_primary() {
        let fs = Memory::default();
        put(&fs, primary(), &old());
        put(&fs, &sibling(primary(), ".bak"), b"damaged backup");
        save_with(&fs, primary(), &next()).unwrap();
        assert_eq!(
            fs.read(&sibling(primary(), ".bak.corrupt-test")).unwrap(),
            b"damaged backup"
        );
        assert_eq!(fs.read(&sibling(primary(), ".bak")).unwrap(), old());
        assert_eq!(fs.read(primary()).unwrap(), next());
    }

    #[test]
    fn backup_read_denied_blocks_save_without_touching_primary() {
        let fs = Memory::default();
        put(&fs, primary(), &old());
        *fs.denied.borrow_mut() = Some(sibling(primary(), ".bak"));
        assert!(save_with(&fs, primary(), &next()).is_err());
        assert_eq!(fs.read(primary()).unwrap(), old());
    }

    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            let id = NEXT_FILE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "matchradar-persistence-{}-{id}",
                std::process::id()
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn primary(&self) -> PathBuf {
            self.0.join("state.json")
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn legacy_snapshot_migrates_once_and_first_save_keeps_original_backup() {
        let dir = Directory::new();
        let path = dir.primary();
        let legacy = br#"{"settings":{"favorites":["376","370"],"compact":true,"mock":true},"updatedAt":"2026-10-28T12:00:00Z","sentNotifications":["real-match:start","demo-match:start"]}"#;
        fs::write(&path, legacy).unwrap();

        let loaded = load(&path).unwrap().snapshot;
        assert_eq!(loaded.format_version, SNAPSHOT_FORMAT_VERSION);
        assert_eq!(loaded.settings.favorites, ["370"]);
        assert!(loaded.settings.compact);
        assert!(!loaded.settings.mock);
        assert_eq!(loaded.sent_notifications, ["real-match:start"]);
        assert_eq!(
            loaded.league_status[crate::model::Competition::PremierLeague.slug()].updated_at,
            loaded.updated_at
        );
        assert_eq!(fs::read(&path).unwrap(), legacy);

        save(&path, &loaded).unwrap();
        let saved = fs::read(&path).unwrap();
        let json: serde_json::Value = serde_json::from_slice(&saved).unwrap();
        assert_eq!(json["formatVersion"], SNAPSHOT_FORMAT_VERSION);
        assert_eq!(fs::read(sibling(&path, ".bak")).unwrap(), legacy);
        assert_eq!(
            serde_json::to_value(load(&path).unwrap().snapshot).unwrap(),
            json
        );
        assert_eq!(fs::read(&path).unwrap(), saved);
    }

    #[test]
    fn current_snapshot_loads_without_legacy_migrations_or_disk_writes() {
        let dir = Directory::new();
        let path = dir.primary();
        let current = format!(
            r#"{{"formatVersion":{SNAPSHOT_FORMAT_VERSION},"settings":{{"favorites":["376"],"compact":true}},"updatedAt":"2026-10-28T12:00:00Z"}}"#
        );
        fs::write(&path, &current).unwrap();

        let loaded = load(&path).unwrap();
        assert!(loaded.notice.is_none());
        assert_eq!(loaded.snapshot.format_version, SNAPSHOT_FORMAT_VERSION);
        assert_eq!(loaded.snapshot.settings.favorites, ["376"]);
        assert!(loaded.snapshot.settings.compact);
        assert!(loaded.snapshot.league_status.is_empty());
        assert_eq!(fs::read(&path).unwrap(), current.as_bytes());
        assert!(!sibling(&path, ".bak").exists());
    }

    #[test]
    fn future_snapshot_survives_load_reset_and_save_in_either_slot() {
        let future_version = SNAPSHOT_FORMAT_VERSION + 1;
        // A newer version need not have the same field types as this version.
        let future = format!(r#"{{"formatVersion":{future_version},"settings":"new schema"}}"#);
        let legacy = old();
        let current = next();
        let damaged = b"damaged primary".as_slice();
        for (primary, backup, can_load) in [
            (Some(future.as_bytes()), legacy.as_slice(), false),
            (None, future.as_bytes(), false),
            (Some(damaged), future.as_bytes(), false),
            (Some(current.as_slice()), future.as_bytes(), true),
        ] {
            let dir = Directory::new();
            let path = dir.primary();
            let backup_path = sibling(&path, ".bak");
            if let Some(bytes) = primary {
                fs::write(&path, bytes).unwrap();
            }
            fs::write(&backup_path, backup).unwrap();

            let expect_unsupported = |error: String| {
                assert!(error.contains(&format!("newer snapshot format version {future_version}")));
            };
            if can_load {
                assert!(load(&path).is_ok());
            } else {
                expect_unsupported(load(&path).err().unwrap());
            }
            expect_unsupported(start_over(&path).err().unwrap());
            if primary == Some(damaged) {
                assert!(save(&path, &Snapshot::default()).is_err());
            } else {
                expect_unsupported(save(&path, &Snapshot::default()).unwrap_err());
            }
            assert_eq!(fs::read(&path).ok().as_deref(), primary);
            assert_eq!(fs::read(&backup_path).unwrap(), backup);
            assert_eq!(
                fs::read_dir(&dir.0).unwrap().count(),
                1 + usize::from(primary.is_some())
            );
        }
    }

    #[test]
    fn disk_round_trip_preserves_full_snapshot_and_prior_backup() {
        let dir = Directory::new();
        let path = dir.primary();
        let mut snapshot = Snapshot::default();
        snapshot.matches = crate::demo::mock();
        snapshot.updated_at = Some("2026-10-28T12:00:00Z".into());
        snapshot.fixture_updated_at = snapshot.updated_at.clone();
        snapshot.error = Some("cached provider diagnostic".into());
        snapshot.fixture_error = Some("month unavailable".into());
        snapshot.score_error = Some("day partially unavailable".into());
        snapshot.partial = true;
        snapshot.matches[0].score_stale = true;
        snapshot.notification_retry_after = Some("2026-10-28T12:30:00Z".into());
        snapshot
            .pending_notifications
            .push(crate::model::PendingNotification {
                id: "fixture-1:start".into(),
                match_id: "fixture-1".into(),
                home_team: "359".into(),
                away_team: "363".into(),
                body: "Arsenal vs Chelsea is underway".into(),
                kind: crate::model::NotificationKind::Start,
                created_at: "2026-10-28T12:00:00Z".into(),
                expires_at: "2026-10-28T12:10:00Z".into(),
                next_attempt_at: "2026-10-28T12:01:00Z".into(),
                attempts: 2,
            });
        snapshot.settings.favorites = vec!["370".into()];
        snapshot.settings.compact = true;
        snapshot.settings.match_alerts.insert(
            "fixture-1".into(),
            crate::model::MatchAlert {
                enabled: true,
                expires_at: "2026-12-01T12:00:00Z".into(),
            },
        );
        snapshot.sent_notifications = vec!["fixture-1:score:1:0".into()];
        snapshot.expanded_size = Some(crate::model::ExpandedSize {
            width: 480.0,
            height: 820.0,
        });
        snapshot.alert_baselines.insert(
            "fixture-1".into(),
            crate::model::AlertBaseline {
                priming: false,
                status: "live".into(),
                home: Some(1),
                away: Some(0),
                high_water: 1,
                seen_at: "2026-10-28T12:00:00Z".into(),
                reminder_kickoff: None,
            },
        );
        let expected = serde_json::to_value(&snapshot).unwrap();
        save(&path, &snapshot).unwrap();
        assert_eq!(
            serde_json::to_value(load(&path).unwrap().snapshot).unwrap(),
            expected
        );
        snapshot.settings.theme = crate::model::Theme::Light;
        save(&path, &snapshot).unwrap();
        assert_eq!(
            serde_json::to_value(validate(&fs::read(sibling(&path, ".bak")).unwrap()).unwrap())
                .unwrap(),
            expected
        );
        fs::write(&path, b"interrupted legacy write").unwrap();
        let recovered = load(&path).unwrap();
        assert!(recovered.notice.is_some());
        assert_eq!(serde_json::to_value(recovered.snapshot).unwrap(), expected);
        assert!(fs::read_dir(&dir.0).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains(".corrupt-")));
    }

    #[test]
    fn partial_write_sync_and_replace_failures_never_truncate_target() {
        let dir = Directory::new();
        let path = dir.primary();
        fs::write(&path, old()).unwrap();
        let result = atomic_write(
            &path,
            &next(),
            |file, bytes| {
                file.write_all(&bytes[..3])?;
                Err(io::Error::from_raw_os_error(112)) // Windows ERROR_DISK_FULL
            },
            |from, to| fs::rename(from, to),
        );
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), old());
        let result = atomic_write(
            &path,
            &next(),
            |file, bytes| {
                file.write_all(bytes)?;
                Err(io::Error::other("injected sync failure"))
            },
            |from, to| fs::rename(from, to),
        );
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), old());
        let result = atomic_write(&path, &next(), write_synced, |_, _| {
            Err(io::ErrorKind::PermissionDenied.into())
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), old());
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn abandoned_temporary_files_are_swept_at_launch_but_archives_survive() {
        let dir = Directory::new();
        let path = dir.primary();
        fs::write(&path, old()).unwrap();
        let orphan = sibling(&path, ".tmp-4242-0");
        fs::write(&orphan, b"partial temp").unwrap();
        let other = dir.0.join("unrelated.tmp-1-1");
        fs::write(&other, b"not state debris").unwrap();
        let archive = sibling(&path, ".corrupt-4242-0");
        fs::write(&archive, b"diagnostic").unwrap();
        assert!(load(&path).unwrap().snapshot.settings.compact);
        assert!(!orphan.exists(), "temp debris is reclaimed at launch");
        assert_eq!(fs::read(&other).unwrap(), b"not state debris");
        assert_eq!(fs::read(&archive).unwrap(), b"diagnostic");
        save(&path, &Snapshot::default()).unwrap();
        assert_eq!(fs::read(sibling(&path, ".bak")).unwrap(), old());
    }

    #[test]
    fn corrupt_state_is_archived_before_starting_over() {
        let dir = Directory::new();
        let path = dir.primary();
        fs::write(&path, b"broken primary").unwrap();
        fs::write(sibling(&path, ".bak"), b"broken backup").unwrap();
        // Both copies damaged: the normal load reports a hard failure...
        assert!(load(&path).is_err());
        // ...but startup can archive both damaged copies and atomically publish defaults.
        let loaded = start_over(&path).unwrap();
        assert!(loaded.snapshot.matches.is_empty());
        assert!(loaded.notice.is_some());
        assert!(load(&path).is_ok());
        assert!(load(&sibling(&path, ".bak")).is_ok());
        save(&path, &loaded.snapshot).unwrap();
        assert!(path.exists());
    }
    #[test]
    fn startup_reset_preserves_unreadable_valid_and_unarchivable_state() {
        let fs = Memory::default();
        put(&fs, primary(), &old());
        put(&fs, &sibling(primary(), ".bak"), &next());
        let original = fs.files.borrow().clone();
        *fs.denied.borrow_mut() = Some(primary().into());
        assert!(start_over_with(&fs, primary()).is_err());
        assert_eq!(*fs.files.borrow(), original);
        *fs.denied.borrow_mut() = None;
        assert!(start_over_with(&fs, primary()).is_err());
        assert_eq!(*fs.files.borrow(), original);
        put(&fs, primary(), b"corrupt primary");
        put(&fs, &sibling(primary(), ".bak"), b"corrupt backup");
        let corrupt = fs.files.borrow().clone();
        *fs.failed_archive.borrow_mut() = true;
        assert!(start_over_with(&fs, primary()).is_err());
        assert_eq!(*fs.files.borrow(), corrupt);
        *fs.failed_archive.borrow_mut() = false;
        start_over_with(&fs, primary()).unwrap();
        assert_eq!(
            fs.read(&sibling(primary(), ".corrupt-test")).unwrap(),
            b"corrupt primary"
        );
        assert_eq!(
            fs.read(&sibling(primary(), ".bak.corrupt-test")).unwrap(),
            b"corrupt backup"
        );
        assert!(load_with(&fs, primary()).is_ok());
    }
    #[cfg(windows)]
    #[test]
    fn temporary_windows_sharing_failure_cannot_reset_saved_preferences() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = Directory::new();
        let path = dir.primary();
        fs::write(&path, old()).unwrap();
        fs::write(sibling(&path, ".bak"), next()).unwrap();
        // FILE_SHARE_DELETE allows the destructive old reset, while denying reads.
        let held = OpenOptions::new()
            .read(true)
            .share_mode(4)
            .open(&path)
            .unwrap();
        assert!(load(&path).is_err());
        assert!(start_over(&path).is_err());
        drop(held);
        assert_eq!(fs::read(&path).unwrap(), old());
        assert_eq!(fs::read(sibling(&path, ".bak")).unwrap(), next());
        assert!(load(&path).unwrap().snapshot.settings.compact);
    }

    #[test]
    fn oversized_state_is_moved_aside_not_parsed_and_backup_can_recover_it() {
        let fs = Memory::default();
        put(&fs, primary(), &vec![b' '; (MAX_STATE_BYTES + 1) as usize]);
        put(&fs, &sibling(primary(), ".bak"), &old());
        let loaded = load_with(&fs, primary()).unwrap();
        assert_eq!(loaded.snapshot.settings.favorites, ["370"]);
        let notice = loaded.notice.unwrap();
        assert!(notice.contains("Oversized") && notice.contains("Recovered"));
        // The oversized bytes were preserved by rename, never materialized.
        assert!(fs.read(primary()).is_ok());
        assert!(fs
            .files
            .borrow()
            .iter()
            .any(|(p, b)| p.to_string_lossy().contains(".corrupt-")
                && b.len() as u64 > MAX_STATE_BYTES));
        save_with(&fs, primary(), &next()).unwrap();
        assert_eq!(fs.read(&sibling(primary(), ".bak")).unwrap(), old());
    }

    #[test]
    fn oversized_primary_without_backup_is_a_hard_error_not_silent_defaults() {
        let fs = Memory::default();
        put(&fs, primary(), &vec![b' '; (MAX_STATE_BYTES + 1) as usize]);
        let error = load_with(&fs, primary()).err().unwrap();
        assert!(error.contains("Oversized") && error.contains("No backup"));
        // start_over is the documented escape: it can reset what load could not.
        put(&fs, primary(), &vec![b' '; (MAX_STATE_BYTES + 1) as usize]);
        assert!(start_over_with(&fs, primary()).is_ok());
        assert!(load_with(&fs, primary()).is_ok());
    }

    #[test]
    fn an_oversized_snapshot_saves_by_trimming_the_detail_cache_first() {
        // valid_cached bounds every field; the detail cache only scales through
        // events, each carrying up to 2000 chars of text.
        let detail = |id: usize, events: usize| {
            let text = "x".repeat(2000);
            serde_json::from_value::<crate::details::Details>(serde_json::json!({
                "matchId": id.to_string(),
                "updatedAt": "2026-10-28T12:00:00Z",
                "error": null,
                "stale": false,
                "events": (0..events)
                    .map(|n| serde_json::json!({
                        "id": format!("e{n}"),
                        "text": text,
                        "kind": "comment",
                        "minute": "1'",
                        "seconds": 0.0,
                        "period": 1
                    }))
                    .collect::<Vec<_>>(),
                "statistics": [],
                "players": []
            }))
            .unwrap()
        };
        let snapshot = |events: usize| Snapshot {
            detail_cache: (0..24).map(|i| detail(i, events)).collect(),
            ..Default::default()
        };
        // 24 entries x ~620KB serializes over the cap; the trimmed 8 fit under it.
        let bytes = snapshot_bytes(&snapshot(300)).unwrap();
        assert!(bytes.len() as u64 <= MAX_STATE_BYTES);
        let saved: Snapshot = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(saved.detail_cache.len(), 8);
        // Still over the cap after trimming: nothing may be written at all.
        let error = snapshot_bytes(&snapshot(900)).err().unwrap();
        assert!(error.contains("exceeds"));
    }
}
