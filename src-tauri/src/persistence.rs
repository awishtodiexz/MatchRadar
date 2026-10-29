//! Snapshot replacement and recovery. Callers serialize saves with the snapshot lock.
use crate::model::Snapshot;
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
    load_with(&Disk, path)
}

pub fn save(path: &Path, snapshot: &Snapshot) -> Result<(), String> {
    let bytes =
        serde_json::to_vec(snapshot).map_err(|e| format!("Serialize MatchRadar state: {e}"))?;
    save_with(&Disk, path, &bytes)
}

// A small seam for deterministic read/write/replace failures, without OS permission tricks.
trait Storage {
    fn read(&self, path: &Path) -> io::Result<Vec<u8>>;
    fn publish(&self, path: &Path, bytes: &[u8]) -> io::Result<()>;
    fn archive(&self, path: &Path, bytes: &[u8]) -> io::Result<PathBuf>;
}

enum Existing {
    Missing,
    Valid(Vec<u8>, Snapshot),
    Invalid(Vec<u8>, String),
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    name.into()
}

fn validate(bytes: &[u8]) -> Result<Snapshot, String> {
    serde_json::from_slice(bytes).map_err(|e| e.to_string())
}

fn inspect(storage: &impl Storage, path: &Path) -> Result<Existing, String> {
    match storage.read(path) {
        Ok(bytes) => Ok(match validate(&bytes) {
            Ok(snapshot) => Existing::Valid(bytes, snapshot),
            Err(error) => Existing::Invalid(bytes, error),
        }),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Existing::Missing),
        // Permission failures are not a new installation or evidence of corruption.
        Err(error) => Err(format!(
            "Read MatchRadar state {}: {error}; no defaults were written",
            path.display()
        )),
    }
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
    if let Existing::Valid(_, snapshot) = primary {
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
    match backup {
        Existing::Valid(bytes, snapshot) => {
            // Restore without rotating the damaged primary into the valid backup.
            publish(storage, path, &bytes)?;
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
            // Only bytes that deserialize successfully may replace the backup.
            publish(storage, &backup_path, previous)?;
        }
        Existing::Missing => {
            match backup {
                Existing::Missing => publish(storage, &backup_path, bytes)?,
                Existing::Valid(_, _) => (), // Preserve existing recovery data.
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
    fn abandoned_temporary_files_are_not_promoted_or_overwritten() {
        let dir = Directory::new();
        let path = dir.primary();
        fs::write(&path, old()).unwrap();
        let orphan = sibling(&path, ".tmp-abandoned");
        fs::write(&orphan, b"partial temp").unwrap();
        assert!(load(&path).unwrap().snapshot.settings.compact);
        save(&path, &Snapshot::default()).unwrap();
        assert_eq!(fs::read(&orphan).unwrap(), b"partial temp");
        assert_eq!(fs::read(sibling(&path, ".bak")).unwrap(), old());
    }
}
