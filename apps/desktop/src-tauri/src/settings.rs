use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Manager};
use url::Url;

use crate::{
    binary,
    models::{AppError, AppSettings, DestinationMode, RequestContext},
};

const SETTINGS_FILE: &str = "settings.json";

pub fn load(app: &AppHandle) -> Result<AppSettings, AppError> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let bytes =
        fs::read(&path).map_err(|_| AppError::new("SETTINGS_UNAVAILABLE", "Ayarlar okunamadı."))?;
    let mut value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::new("SETTINGS_INVALID", "Ayar dosyası geçersiz."))?;
    if value
        .pointer("/compatibility/cookieBrowser")
        .and_then(|item| item.as_str())
        == Some("firefox")
    {
        value["compatibility"]["cookieBrowser"] = serde_json::Value::String("chrome".into());
    }
    serde_json::from_value(value)
        .map_err(|_| AppError::new("SETTINGS_INVALID", "Ayar dosyası geçersiz."))
}

pub fn save(app: &AppHandle, settings: &AppSettings) -> Result<(), AppError> {
    validate_quick_profile(settings)?;
    let path = settings_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("SETTINGS_UNAVAILABLE", "Ayar klasörü bulunamadı."))?;
    fs::create_dir_all(parent)
        .map_err(|_| AppError::new("SETTINGS_UNAVAILABLE", "Ayar klasörü oluşturulamadı."))?;
    if settings.compatibility.po_token_providers_enabled {
        fs::create_dir_all(po_token_plugins_dir(app)?).map_err(|_| {
            AppError::new("SETTINGS_UNAVAILABLE", "Eklenti klasörü oluşturulamadı.")
        })?;
    }
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| AppError::new("SETTINGS_UNAVAILABLE", "Ayarlar kaydedilemedi."))?;
    serde_json::to_writer_pretty(&mut temporary, settings)
        .map_err(|_| AppError::new("SETTINGS_UNAVAILABLE", "Ayarlar kaydedilemedi."))?;
    temporary
        .flush()
        .map_err(|_| AppError::new("SETTINGS_UNAVAILABLE", "Ayarlar kaydedilemedi."))?;
    temporary
        .persist(&path)
        .map_err(|_| AppError::new("SETTINGS_UNAVAILABLE", "Ayarlar kaydedilemedi."))?;
    Ok(())
}

pub fn quick_output_path(app: &AppHandle, suggested_filename: &str) -> Result<String, AppError> {
    let settings = load(app)?;
    let directory = match (
        settings.quick_profile.destination_mode,
        settings.quick_profile.download_directory.as_deref(),
    ) {
        (DestinationMode::Folder, Some(directory)) => PathBuf::from(directory),
        _ => {
            return Err(AppError::new(
                "QUICK_FOLDER_UNAVAILABLE",
                "Hızlı profil için bir indirme klasörü seçin.",
            ))
        }
    };
    if !directory.is_absolute() || !directory.is_dir() {
        return Err(AppError::new(
            "QUICK_FOLDER_UNAVAILABLE",
            "Seçilen indirme klasörü artık kullanılamıyor.",
        ));
    }
    let filename = Path::new(suggested_filename);
    if filename.file_name().and_then(|value| value.to_str()) != Some(suggested_filename)
        || filename
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|value| !value.eq_ignore_ascii_case("mp4"))
        || !valid_output_filename(suggested_filename)
    {
        return Err(AppError::new(
            "INVALID_DESTINATION",
            "Önerilen dosya adı geçersiz.",
        ));
    }
    let stem = filename
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("video");
    for suffix in 0..10_000_u32 {
        let name = if suffix == 0 {
            suggested_filename.to_owned()
        } else {
            format!("{stem}_{suffix}.mp4")
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }
    Err(AppError::new(
        "FILE_EXISTS",
        "İndirme klasöründe kullanılabilir bir dosya adı oluşturulamadı.",
    ))
}

pub fn valid_output_filename(filename: &str) -> bool {
    if filename.is_empty()
        || filename.len() > 180
        || filename.ends_with(' ')
        || filename.ends_with('.')
        || filename
            .chars()
            .any(|character| character.is_control() || "<>:\"/\\|?*".contains(character))
    {
        return false;
    }
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim_end_matches([' ', '.'])
        .to_ascii_uppercase();
    !matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn validate_quick_profile(settings: &AppSettings) -> Result<(), AppError> {
    if !matches!(
        settings.quick_profile.clip_duration_ms,
        15_000 | 30_000 | 45_000 | 60_000 | 120_000 | 300_000
    ) {
        return Err(AppError::new(
            "INVALID_SETTINGS",
            "Hızlı klip süresi desteklenmiyor.",
        ));
    }
    if !matches!(
        settings.quick_profile.quality_height,
        None | Some(480 | 720 | 1080 | 1440 | 2160)
    ) {
        return Err(AppError::new(
            "INVALID_SETTINGS",
            "Hızlı profil görüntü kalitesi desteklenmiyor.",
        ));
    }
    if matches!(
        settings.quick_profile.destination_mode,
        DestinationMode::Folder
    ) {
        let directory = settings
            .quick_profile
            .download_directory
            .as_deref()
            .map(Path::new)
            .filter(|path| path.is_absolute() && path.is_dir())
            .ok_or_else(|| {
                AppError::new(
                    "INVALID_SETTINGS",
                    "Hızlı indirme için geçerli bir klasör seçin.",
                )
            })?;
        if fs::metadata(directory).is_err() {
            return Err(AppError::new(
                "INVALID_SETTINGS",
                "Seçilen indirme klasörü kullanılamıyor.",
            ));
        }
    }
    Ok(())
}

pub fn validate_request_context(context: &RequestContext) -> Result<(), AppError> {
    validate_optional_url(context.referer.as_deref(), 4096)?;
    validate_optional_url(context.origin.as_deref(), 512)?;
    validate_header_value(context.user_agent.as_deref(), 1024)?;
    Ok(())
}

pub fn yt_dlp_args(app: &AppHandle, context: &RequestContext) -> Result<Vec<String>, AppError> {
    validate_request_context(context)?;
    let settings = load(app)?;
    let mut args = request_header_args(context);
    args.extend(rate_limit_args());
    if settings.compatibility.cookies_enabled {
        args.extend([
            "--cookies-from-browser".into(),
            settings.compatibility.cookie_browser.as_str().into(),
        ]);
    }
    if let Some(deno) = binary::deno_path(app) {
        args.extend([
            "--js-runtimes".into(),
            format!("deno:{}", deno.to_string_lossy()),
        ]);
    }
    if settings.compatibility.remote_ejs_enabled {
        args.extend(["--remote-components".into(), "ejs:github".into()]);
    }
    if settings.compatibility.po_token_providers_enabled {
        let directory = po_token_plugins_dir(app)?;
        fs::create_dir_all(&directory).map_err(|_| {
            AppError::new("SETTINGS_UNAVAILABLE", "Eklenti klasörü oluşturulamadı.")
        })?;
        args.extend([
            "--plugin-dirs".into(),
            directory.to_string_lossy().into_owned(),
        ]);
    }
    Ok(args)
}

fn rate_limit_args() -> Vec<String> {
    vec![
        "--sleep-requests".into(),
        "0.75".into(),
        "--retries".into(),
        "5".into(),
        "--fragment-retries".into(),
        "5".into(),
        "--extractor-retries".into(),
        "3".into(),
        "--retry-sleep".into(),
        "http:exp=1:8".into(),
        "--retry-sleep".into(),
        "extractor:exp=1:8".into(),
        "--retry-sleep".into(),
        "fragment:exp=1:4".into(),
    ]
}

pub fn ffmpeg_input_args(context: &RequestContext) -> Result<Vec<String>, AppError> {
    validate_request_context(context)?;
    let mut args = Vec::new();
    if let Some(user_agent) = context.user_agent.as_deref() {
        args.extend(["-user_agent".into(), user_agent.into()]);
    }
    if let Some(referer) = context.referer.as_deref() {
        args.extend(["-referer".into(), referer.into()]);
    }
    if let Some(origin) = context.origin.as_deref() {
        args.extend(["-headers".into(), format!("Origin: {origin}\r\n")]);
    }
    Ok(args)
}

pub fn po_token_plugins_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|path| path.join("yt-dlp-plugins"))
        .map_err(|_| AppError::new("SETTINGS_UNAVAILABLE", "Eklenti klasörü bulunamadı."))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(SETTINGS_FILE))
        .map_err(|_| AppError::new("SETTINGS_UNAVAILABLE", "Ayar klasörü bulunamadı."))
}

fn request_header_args(context: &RequestContext) -> Vec<String> {
    let mut args = Vec::new();
    for (name, value) in [
        ("Referer", context.referer.as_deref()),
        ("Origin", context.origin.as_deref()),
        ("User-Agent", context.user_agent.as_deref()),
    ] {
        if let Some(value) = value {
            args.extend(["--add-headers".into(), format!("{name}:{value}")]);
        }
    }
    args
}

fn validate_optional_url(value: Option<&str>, max_len: usize) -> Result<(), AppError> {
    let Some(value) = value else { return Ok(()) };
    validate_header_value(Some(value), max_len)?;
    let url = Url::parse(value)
        .map_err(|_| AppError::new("INVALID_REQUEST_CONTEXT", "İstek adresi geçersiz."))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(AppError::new(
            "INVALID_REQUEST_CONTEXT",
            "İstek adresi geçersiz.",
        ));
    }
    Ok(())
}

fn validate_header_value(value: Option<&str>, max_len: usize) -> Result<(), AppError> {
    if value.is_some_and(|value| {
        value.is_empty()
            || value.len() > max_len
            || value.contains(['\r', '\n', '\0'])
            || !value.is_ascii()
    }) {
        return Err(AppError::new(
            "INVALID_REQUEST_CONTEXT",
            "İstek başlığı geçersiz.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_header_injection() {
        let context = RequestContext {
            referer: Some("https://example.com/watch\r\nCookie: secret".into()),
            origin: None,
            user_agent: None,
        };
        assert_eq!(
            validate_request_context(&context).unwrap_err().code,
            "INVALID_REQUEST_CONTEXT"
        );
    }

    #[test]
    fn creates_safe_ffmpeg_headers() {
        let context = RequestContext {
            referer: Some("https://example.com/watch".into()),
            origin: Some("https://example.com".into()),
            user_agent: Some("Lipit Test/1.0".into()),
        };
        let args = ffmpeg_input_args(&context).unwrap();
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-referer", "https://example.com/watch"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-headers", "Origin: https://example.com\r\n"]));
    }

    #[test]
    fn rate_limit_policy_backs_off_without_unbounded_retries() {
        let args = rate_limit_args();
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sleep-requests", "0.75"]));
        assert!(args.windows(2).any(|pair| pair == ["--retries", "5"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--retry-sleep", "http:exp=1:8"]));
        assert!(!args.iter().any(|value| value == "infinite"));
    }

    #[test]
    fn accepts_only_supported_quick_clip_presets() {
        let mut settings = AppSettings::default();
        settings.quick_profile.clip_duration_ms = 120_000;
        assert!(validate_quick_profile(&settings).is_ok());
        settings.quick_profile.clip_duration_ms = 12_345;
        assert_eq!(
            validate_quick_profile(&settings).unwrap_err().code,
            "INVALID_SETTINGS"
        );
    }

    #[test]
    fn rejects_windows_reserved_output_names() {
        assert!(!valid_output_filename("CON.mp4"));
        assert!(!valid_output_filename("video.mp4."));
        assert!(valid_output_filename("CON_2026-09-23.mp4"));
        assert!(valid_output_filename("İstanbul 🎬_2026-09-23.mp4"));
    }
}
