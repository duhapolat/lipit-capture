mod binary;
mod clip;
mod history;
mod jobs;
mod media;
mod models;
pub mod native_messaging;
mod settings;
mod url_safety;

use std::sync::atomic::{AtomicU64, Ordering};

use jobs::JobManager;
use models::{
    AppError, AppSettings, DownloadJob, EngineUpdateResult, HistoryEntry, RequestContext,
    ResolvedMedia,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::{watch, Mutex};

#[derive(Default)]
struct ResolveManager {
    next_id: AtomicU64,
    current: Mutex<Option<(u64, watch::Sender<bool>)>>,
}

impl ResolveManager {
    async fn begin(&self) -> (u64, watch::Receiver<bool>) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (sender, receiver) = watch::channel(false);
        let mut current = self.current.lock().await;
        if let Some((_, previous)) = current.take() {
            let _ = previous.send(true);
        }
        *current = Some((id, sender));
        (id, receiver)
    }

    async fn finish(&self, id: u64) {
        let mut current = self.current.lock().await;
        if current
            .as_ref()
            .is_some_and(|(current_id, _)| *current_id == id)
        {
            *current = None;
        }
    }

    async fn cancel(&self) {
        if let Some((_, sender)) = self.current.lock().await.as_ref() {
            let _ = sender.send(true);
        }
    }
}

#[tauri::command]
async fn engine_versions(app: AppHandle) -> Result<models::EngineVersions, AppError> {
    binary::versions(&app).await
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<AppSettings, AppError> {
    settings::load(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), AppError> {
    settings::save(&app, &settings)
}

#[tauri::command]
fn quick_output_path(app: AppHandle, suggested_filename: String) -> Result<String, AppError> {
    settings::quick_output_path(&app, &suggested_filename)
}

#[tauri::command]
async fn update_ytdlp_engine(
    app: AppHandle,
    manager: State<'_, JobManager>,
) -> Result<EngineUpdateResult, AppError> {
    if manager.has_active().await {
        return Err(AppError::new(
            "ENGINE_BUSY",
            "Motoru güncellemeden önce aktif işlemlerin bitmesini bekleyin.",
        ));
    }
    binary::update_yt_dlp(&app).await
}

#[tauri::command]
async fn resolve_media(
    app: AppHandle,
    resolver: State<'_, ResolveManager>,
    url: String,
) -> Result<ResolvedMedia, AppError> {
    let (id, cancel) = resolver.begin().await;
    let result =
        media::resolve_with_context(&app, &url, &RequestContext::default(), Some(cancel)).await;
    resolver.finish(id).await;
    result
}

#[tauri::command]
async fn resolve_detected_candidate(
    app: AppHandle,
    resolver: State<'_, ResolveManager>,
    candidate: native_messaging::MediaCandidate,
) -> Result<ResolvedMedia, AppError> {
    native_messaging::validate_candidate(&candidate)?;
    let (id, cancel) = resolver.begin().await;
    let result = media::resolve_candidate(&app, &candidate, Some(cancel)).await;
    resolver.finish(id).await;
    result
}

#[tauri::command]
async fn cancel_resolution(resolver: State<'_, ResolveManager>) -> Result<(), AppError> {
    resolver.cancel().await;
    Ok(())
}

#[tauri::command]
fn drain_detected_candidates() -> Result<Vec<native_messaging::StoredCandidate>, AppError> {
    native_messaging::drain_candidates()
}

#[tauri::command]
fn repair_native_bridge() -> Result<native_messaging::NativeBridgeRepairResult, AppError> {
    native_messaging::repair_chromium_registration()
}

#[tauri::command]
async fn start_download(
    app: AppHandle,
    manager: State<'_, JobManager>,
    request: models::DownloadRequest,
) -> Result<DownloadJob, AppError> {
    manager.start(app, request).await
}

#[tauri::command]
async fn start_clip(
    app: AppHandle,
    manager: State<'_, JobManager>,
    request: models::ClipRequest,
) -> Result<DownloadJob, AppError> {
    manager.start_clip(app, request).await
}

#[tauri::command]
async fn cancel_download(
    app: AppHandle,
    manager: State<'_, JobManager>,
    job_id: String,
) -> Result<(), AppError> {
    manager.cancel(&app, &job_id).await
}

#[tauri::command]
async fn list_jobs(manager: State<'_, JobManager>) -> Result<Vec<DownloadJob>, AppError> {
    Ok(manager.list().await)
}

#[tauri::command]
fn list_history(app: AppHandle) -> Result<Vec<HistoryEntry>, AppError> {
    history::list(&app)
}

#[tauri::command]
fn clear_history(app: AppHandle) -> Result<(), AppError> {
    history::clear(&app)
}

#[tauri::command]
fn prepare_preview(app: AppHandle, history_id: String) -> Result<String, AppError> {
    history::authorize_preview(&app, &history_id)
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::new("WINDOW_UNAVAILABLE", "Ana pencere bulunamadı."))?;
    let _ = window.unminimize();
    window
        .show()
        .and_then(|()| window.set_focus())
        .map_err(|_| AppError::new("WINDOW_UNAVAILABLE", "Ana pencere gösterilemedi."))
}

#[tauri::command]
fn hide_main_window(app: AppHandle) -> Result<(), AppError> {
    app.get_webview_window("main")
        .ok_or_else(|| AppError::new("WINDOW_UNAVAILABLE", "Ana pencere bulunamadı."))?
        .hide()
        .map_err(|_| AppError::new("WINDOW_UNAVAILABLE", "Ana pencere gizlenemedi."))
}

#[tauri::command]
async fn open_quick_widget(app: AppHandle, job_id: String) -> Result<(), AppError> {
    validate_job_id(&job_id)?;
    let label = format!("quick-widget-{job_id}");
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    // App URLs are resolved as bundled asset paths. Adding the widget id as a
    // query here makes Windows WebView look for a non-existent asset and leaves
    // the quick window blank. The React side reads the id from the Tauri label.
    let url = WebviewUrl::App("widget.html".into());
    let mut builder = WebviewWindowBuilder::new(&app, &label, url)
        .title("Lipit hızlı işlem")
        .inner_size(360.0, 142.0)
        .min_inner_size(320.0, 132.0)
        .resizable(false)
        .decorations(false)
        // Tauri's Windows shadow adds a visible 1 px white frame to
        // undecorated windows. The widget draws its own border and shadow.
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .background_color(tauri::window::Color(13, 17, 19, 255))
        .transparent(false)
        .visible(true);
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let width = size.width as f64 / scale;
        builder = builder.position((width - 380.0).max(12.0), 22.0);
    }
    builder
        .build()
        .map(|_| ())
        .map_err(|_| AppError::new("WINDOW_UNAVAILABLE", "İlerleme penceresi açılamadı."))
}

#[tauri::command]
fn fail_quick_widget(app: AppHandle, widget_id: String, message: String) -> Result<(), AppError> {
    validate_job_id(&widget_id)?;
    if message.len() > 500 {
        return Err(AppError::new("INVALID_MESSAGE", "Hata mesajı çok uzun."));
    }
    let label = format!("quick-widget-{widget_id}");
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| AppError::new("WINDOW_UNAVAILABLE", "İlerleme penceresi bulunamadı."))?;
    window
        .emit("quick-widget-failed", message)
        .map_err(|_| AppError::new("WINDOW_UNAVAILABLE", "İlerleme penceresi güncellenemedi."))
}

#[tauri::command]
async fn close_quick_widget(
    app: AppHandle,
    manager: State<'_, JobManager>,
    job_id: String,
) -> Result<(), AppError> {
    validate_job_id(&job_id)?;
    let label = format!("quick-widget-{job_id}");
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }
    let main_hidden = app
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        == Some(false);
    if main_hidden && !manager.has_active().await {
        app.exit(0);
    }
    Ok(())
}

fn validate_job_id(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(AppError::new("INVALID_JOB", "İşlem kimliği geçersiz."));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if !acquire_single_instance() {
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(JobManager::default())
        .manage(ResolveManager::default())
        .setup(|app| {
            jobs::cleanup_stale_cache(app.handle());
            native_messaging::cleanup_stale_files();
            let quick_background = std::env::args().any(|arg| arg == "--quick-background");
            if !quick_background {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine_versions,
            get_settings,
            save_settings,
            quick_output_path,
            update_ytdlp_engine,
            resolve_media,
            resolve_detected_candidate,
            cancel_resolution,
            drain_detected_candidates,
            repair_native_bridge,
            start_download,
            start_clip,
            cancel_download,
            list_jobs,
            list_history,
            clear_history,
            prepare_preview,
            show_main_window,
            hide_main_window,
            open_quick_widget,
            fail_quick_widget,
            close_quick_widget
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lipit Capture");
}

#[cfg(windows)]
fn acquire_single_instance() -> bool {
    use std::sync::OnceLock;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS},
        System::Threading::CreateMutexW,
    };

    static INSTANCE_HANDLE: OnceLock<usize> = OnceLock::new();
    let name: Vec<u16> = "Local\\LipitCaptureDesktop-4A85B949\0"
        .encode_utf16()
        .collect();
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    if handle.is_null() {
        return true;
    }
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        unsafe { CloseHandle(handle) };
        return false;
    }
    let _ = INSTANCE_HANDLE.set(handle as usize);
    true
}

#[cfg(not(windows))]
fn acquire_single_instance() -> bool {
    true
}
