use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager};
use url::Url;

use crate::{
    clip::ClipSpec,
    models::{AppError, DownloadRequest, HistoryEntry, JobKind},
};

const HISTORY_FILE: &str = "history.json";
const MAX_HISTORY_ENTRIES: usize = 200;
const MAX_HISTORY_BYTES: u64 = 2 * 1024 * 1024;

pub fn record_completed(
    app: &AppHandle,
    id: &str,
    request: &DownloadRequest,
    clip: Option<ClipSpec>,
    destination: &Path,
) -> Result<(), AppError> {
    let metadata = fs::metadata(destination)
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Çıktı bilgisi okunamadı."))?;
    let title = destination
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Video")
        .to_owned();
    let source_host = Url::parse(&request.url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| "Yerel medya".into());
    let entry = HistoryEntry {
        id: id.to_owned(),
        kind: if clip.is_some() {
            JobKind::Clip
        } else {
            JobKind::Download
        },
        title,
        source_host,
        output_path: destination.to_string_lossy().into_owned(),
        completed_at_ms: now_ms(),
        size_bytes: metadata.len(),
        file_exists: true,
        quality_height: request.quality_height,
        start_ms: clip.map(|value| value.start_ms),
        end_ms: clip.map(|value| value.end_ms),
        clip_mode: clip.map(|value| value.mode),
    };
    let mut entries = load_file(app)?;
    entries.retain(|current| current.id != entry.id && current.output_path != entry.output_path);
    entries.insert(0, entry);
    entries.truncate(MAX_HISTORY_ENTRIES);
    save_file(app, &entries)
}

pub fn list(app: &AppHandle) -> Result<Vec<HistoryEntry>, AppError> {
    let mut entries = load_file(app)?;
    for entry in &mut entries {
        let path = Path::new(&entry.output_path);
        entry.file_exists = path.is_file();
        if let Ok(metadata) = fs::metadata(path) {
            entry.size_bytes = metadata.len();
        }
    }
    Ok(entries)
}

pub fn clear(app: &AppHandle) -> Result<(), AppError> {
    save_file(app, &[])
}

pub fn authorize_preview(app: &AppHandle, history_id: &str) -> Result<String, AppError> {
    let entry = load_file(app)?
        .into_iter()
        .find(|entry| entry.id == history_id)
        .ok_or_else(|| AppError::new("HISTORY_NOT_FOUND", "Geçmiş kaydı bulunamadı."))?;
    let path = PathBuf::from(entry.output_path);
    if !path.is_absolute()
        || !path.is_file()
        || path
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|value| !value.eq_ignore_ascii_case("mp4"))
    {
        return Err(AppError::new(
            "PREVIEW_UNAVAILABLE",
            "Önizleme dosyası artık mevcut değil.",
        ));
    }
    let canonical = fs::canonicalize(&path)
        .map_err(|_| AppError::new("PREVIEW_UNAVAILABLE", "Dosya açılamadı."))?;
    app.asset_protocol_scope()
        .allow_file(&canonical)
        .map_err(|_| AppError::new("PREVIEW_UNAVAILABLE", "Dosya önizlemeye açılamadı."))?;
    Ok(path.to_string_lossy().into_owned())
}

fn load_file(app: &AppHandle) -> Result<Vec<HistoryEntry>, AppError> {
    let path = history_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let metadata = fs::metadata(&path)
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş okunamadı."))?;
    if metadata.len() > MAX_HISTORY_BYTES {
        return Err(AppError::new("HISTORY_INVALID", "Geçmiş dosyası geçersiz."));
    }
    let bytes =
        fs::read(path).map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş okunamadı."))?;
    let mut entries: Vec<HistoryEntry> = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::new("HISTORY_INVALID", "Geçmiş dosyası geçersiz."))?;
    entries.truncate(MAX_HISTORY_ENTRIES);
    Ok(entries)
}

fn save_file(app: &AppHandle, entries: &[HistoryEntry]) -> Result<(), AppError> {
    let path = history_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş klasörü bulunamadı."))?;
    fs::create_dir_all(parent)
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş klasörü oluşturulamadı."))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş kaydedilemedi."))?;
    serde_json::to_writer_pretty(&mut temporary, entries)
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş kaydedilemedi."))?;
    temporary
        .flush()
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş kaydedilemedi."))?;
    temporary
        .persist(path)
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş kaydedilemedi."))?;
    Ok(())
}

fn history_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(HISTORY_FILE))
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş klasörü bulunamadı."))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
