mod binary;
mod clip;
mod filename;
mod history;
mod jobs;
mod log;
mod media;
mod models;
pub mod native_messaging;
mod preview;
mod quick;
mod settings;
mod stats;
mod url_safety;

use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use jobs::JobManager;
use models::{
    AppError, AppSettings, DownloadJob, EngineUpdateResult, FilenameTemplate, HistoryEntry,
    JobKind, PreviewSource, RequestContext, ResolvedMedia,
};
use quick::QuickService;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::{watch, Mutex};

const SOURCE_REPOSITORY: &str = "https://github.com/duhapolat/lipit-capture";
const LEGAL_DOCUMENTS: [&str; 5] = [
    "KULLANIM-KOSULLARI.md",
    "GIZLILIK.md",
    "PRIVACY.md",
    "THIRD_PARTY_NOTICES.md",
    "LICENSE",
];

/// Only one manual (user-initiated) resolution runs at a time; starting a new
/// one cancels the previous. Quick actions do not use this slot.
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
fn take_notices() -> Vec<String> {
    settings::take_notices()
}

#[tauri::command]
fn quick_output_path(app: AppHandle, suggested_filename: String) -> Result<String, AppError> {
    settings::quick_output_path(&app, &suggested_filename)
}

#[tauri::command]
fn suggest_filename(
    title: String,
    source_host: Option<String>,
    kind: JobKind,
    template: FilenameTemplate,
) -> Result<String, AppError> {
    if title.len() > 2048 || source_host.as_ref().is_some_and(|host| host.len() > 255) {
        return Err(AppError::new(
            "INVALID_DESTINATION",
            "Dosya adı bilgisi çok uzun.",
        ));
    }
    Ok(filename::suggest(
        &title,
        source_host.as_deref(),
        kind,
        template,
    ))
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
    let result = binary::update_yt_dlp(&app).await;
    match &result {
        Ok(update) => log::info(format!("yt-dlp sürümü: {}", update.current_version)),
        Err(error) => log::warn(format!("yt-dlp güncellemesi başarısız: {}", error.code)),
    }
    result
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
async fn preview_frame(
    app: AppHandle,
    source: PreviewSource,
    position_ms: u64,
) -> Result<String, AppError> {
    preview::frame_at(&app, &source, position_ms).await
}

#[tauri::command]
fn take_pending_candidates(
    service: State<'_, QuickService>,
) -> Vec<native_messaging::StoredCandidate> {
    service.take_pending()
}

#[tauri::command]
fn repair_native_bridge() -> Result<native_messaging::NativeBridgeRepairResult, AppError> {
    native_messaging::repair_chromium_registration()
}

#[tauri::command]
fn extension_status(app: AppHandle) -> native_messaging::ExtensionStatus {
    native_messaging::extension_status(app.path().resource_dir().ok())
}

#[tauri::command]
fn open_extension_folder(app: AppHandle) -> Result<(), AppError> {
    let folder = native_messaging::extension_status(app.path().resource_dir().ok())
        .extension_folder
        .ok_or_else(|| {
            AppError::new(
                "EXTENSION_UNAVAILABLE",
                "Uzantı klasörü bulunamadı. Lipit kurulumunu yeniden çalıştırın.",
            )
        })?;
    open_folder(Path::new(&folder))
}

#[tauri::command]
fn open_log_folder() -> Result<(), AppError> {
    let folder = log::directory()
        .ok_or_else(|| AppError::new("LOG_UNAVAILABLE", "Günlük klasörü bulunamadı."))?;
    std::fs::create_dir_all(&folder)
        .map_err(|_| AppError::new("LOG_UNAVAILABLE", "Günlük klasörü oluşturulamadı."))?;
    open_folder(&folder)
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
fn delete_history_entry(app: AppHandle, history_id: String) -> Result<(), AppError> {
    history::delete(&app, &history_id)
}

#[tauri::command]
fn history_thumbnail(app: AppHandle, history_id: String) -> Result<Option<String>, AppError> {
    history::authorize_thumbnail(&app, &history_id)
}

#[tauri::command]
fn prepare_preview(app: AppHandle, history_id: String) -> Result<String, AppError> {
    history::authorize_preview(&app, &history_id)
}

/// Shows a finished output in Explorer. Only paths Lipit itself produced
/// (current jobs or history) can be revealed.
#[tauri::command]
fn reveal_output(
    app: AppHandle,
    manager: State<'_, JobManager>,
    id: String,
) -> Result<(), AppError> {
    let path = manager
        .output_path(&id)
        .filter(|path| path.is_file())
        .or_else(|| {
            history::find(&app, &id)
                .ok()
                .map(|entry| PathBuf::from(entry.output_path))
        })
        .filter(|path| path.is_file())
        .ok_or_else(|| AppError::new("FILE_MISSING", "Dosya artık bu konumda bulunmuyor."))?;
    reveal_in_explorer(&path)
}

#[tauri::command]
fn get_stats(app: AppHandle) -> Result<stats::Stats, AppError> {
    stats::load(&app)
}

#[tauri::command]
fn reset_stats(app: AppHandle) -> Result<(), AppError> {
    stats::reset(&app)
}

#[tauri::command]
fn legal_document(app: AppHandle, name: String) -> Result<String, AppError> {
    if !LEGAL_DOCUMENTS.contains(&name.as_str()) {
        return Err(AppError::new("DOCUMENT_UNAVAILABLE", "Belge bulunamadı."));
    }
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("legal").join(&name));
        candidates.push(resources.join("licenses").join(&name));
    }
    #[cfg(debug_assertions)]
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("..")
            .join(&name),
    );
    candidates
        .into_iter()
        .find_map(|path| std::fs::read_to_string(path).ok())
        .ok_or_else(|| AppError::new("DOCUMENT_UNAVAILABLE", "Belge bulunamadı."))
}

#[tauri::command]
fn open_project_page(page: String) -> Result<(), AppError> {
    let url = match page.as_str() {
        "repository" => SOURCE_REPOSITORY.to_owned(),
        "releases" => format!("{SOURCE_REPOSITORY}/releases"),
        "issues" => format!("{SOURCE_REPOSITORY}/issues/new/choose"),
        _ => return Err(AppError::new("INVALID_PAGE", "Sayfa bulunamadı.")),
    };
    spawn_explorer(&[url.as_str()])
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), AppError> {
    show_main(&app)
}

#[tauri::command]
async fn close_quick_widget(
    app: AppHandle,
    manager: State<'_, JobManager>,
    service: State<'_, QuickService>,
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
    if main_hidden && !manager.has_active().await && !service.is_busy() {
        log::info("Arka plan işlemleri bitti; Lipit kapatılıyor.");
        app.exit(0);
    }
    Ok(())
}

pub(crate) fn show_main(app: &AppHandle) -> Result<(), AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::new("WINDOW_UNAVAILABLE", "Ana pencere bulunamadı."))?;
    let _ = window.unminimize();
    window
        .show()
        .and_then(|()| window.set_focus())
        .map_err(|_| AppError::new("WINDOW_UNAVAILABLE", "Ana pencere gösterilemedi."))
}

/// Opens (or focuses) the small progress window for a quick action or job.
/// Several windows stack downwards so parallel requests stay visible.
pub(crate) fn open_widget(app: &AppHandle, id: &str) -> Result<(), AppError> {
    validate_job_id(id)?;
    let label = format!("quick-widget-{id}");
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        return Ok(());
    }
    let open_widgets = app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with("quick-widget-"))
        .count();
    // App URLs are resolved as bundled asset paths. Adding the widget id as a
    // query here makes Windows WebView look for a non-existent asset and leaves
    // the quick window blank. The React side reads the id from the Tauri label.
    let url = WebviewUrl::App("widget.html".into());
    let mut builder = WebviewWindowBuilder::new(app, &label, url)
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
        .focused(false)
        .background_color(tauri::window::Color(13, 17, 19, 255))
        .transparent(false)
        .visible(true);
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let width = size.width as f64 / scale;
        let height = size.height as f64 / scale;
        let slot = (open_widgets % 5) as f64;
        let top = (22.0 + slot * 152.0).min((height - 160.0).max(22.0));
        builder = builder.position((width - 380.0).max(12.0), top);
    }
    builder
        .build()
        .map(|_| ())
        .map_err(|_| AppError::new("WINDOW_UNAVAILABLE", "İlerleme penceresi açılamadı."))
}

pub(crate) fn fail_widget(app: &AppHandle, widget_id: &str, message: &str) -> Result<(), AppError> {
    validate_job_id(widget_id)?;
    let message: String = message.chars().take(500).collect();
    let window = app
        .get_webview_window(&format!("quick-widget-{widget_id}"))
        .ok_or_else(|| AppError::new("WINDOW_UNAVAILABLE", "İlerleme penceresi bulunamadı."))?;
    window
        .emit("quick-widget-failed", message)
        .map_err(|_| AppError::new("WINDOW_UNAVAILABLE", "İlerleme penceresi güncellenemedi."))
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

fn open_folder(folder: &Path) -> Result<(), AppError> {
    if !folder.is_dir() {
        return Err(AppError::new("FOLDER_MISSING", "Klasör bulunamadı."));
    }
    spawn_explorer(&[folder.to_string_lossy().as_ref()])
}

#[cfg(windows)]
fn reveal_in_explorer(path: &Path) -> Result<(), AppError> {
    use std::os::windows::process::CommandExt;

    // Explorer parses `/select,` itself, so the path is passed as one raw,
    // quoted argument. Paths come only from Lipit's own jobs and history.
    std::process::Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{}\"", path.display()))
        .spawn()
        .map(|_| ())
        .map_err(|_| AppError::new("EXPLORER_FAILED", "Dosya Gezgini açılamadı."))
}

#[cfg(not(windows))]
fn reveal_in_explorer(_path: &Path) -> Result<(), AppError> {
    Err(AppError::new(
        "EXPLORER_FAILED",
        "Bu işlem yalnız Windows'ta desteklenir.",
    ))
}

fn spawn_explorer(args: &[&str]) -> Result<(), AppError> {
    std::process::Command::new("explorer.exe")
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|_| AppError::new("EXPLORER_FAILED", "Dosya Gezgini açılamadı."))
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
        .manage(QuickService::default())
        .setup(|app| {
            if let Ok(directory) = app.path().app_log_dir() {
                log::init(directory);
            }
            log::info(format!("Lipit {} başlatıldı.", env!("CARGO_PKG_VERSION")));
            jobs::cleanup_stale_cache(app.handle());
            preview::clear(app.handle());
            native_messaging::cleanup_stale_files();
            quick::start(app.handle().clone());
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
            take_notices,
            quick_output_path,
            suggest_filename,
            update_ytdlp_engine,
            resolve_media,
            resolve_detected_candidate,
            cancel_resolution,
            preview_frame,
            take_pending_candidates,
            repair_native_bridge,
            extension_status,
            open_extension_folder,
            open_log_folder,
            start_download,
            start_clip,
            cancel_download,
            list_jobs,
            list_history,
            clear_history,
            delete_history_entry,
            history_thumbnail,
            prepare_preview,
            reveal_output,
            get_stats,
            reset_stats,
            legal_document,
            open_project_page,
            show_main_window,
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
    let name: Vec<u16> = native_messaging::DESKTOP_MUTEX_NAME
        .encode_utf16()
        .chain(std::iter::once(0))
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
