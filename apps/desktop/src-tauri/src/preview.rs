//! Single preview frames for the clip range editor.
//!
//! The UI cannot play arbitrary remote streams (CSP, headers, HLS), so the
//! selected start and end points are rendered by FFmpeg as small JPEG files in
//! the cache directory and shown through the asset protocol.

use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use tauri::{AppHandle, Manager};

use crate::{
    binary::{self, Binary},
    clip, history,
    models::{AppError, PreviewSource},
    settings, url_safety,
};

const KEEP_FRAMES: usize = 24;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub async fn frame_at(
    app: &AppHandle,
    source: &PreviewSource,
    position_ms: u64,
) -> Result<String, AppError> {
    let url = url_safety::validate_public_http_url(&source.url, 8192)?;
    url_safety::ensure_public_resolution(&url).await?;
    if position_ms > 7 * 24 * 60 * 60 * 1000 {
        return Err(AppError::new(
            "INVALID_POSITION",
            "Önizleme zamanı geçersiz.",
        ));
    }
    let directory = frame_dir(app)?;
    fs::create_dir_all(&directory)
        .map_err(|_| AppError::new("PREVIEW_UNAVAILABLE", "Önizleme klasörü oluşturulamadı."))?;
    prune(&directory);
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let target = directory.join(format!("frame-{}-{sequence}.jpg", std::process::id()));
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-y".into(),
        "-ss".into(),
        clip::seconds(position_ms),
        "-protocol_whitelist".into(),
        "http,https,tcp,tls,crypto,httpproxy".into(),
    ];
    args.extend(settings::ffmpeg_input_args(&source.request_context)?);
    args.extend([
        "-i".into(),
        url.to_string(),
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        "scale=480:-2".into(),
        "-q:v".into(),
        "6".into(),
        target.to_string_lossy().into_owned(),
    ]);
    binary::run(
        app,
        Binary::Ffmpeg,
        &args,
        Duration::from_secs(25),
        None,
        |_, _| {},
    )
    .await
    .map_err(|_| {
        AppError::new(
            "PREVIEW_UNAVAILABLE",
            "Bu noktanın önizleme karesi alınamadı.",
        )
    })?;
    if !target.is_file() {
        return Err(AppError::new(
            "PREVIEW_UNAVAILABLE",
            "Bu noktanın önizleme karesi alınamadı.",
        ));
    }
    history::authorize_asset(app, &target)
}

fn frame_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_cache_dir()
        .map(|path| path.join("frames"))
        .map_err(|_| AppError::new("PREVIEW_UNAVAILABLE", "Önizleme klasörü bulunamadı."))
}

fn prune(directory: &std::path::Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.path()))
        })
        .collect();
    files.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    for (_, path) in files.into_iter().skip(KEEP_FRAMES) {
        let _ = fs::remove_file(path);
    }
}

/// Removes all cached frames (called on startup).
pub fn clear(app: &AppHandle) {
    if let Ok(directory) = frame_dir(app) {
        let _ = fs::remove_dir_all(directory);
    }
}
