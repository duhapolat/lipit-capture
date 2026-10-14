use std::time::Duration;
use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::{
    process::{Command, CommandChild, CommandEvent},
    ShellExt,
};
use tokio::sync::watch;

use crate::{
    log,
    models::{AppError, EngineUpdateResult, EngineVersions},
    settings,
};

#[derive(Clone, Copy)]
pub enum Binary {
    YtDlp,
    Ffmpeg,
    Ffprobe,
    Deno,
}

/// Directories that may contain the packaged media engines, in priority order.
///
/// Release builds only trust the folder of the running executable. The source
/// tree fallback exists for `cargo test`/debug runs and is compiled out of
/// release binaries, so no build-machine path can be planted on a user's PC.
fn engine_dirs() -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(packaged) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from))
    {
        directories.push(packaged);
    }
    #[cfg(debug_assertions)]
    directories.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));
    directories
}

pub fn ffmpeg_dir() -> Option<PathBuf> {
    engine_dirs().into_iter().find(|directory| {
        directory.join("ffmpeg.exe").is_file() && directory.join("ffprobe.exe").is_file()
    })
}

impl Binary {
    fn name(self) -> &'static str {
        match self {
            Self::YtDlp => "yt-dlp",
            Self::Ffmpeg => "ffmpeg",
            Self::Ffprobe => "ffprobe",
            Self::Deno => "deno",
        }
    }
}

pub enum Stream {
    Stdout,
    Stderr,
}

pub struct ProcessOutput {
    pub stdout: String,
    pub stderr: String,
}

pub async fn run(
    app: &AppHandle,
    binary: Binary,
    args: &[String],
    max_duration: Duration,
    cancel: Option<watch::Receiver<bool>>,
    on_line: impl FnMut(Stream, &str),
) -> Result<ProcessOutput, AppError> {
    let command = command_for(app, binary)?.args(args);
    run_command(command, binary, max_duration, cancel, on_line).await
}

async fn run_command(
    command: Command,
    binary: Binary,
    max_duration: Duration,
    mut cancel: Option<watch::Receiver<bool>>,
    mut on_line: impl FnMut(Stream, &str),
) -> Result<ProcessOutput, AppError> {
    let (mut receiver, child) = command.spawn().map_err(|_| {
        AppError::new(
            "ENGINE_UNAVAILABLE",
            format!("{} başlatılamadı.", binary.name()),
        )
    })?;

    let mut child = Some(child);
    let mut stdout = String::new();
    let mut stderr = String::new();
    let deadline = tokio::time::sleep(max_duration);
    tokio::pin!(deadline);

    loop {
        tokio::select! {
            _ = &mut deadline => {
                if let Some(child) = child.take() { kill_process_tree(child); }
                return Err(AppError::new("ENGINE_TIMEOUT", "Medya motoru zaman aşımına uğradı."));
            }
            _ = async {
                if let Some(receiver) = cancel.as_mut() {
                    if !*receiver.borrow() { let _ = receiver.changed().await; }
                } else {
                    std::future::pending::<()>().await;
                }
            } => {
                if cancel.as_ref().is_some_and(|receiver| *receiver.borrow()) {
                    if let Some(child) = child.take() { kill_process_tree(child); }
                    return Err(AppError::new("CANCELLED", "İşlem iptal edildi."));
                }
            }
            event = receiver.recv() => match event {
                Some(CommandEvent::Stdout(bytes)) => {
                    let line = String::from_utf8_lossy(&bytes);
                    on_line(Stream::Stdout, &line);
                    if let Err(error) = append_limited(&mut stdout, &line) {
                        if let Some(child) = child.take() { kill_process_tree(child); }
                        return Err(error);
                    }
                }
                Some(CommandEvent::Stderr(bytes)) => {
                    let line = String::from_utf8_lossy(&bytes);
                    on_line(Stream::Stderr, &line);
                    if let Err(error) = append_limited(&mut stderr, &line) {
                        if let Some(child) = child.take() { kill_process_tree(child); }
                        return Err(error);
                    }
                }
                Some(CommandEvent::Error(_)) => {
                    if let Some(child) = child.take() { kill_process_tree(child); }
                    return Err(AppError::new("ENGINE_FAILED", "Medya motoru çalışırken hata oluştu."));
                }
                Some(CommandEvent::Terminated(payload)) => {
                    if payload.code == Some(0) { return Ok(ProcessOutput { stdout, stderr }); }
                    let error = classify_failure(binary, &stderr);
                    log::error(format!(
                        "{} çıkış kodu {:?}, sınıf {}: {}",
                        binary.name(),
                        payload.code,
                        error.code,
                        stderr_tail(&stderr)
                    ));
                    return Err(error);
                }
                Some(_) => {}
                None => return Err(AppError::new("ENGINE_FAILED", "Medya motoru beklenmedik şekilde kapandı.")),
            }
        }
    }
}

fn kill_process_tree(child: CommandChild) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        let pid = child.pid().to_string();
        let _ = std::process::Command::new("taskkill.exe")
            .args(["/PID", &pid, "/T", "/F"])
            .creation_flags(0x0800_0000)
            .status();
    }
    let _ = child.kill();
}

fn command_for(app: &AppHandle, binary: Binary) -> Result<Command, AppError> {
    if matches!(binary, Binary::YtDlp) {
        if let Some(path) = managed_yt_dlp_path(app) {
            return Ok(app.shell().command(path));
        }
    }
    bundled_binary_path(app, binary)
        .map(|path| app.shell().command(path))
        .ok_or_else(|| {
            AppError::new(
                "ENGINE_UNAVAILABLE",
                format!("{} medya aracı bulunamadı.", binary.name()),
            )
        })
}

fn append_limited(buffer: &mut String, line: &str) -> Result<(), AppError> {
    if buffer.len() + line.len() > 32 * 1024 * 1024 {
        return Err(AppError::new(
            "ENGINE_OUTPUT_LIMIT",
            "Medya motoru çok fazla çıktı üretti.",
        ));
    }
    buffer.push_str(line);
    buffer.push('\n');
    Ok(())
}

/// Maps engine error output to a stable code and an actionable message.
/// Patterns are checked in order; the first match wins.
const FAILURE_PATTERNS: &[(&[&str], &str, &str)] = &[
    (
        &["drm protected", "drm-protected", "widevine", "playready", "this video is drm"],
        "DRM_PROTECTED",
        "DRM korumalı medya indirilemez.",
    ),
    (
        &["no space left", "disk full", "not enough space"],
        "DISK_FULL",
        "Diskte yeterli boş alan yok.",
    ),
    (
        &["http error 429", "too many requests", "error 429"],
        "RATE_LIMITED",
        "Kaynak çok fazla istek nedeniyle beklemeni istiyor (429). Birkaç dakika sonra tekrar dene.",
    ),
    (
        &["not a bot", "confirm you're not a bot", "confirm you’re not a bot"],
        "BOT_CHECK",
        "Kaynak otomatik erişim doğrulaması istiyor. Bir süre bekleyip tekrar dene, yt-dlp'yi güncelle veya çerez uyumluluğunu kullan.",
    ),
    (
        &["confirm your age", "age-restricted", "age restricted", "inappropriate for some users"],
        "AGE_RESTRICTED",
        "Bu video yaş doğrulaması istiyor. Erişim hakkın varsa Ayarlar'dan çerez uyumluluğunu açabilirsin.",
    ),
    (
        &["private video", "this video is private", "is private"],
        "PRIVATE_MEDIA",
        "Bu video özel. Yalnızca erişim hakkın olan videoları kaydedebilirsin.",
    ),
    (
        &["login required", "log in to", "login to", "requires authentication", "you need to log in", "sign in to", "use --cookies", "account cookies"],
        "LOGIN_REQUIRED",
        "Bu içerik oturum açmayı gerektiriyor. Erişim hakkın varsa Ayarlar'dan çerez uyumluluğunu açabilirsin.",
    ),
    (
        &["available in your country", "geo restrict", "geo-restrict", "blocked it in your country", "not available from your location"],
        "GEO_BLOCKED",
        "Bu içerik bulunduğun bölgede kullanılamıyor.",
    ),
    (
        &["unsupported url"],
        "UNSUPPORTED_SITE",
        "Bu bağlantı desteklenmiyor. Doğrudan tek bir video sayfasının bağlantısını kullan.",
    ),
    (
        &["premieres in", "live event will begin", "this live event", "is upcoming"],
        "MEDIA_NOT_STARTED",
        "Yayın henüz başlamadı. Başladıktan sonra tekrar dene.",
    ),
    (
        &["video unavailable", "has been removed", "no longer available", "does not exist", "http error 404", "error 404", "404 not found"],
        "MEDIA_UNAVAILABLE",
        "Video kaldırılmış veya artık erişilebilir değil.",
    ),
    (
        &["http error 403", "403 forbidden", "error 403", "server returned 403"],
        "ACCESS_DENIED",
        "Kaynak erişimi reddetti veya geçici bağlantının süresi doldu (403). Videoyu yeniden getirip tekrar dene.",
    ),
    (
        &["unable to extract", "nsig extraction failed", "signature extraction failed", "please report this issue", "update to the latest version", "unable to decrypt"],
        "EXTRACTOR_OUTDATED",
        "Medya motoru bu kaynağı çözemedi. Motorlar menüsünden yt-dlp'yi güncelleyip tekrar dene.",
    ),
    (
        &["getaddrinfo", "name or service not known", "nodename nor servname", "timed out", "connection reset", "connection refused", "network is unreachable", "temporary failure in name resolution", "failed to resolve"],
        "NETWORK_ERROR",
        "Kaynağa bağlanılamadı. İnternet bağlantını kontrol edip tekrar dene.",
    ),
    (
        &["invalid data found when processing input", "moov atom not found"],
        "MEDIA_INVALID",
        "Medya verisi okunamadı veya bozuk.",
    ),
];

fn classify_failure(binary: Binary, stderr: &str) -> AppError {
    let lower = stderr.to_lowercase();
    let cookie_problem = lower.contains("cookie")
        && (lower.contains("locked")
            || lower.contains("could not copy")
            || lower.contains("failed to decrypt")
            || lower.contains("app-bound")
            || lower.contains("permission denied"));
    if cookie_problem && !lower.contains("drm") {
        return AppError::new(
            "BROWSER_COOKIES_UNAVAILABLE",
            "Tarayıcı oturumu okunamadı. Tarayıcıyı kapatıp tekrar dene; sorun sürerse Ayarlar'da çerez kaynağı olarak cookies.txt dosyası seç.",
        );
    }
    for (needles, code, message) in FAILURE_PATTERNS {
        if needles.iter().any(|needle| lower.contains(needle)) {
            return AppError::new(code, *message);
        }
    }
    if matches!(binary, Binary::YtDlp) {
        AppError::new(
            "NO_MEDIA_FOUND",
            "Bu bağlantıda indirilebilir bir video bulunamadı. Bağlantıyı kontrol edip tekrar dene.",
        )
    } else {
        AppError::new("ENGINE_FAILED", "Medya işleme başarısız oldu.")
    }
}

fn stderr_tail(stderr: &str) -> String {
    let lines: Vec<&str> = stderr
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    lines[lines.len().saturating_sub(20)..].join(" | ")
}

pub async fn versions(app: &AppHandle) -> Result<EngineVersions, AppError> {
    async fn version(app: &AppHandle, binary: Binary, args: &[&str]) -> Option<String> {
        let args: Vec<String> = args.iter().map(|s| (*s).to_owned()).collect();
        let output = run(app, binary, &args, Duration::from_secs(8), None, |_, _| {})
            .await
            .ok()?;
        output
            .stdout
            .lines()
            .next()
            .or_else(|| output.stderr.lines().next())
            .map(str::to_owned)
    }
    Ok(EngineVersions {
        yt_dlp: version(app, Binary::YtDlp, &["--version"]).await,
        ffmpeg: version(app, Binary::Ffmpeg, &["-version"]).await,
        ffprobe: version(app, Binary::Ffprobe, &["-version"]).await,
        deno: version(app, Binary::Deno, &["--version"]).await,
        yt_dlp_managed: managed_yt_dlp_path(app).is_some(),
        ejs: "Gömülü".into(),
        po_token_plugins_dir: settings::po_token_plugins_dir(app)?
            .to_string_lossy()
            .into_owned(),
    })
}

pub fn deno_path(app: &AppHandle) -> Option<PathBuf> {
    bundled_binary_path(app, Binary::Deno)
}

pub async fn update_yt_dlp(app: &AppHandle) -> Result<EngineUpdateResult, AppError> {
    let previous_version = first_version_line(app, Binary::YtDlp, &["--version"]).await;
    let target = managed_engine_dir(app)?.join("yt-dlp.exe");
    if !target.exists() {
        let source = bundled_binary_path(app, Binary::YtDlp)
            .ok_or_else(|| AppError::new("ENGINE_UNAVAILABLE", "Paketlenmiş yt-dlp bulunamadı."))?;
        fs::create_dir_all(target.parent().unwrap_or_else(|| std::path::Path::new(".")))
            .map_err(|_| AppError::new("ENGINE_UPDATE_FAILED", "Motor klasörü oluşturulamadı."))?;
        let temporary = target.with_extension("exe.new");
        let _ = fs::remove_file(&temporary);
        fs::copy(&source, &temporary)
            .and_then(|_| fs::rename(&temporary, &target))
            .map_err(|_| {
                let _ = fs::remove_file(&temporary);
                AppError::new("ENGINE_UPDATE_FAILED", "yt-dlp hazırlanamıyor.")
            })?;
    }
    let backup = target.with_extension("exe.bak");
    let _ = fs::remove_file(&backup);
    fs::copy(&target, &backup).map_err(|_| {
        AppError::new(
            "ENGINE_UPDATE_FAILED",
            "Güncelleme öncesi güvenli yedek oluşturulamadı.",
        )
    })?;
    let args = vec!["--update-to".into(), "stable@latest".into()];
    let update_output = match run(
        app,
        Binary::YtDlp,
        &args,
        Duration::from_secs(90),
        None,
        |_, _| {},
    )
    .await
    {
        Ok(output) => output,
        Err(_) => {
            restore_engine_backup(&backup, &target);
            return Err(AppError::new(
                "ENGINE_UPDATE_FAILED",
                "yt-dlp güncellenemedi; önceki sürüm geri yüklendi.",
            ));
        }
    };
    let update_log =
        format!("{}\n{}", update_output.stdout, update_output.stderr).to_ascii_lowercase();
    if [
        "skipping verification",
        "no hash information found",
        "unverified build",
        "hash could not be found",
    ]
    .iter()
    .any(|warning| update_log.contains(warning))
    {
        restore_engine_backup(&backup, &target);
        return Err(AppError::new(
            "ENGINE_UPDATE_UNVERIFIED",
            "Güncellemenin dosya özeti doğrulanamadı; önceki sürüm geri yüklendi.",
        ));
    }
    let Some(current_version) = first_version_line(app, Binary::YtDlp, &["--version"]).await else {
        restore_engine_backup(&backup, &target);
        return Err(AppError::new(
            "ENGINE_UPDATE_FAILED",
            "Güncellenen yt-dlp doğrulanamadı; önceki sürüm geri yüklendi.",
        ));
    };
    if !valid_yt_dlp_version(&current_version) {
        restore_engine_backup(&backup, &target);
        return Err(AppError::new(
            "ENGINE_UPDATE_FAILED",
            "Güncellenen yt-dlp sürümü geçersiz; önceki sürüm geri yüklendi.",
        ));
    }
    let _ = fs::remove_file(backup);
    Ok(EngineUpdateResult {
        updated: previous_version.as_deref() != Some(current_version.as_str()),
        previous_version,
        current_version,
    })
}

fn valid_yt_dlp_version(value: &str) -> bool {
    let mut parts = value.trim().split('.');
    let Some(year) = parts.next() else {
        return false;
    };
    let Some(month) = parts.next() else {
        return false;
    };
    let Some(day) = parts.next() else {
        return false;
    };
    if parts.next().is_some()
        || year.len() != 4
        || month.is_empty()
        || month.len() > 2
        || day.is_empty()
        || day.len() > 2
        || !year.bytes().all(|byte| byte.is_ascii_digit())
        || !month.bytes().all(|byte| byte.is_ascii_digit())
        || !day.bytes().all(|byte| byte.is_ascii_digit())
    {
        return false;
    }
    matches!(month.parse::<u8>(), Ok(1..=12)) && matches!(day.parse::<u8>(), Ok(1..=31))
}

fn restore_engine_backup(backup: &std::path::Path, target: &std::path::Path) {
    if backup.is_file() {
        let _ = fs::remove_file(target);
        let _ = fs::rename(backup, target).or_else(|_| fs::copy(backup, target).map(|_| ()));
    }
}

async fn first_version_line(app: &AppHandle, binary: Binary, args: &[&str]) -> Option<String> {
    let args: Vec<String> = args.iter().map(|value| (*value).to_owned()).collect();
    let output = run(app, binary, &args, Duration::from_secs(10), None, |_, _| {})
        .await
        .ok()?;
    output
        .stdout
        .lines()
        .next()
        .or_else(|| output.stderr.lines().next())
        .map(str::to_owned)
}

fn managed_yt_dlp_path(app: &AppHandle) -> Option<PathBuf> {
    let path = managed_engine_dir(app).ok()?.join("yt-dlp.exe");
    path.is_file().then_some(path)
}

fn managed_engine_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("engines"))
        .map_err(|_| AppError::new("ENGINE_UNAVAILABLE", "Motor klasörü bulunamadı."))
}

fn bundled_binary_path(_app: &AppHandle, binary: Binary) -> Option<PathBuf> {
    let filename = format!("{}.exe", binary.name());
    engine_dirs()
        .into_iter()
        .map(|directory| directory.join(&filename))
        .find(|path| path.is_file())
}

#[cfg(test)]
mod tests {
    use super::{classify_failure, valid_yt_dlp_version, Binary};

    #[test]
    fn classifies_engine_failures_into_actionable_codes() {
        let cases = [
            ("ERROR: [site] abc: Sign in to confirm your age", "AGE_RESTRICTED"),
            ("ERROR: [site] abc: Sign in to confirm you’re not a bot", "BOT_CHECK"),
            ("ERROR: [site] abc: Private video. Sign in if you've been granted access", "PRIVATE_MEDIA"),
            ("ERROR: [site] abc: This content isn't available, login required", "LOGIN_REQUIRED"),
            ("ERROR: The uploader has not made this video available in your country", "GEO_BLOCKED"),
            ("ERROR: Unsupported URL: https://example.org/", "UNSUPPORTED_SITE"),
            ("ERROR: [site] abc: Video unavailable", "MEDIA_UNAVAILABLE"),
            ("ERROR: unable to download video data: HTTP Error 403: Forbidden", "ACCESS_DENIED"),
            ("ERROR: unable to download webpage: HTTP Error 429: Too Many Requests", "RATE_LIMITED"),
            ("ERROR: [site] abc: Unable to extract initial data; please report this issue", "EXTRACTOR_OUTDATED"),
            ("ERROR: Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>", "NETWORK_ERROR"),
            ("ERROR: This video is DRM protected", "DRM_PROTECTED"),
            ("ERROR: Could not copy Chrome cookie database", "BROWSER_COOKIES_UNAVAILABLE"),
            ("ERROR: something else entirely", "NO_MEDIA_FOUND"),
        ];
        for (stderr, expected) in cases {
            assert_eq!(
                classify_failure(Binary::YtDlp, stderr).code,
                expected,
                "{stderr}"
            );
        }
        assert_eq!(
            classify_failure(
                Binary::Ffmpeg,
                "Server returned 403 Forbidden (access denied)"
            )
            .code,
            "ACCESS_DENIED"
        );
        assert_eq!(
            classify_failure(Binary::Ffmpeg, "frame=4030 size=1024kB").code,
            "ENGINE_FAILED",
            "numbers that merely contain 403 must not be treated as HTTP 403"
        );
    }

    #[test]
    fn validates_stable_yt_dlp_versions() {
        assert!(valid_yt_dlp_version("2026.08.19"));
        assert!(!valid_yt_dlp_version("nightly@2026.08.19.010101"));
        assert!(!valid_yt_dlp_version("not-a-version"));
        assert!(!valid_yt_dlp_version("2026.13.01"));
    }
}
