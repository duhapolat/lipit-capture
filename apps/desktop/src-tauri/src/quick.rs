//! Browser hand-off and quick actions.
//!
//! The native host writes each request from the extension into an inbox. This
//! service drains the inbox and:
//! - forwards "open in Lipit" requests to the main window, and
//! - runs quick download / quick clip requests itself, one after another.
//!
//! Quick actions used to run inside the (often hidden) main WebView and shared
//! the single manual-resolution slot, so a second click could cancel or drop
//! the first. Here every request is queued and none can cancel another.

use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::mpsc;

use crate::{
    clip::{ClipSpec, MAX_CLIP_DURATION_MS},
    filename,
    jobs::JobManager,
    log, media,
    models::{
        AppError, AppSettings, ClipRequest, DestinationMode, DownloadJob, DownloadRequest, JobKind,
        QualityProfile,
    },
    native_messaging::{self, CaptureAction, StoredCandidate},
    settings, stats,
};

const POLL_INTERVAL: Duration = Duration::from_millis(400);

#[derive(Clone, Default)]
pub struct QuickService {
    /// "Open in Lipit" requests waiting for the main window to pick them up.
    pending: Arc<Mutex<VecDeque<StoredCandidate>>>,
    /// Quick actions received but not yet turned into jobs.
    in_flight: Arc<AtomicUsize>,
}

impl QuickService {
    pub fn take_pending(&self) -> Vec<StoredCandidate> {
        self.pending
            .lock()
            .map(|mut pending| pending.drain(..).collect())
            .unwrap_or_default()
    }

    pub fn is_busy(&self) -> bool {
        self.in_flight.load(Ordering::SeqCst) > 0
    }
}

pub fn start(app: AppHandle) {
    let (sender, receiver) = mpsc::unbounded_channel::<StoredCandidate>();
    let worker_app = app.clone();
    tauri::async_runtime::spawn(async move { run_quick_queue(worker_app, receiver).await });
    tauri::async_runtime::spawn(async move {
        loop {
            match native_messaging::drain_candidates() {
                Ok(candidates) => {
                    for stored in candidates {
                        dispatch(&app, &sender, stored);
                    }
                }
                Err(error) => log::warn(format!("Tarayıcı kutusu okunamadı: {}", error.code)),
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
}

fn dispatch(
    app: &AppHandle,
    sender: &mpsc::UnboundedSender<StoredCandidate>,
    stored: StoredCandidate,
) {
    let service = app.state::<QuickService>();
    match stored.action {
        CaptureAction::QuickDownload | CaptureAction::QuickClip => {
            service.in_flight.fetch_add(1, Ordering::SeqCst);
            stats::record(app, stats::Event::QuickStarted);
            // Show progress immediately, even if earlier requests are still running.
            let _ = crate::open_widget(app, &stored.candidate.id);
            if sender.send(stored).is_err() {
                service.in_flight.fetch_sub(1, Ordering::SeqCst);
            }
        }
        CaptureAction::Download | CaptureAction::Clip => hand_to_main_window(app, stored),
    }
}

fn hand_to_main_window(app: &AppHandle, stored: StoredCandidate) {
    if let Ok(mut pending) = app.state::<QuickService>().pending.lock() {
        pending.push_back(stored);
        while pending.len() > 20 {
            pending.pop_front();
        }
    }
    let _ = crate::show_main(app);
    let _ = app.emit("candidates-available", ());
}

async fn run_quick_queue(app: AppHandle, mut receiver: mpsc::UnboundedReceiver<StoredCandidate>) {
    while let Some(stored) = receiver.recv().await {
        let widget_id = stored.candidate.id.clone();
        let result = run_quick_action(&app, &stored).await;
        match result {
            Ok(QuickOutcome::Started(job)) => {
                stats::record(&app, stats::Event::QuickCompleted);
                log::info(format!("Hızlı işlem iş {} olarak başladı.", job.id));
                let _ = crate::open_widget(&app, &job.id);
                close_widget(&app, &widget_id);
            }
            Ok(QuickOutcome::NeedsSetup) => {
                // Explain in the progress window why nothing started, and open
                // the main window where the setup guide is waiting.
                let _ = crate::fail_widget(
                    &app,
                    &widget_id,
                    "Hızlı işlemler için önce Lipit'te kurulumu tamamla ve kullanım koşullarını onayla.",
                );
                hand_to_main_window(&app, stored.clone());
            }
            Ok(QuickOutcome::Cancelled) => close_widget(&app, &widget_id),
            Err(error) => {
                stats::record(&app, stats::Event::QuickFailed { code: error.code });
                log::warn(format!("Hızlı işlem başarısız: {}", error.code));
                let _ = crate::fail_widget(&app, &widget_id, &error.message);
            }
        }
        app.state::<QuickService>()
            .in_flight
            .fetch_sub(1, Ordering::SeqCst);
    }
}

enum QuickOutcome {
    Started(Box<DownloadJob>),
    NeedsSetup,
    Cancelled,
}

async fn run_quick_action(
    app: &AppHandle,
    stored: &StoredCandidate,
) -> Result<QuickOutcome, AppError> {
    let settings = settings::load(app)?;
    if !(settings.onboarding_completed && settings.terms_accepted) {
        return Ok(QuickOutcome::NeedsSetup);
    }
    native_messaging::validate_candidate(&stored.candidate)?;
    let media = media::resolve_candidate(app, &stored.candidate, None).await?;
    let is_clip = matches!(stored.action, CaptureAction::QuickClip);
    if !is_clip && media.is_live {
        return Err(AppError::new(
            "LIVE_DOWNLOAD_REQUIRES_CLIP",
            "Canlı yayınlarda tamamını indirmek yerine hızlı klip kullanın.",
        ));
    }
    let host = url::Url::parse(&stored.candidate.page_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned));
    let kind = if is_clip {
        JobKind::Clip
    } else {
        JobKind::Download
    };
    let suggested = filename::suggest(
        &media.title,
        host.as_deref(),
        kind,
        settings.filename_template,
    );
    let Some((output_path, auto_rename)) = output_path(app, &settings, &suggested, is_clip).await?
    else {
        return Ok(QuickOutcome::Cancelled);
    };
    let quality_height =
        quick_quality_height(&media.profiles, settings.quick_profile.quality_height);
    let manager = app.state::<JobManager>();
    let job = if is_clip {
        let (start_ms, end_ms) = initial_clip_range(
            media.duration_ms,
            stored.candidate.current_time_ms.unwrap_or(0),
            settings.quick_profile.clip_duration_ms,
        );
        ClipSpec {
            start_ms,
            end_ms,
            mode: settings.quick_profile.clip_mode,
        }
        .validate(media.duration_ms)?;
        manager
            .start_clip(
                app.clone(),
                ClipRequest {
                    url: media.url.clone(),
                    quality_height,
                    output_path,
                    direct: media.direct,
                    refresh_url: media.refresh_url.clone(),
                    start_ms,
                    end_ms,
                    mode: settings.quick_profile.clip_mode,
                    known_duration_ms: media.duration_ms,
                    request_context: media.request_context.clone(),
                    auto_rename,
                },
            )
            .await?
    } else {
        manager
            .start(
                app.clone(),
                DownloadRequest {
                    url: media.url.clone(),
                    quality_height,
                    output_path,
                    direct: media.direct,
                    refresh_url: media.refresh_url.clone(),
                    known_duration_ms: media.duration_ms,
                    request_context: media.request_context.clone(),
                    auto_rename,
                },
            )
            .await?
    };
    Ok(QuickOutcome::Started(Box::new(job)))
}

async fn output_path(
    app: &AppHandle,
    settings: &AppSettings,
    suggested: &str,
    is_clip: bool,
) -> Result<Option<(String, bool)>, AppError> {
    if matches!(
        settings.quick_profile.destination_mode,
        DestinationMode::Folder
    ) {
        return settings::quick_output_path(app, suggested).map(|path| Some((path, true)));
    }
    let dialog = app
        .dialog()
        .file()
        .set_title(if is_clip {
            "Klibi MP4 olarak kaydet"
        } else {
            "MP4 dosyasını kaydet"
        })
        .set_file_name(suggested)
        .add_filter("MP4 Video", &["mp4"]);
    let chosen = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|_| AppError::new("DIALOG_FAILED", "Kayıt penceresi açılamadı."))?;
    Ok(chosen
        .and_then(|path| path.into_path().ok())
        .map(|path| (path.to_string_lossy().into_owned(), false)))
}

fn close_widget(app: &AppHandle, widget_id: &str) {
    if let Some(window) = app.get_webview_window(&format!("quick-widget-{widget_id}")) {
        let _ = window.close();
    }
}

/// Highest available quality not above the preferred height, otherwise the lowest.
pub fn quick_quality_height(profiles: &[QualityProfile], preferred: Option<u32>) -> Option<u32> {
    let Some(preferred) = preferred else {
        return profiles.first().and_then(|profile| profile.height);
    };
    let mut available: Vec<u32> = profiles
        .iter()
        .filter_map(|profile| profile.height)
        .collect();
    available.sort_unstable_by(|left, right| right.cmp(left));
    available
        .iter()
        .copied()
        .find(|height| *height <= preferred)
        .or_else(|| available.last().copied())
}

/// Clip range starting at the browser's playback position, clamped to the video.
pub fn initial_clip_range(
    duration_ms: Option<u64>,
    requested_start: u64,
    clip_ms: u64,
) -> (u64, u64) {
    let clip_ms = clip_ms.clamp(100, MAX_CLIP_DURATION_MS);
    let known_end = duration_ms.unwrap_or(requested_start + clip_ms);
    let start = requested_start.min(known_end.saturating_sub(100));
    let end = known_end.min((start + 100).max(start + clip_ms));
    (start, end)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(height: Option<u32>) -> QualityProfile {
        QualityProfile {
            height,
            label: String::new(),
            fps: None,
        }
    }

    #[test]
    fn picks_nearest_lower_quality() {
        let profiles = [
            profile(None),
            profile(Some(1080)),
            profile(Some(720)),
            profile(Some(360)),
        ];
        assert_eq!(quick_quality_height(&profiles, None), None);
        assert_eq!(quick_quality_height(&profiles, Some(1440)), Some(1080));
        assert_eq!(quick_quality_height(&profiles, Some(480)), Some(360));
        assert_eq!(quick_quality_height(&profiles[..2], Some(480)), Some(1080));
    }

    #[test]
    fn clamps_clip_ranges_to_the_video() {
        assert_eq!(
            initial_clip_range(Some(60_000), 10_000, 30_000),
            (10_000, 40_000)
        );
        assert_eq!(
            initial_clip_range(Some(60_000), 50_000, 30_000),
            (50_000, 60_000)
        );
        assert_eq!(
            initial_clip_range(Some(60_000), 90_000, 30_000),
            (59_900, 60_000)
        );
        assert_eq!(initial_clip_range(None, 5_000, 15_000), (5_000, 20_000));
    }
}
