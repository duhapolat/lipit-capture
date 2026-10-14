//! Local usage statistics. They stay on this computer and are only shown in
//! Settings, so product decisions can rely on real numbers without telemetry.

use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::models::AppError;

const STATS_FILE: &str = "stats.json";
const MAX_KEYS: usize = 50;

static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Stats {
    pub since_ms: u64,
    pub completed: u64,
    pub failed: u64,
    pub cancelled: u64,
    pub quick_started: u64,
    pub quick_completed: u64,
    pub quick_failed: u64,
    pub error_codes: BTreeMap<String, u64>,
    pub source_hosts: BTreeMap<String, u64>,
}

pub enum Event<'a> {
    Completed { host: Option<&'a str> },
    Failed { code: &'a str },
    Cancelled,
    QuickStarted,
    QuickCompleted,
    QuickFailed { code: &'a str },
}

pub fn record(app: &AppHandle, event: Event<'_>) {
    let Ok(_guard) = LOCK.lock() else { return };
    let Ok(path) = stats_path(app) else { return };
    let mut stats = read(&path);
    match event {
        Event::Completed { host } => {
            stats.completed += 1;
            if let Some(host) = host {
                bump(&mut stats.source_hosts, host.trim_start_matches("www."));
            }
        }
        Event::Failed { code } => {
            stats.failed += 1;
            bump(&mut stats.error_codes, code);
        }
        Event::Cancelled => stats.cancelled += 1,
        Event::QuickStarted => stats.quick_started += 1,
        Event::QuickCompleted => stats.quick_completed += 1,
        Event::QuickFailed { code } => {
            stats.quick_failed += 1;
            bump(&mut stats.error_codes, code);
        }
    }
    let _ = write(&path, &stats);
}

pub fn load(app: &AppHandle) -> Result<Stats, AppError> {
    let path = stats_path(app)?;
    Ok(read(&path))
}

pub fn reset(app: &AppHandle) -> Result<(), AppError> {
    let _guard = LOCK
        .lock()
        .map_err(|_| AppError::new("STATS_UNAVAILABLE", "İstatistikler okunamadı."))?;
    let path = stats_path(app)?;
    write(&path, &fresh())
        .map_err(|_| AppError::new("STATS_UNAVAILABLE", "İstatistikler sıfırlanamadı."))
}

fn bump(map: &mut BTreeMap<String, u64>, key: &str) {
    if key.is_empty() {
        return;
    }
    if map.len() >= MAX_KEYS && !map.contains_key(key) {
        *map.entry("diğer".into()).or_default() += 1;
        return;
    }
    *map.entry(key.into()).or_default() += 1;
}

fn fresh() -> Stats {
    Stats {
        since_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .try_into()
            .unwrap_or_default(),
        ..Stats::default()
    }
}

fn read(path: &PathBuf) -> Stats {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(fresh)
}

fn write(path: &PathBuf, stats: &Stats) -> std::io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
    fs::create_dir_all(parent)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(&mut temporary, stats)?;
    temporary.flush()?;
    temporary
        .persist(path)
        .map(|_| ())
        .map_err(|error| error.error)
}

fn stats_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join(STATS_FILE))
        .map_err(|_| AppError::new("STATS_UNAVAILABLE", "İstatistik klasörü bulunamadı."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caps_the_number_of_tracked_keys() {
        let mut map = BTreeMap::new();
        for index in 0..(MAX_KEYS + 5) {
            bump(&mut map, &format!("host{index}"));
        }
        assert_eq!(map.len(), MAX_KEYS + 1);
        assert_eq!(map.get("diğer"), Some(&5));
    }
}
