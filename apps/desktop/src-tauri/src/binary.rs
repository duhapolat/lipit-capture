use std::time::Duration;
use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::{
    process::{Command, CommandChild, CommandEvent},
    ShellExt,
};
use tokio::sync::watch;

use crate::{
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

pub fn ffmpeg_dir() -> Option<PathBuf> {
    let local = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    if local.join("ffmpeg.exe").exists() && local.join("ffprobe.exe").exists() {
        return Some(local);
    }
    let packaged = std::env::current_exe().ok()?.parent()?.to_path_buf();
    if packaged.join("ffmpeg.exe").exists() && packaged.join("ffprobe.exe").exists() {
        Some(packaged)
    } else {
        None
    }
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
                    return Err(classify_failure(binary, &stderr));
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

fn classify_failure(binary: Binary, stderr: &str) -> AppError {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("drm") || lower.contains("widevine") {
        AppError::new("DRM_PROTECTED", "DRM korumalı medya indirilemez.")
    } else if lower.contains("no space left")
        || lower.contains("disk full")
        || lower.contains("not enough space")
    {
        AppError::new("DISK_FULL", "Diskte yeterli boş alan yok.")
    } else if lower.contains("429") || lower.contains("too many requests") {
        AppError::new(
            "RATE_LIMITED",
            "Medya kaynağı çok fazla istek nedeniyle geçici olarak beklemenizi istiyor (429).",
        )
    } else if lower.contains("cookie")
        && (lower.contains("locked") || lower.contains("could not copy"))
    {
        AppError::new(
            "BROWSER_COOKIES_UNAVAILABLE",
            "Tarayıcı oturumu okunamadı. Tarayıcıyı kapatıp tekrar deneyin veya çerez uyumluluğunu kapatın.",
        )
    } else if lower.contains("403") || lower.contains("forbidden") {
        AppError::new(
            "ACCESS_DENIED",
            "Medya kaynağı erişimi reddetti veya geçici bağlantının süresi doldu (403).",
        )
    } else if matches!(binary, Binary::YtDlp) {
        AppError::new(
            "NO_MEDIA_FOUND",
            "İşlem tamamlanamadı. Bağlantıyı kontrol edip tekrar deneyin.",
        )
    } else {
        AppError::new("ENGINE_FAILED", "Medya işleme başarısız oldu.")
    }
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
    let packaged = std::env::current_exe().ok()?.parent()?.join(&filename);
    if packaged.is_file() {
        return Some(packaged);
    }
    let local = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(filename);
    local.is_file().then_some(local)
}

#[cfg(test)]
mod tests {
    use super::valid_yt_dlp_version;

    #[test]
    fn validates_stable_yt_dlp_versions() {
        assert!(valid_yt_dlp_version("2026.08.19"));
        assert!(!valid_yt_dlp_version("nightly@2026.08.19.010101"));
        assert!(!valid_yt_dlp_version("not-a-version"));
        assert!(!valid_yt_dlp_version("2026.13.01"));
    }
}
