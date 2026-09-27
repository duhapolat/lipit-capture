use std::time::Duration;

use serde_json::Value;
use tauri::AppHandle;
use tokio::sync::watch;
use url::Url;

use crate::{
    binary::{self, Binary},
    models::{AppError, QualityProfile, RequestContext, ResolvedMedia},
    native_messaging::{MediaCandidate, MediaProtocol},
    settings, url_safety,
};

pub fn validate_url(raw: &str) -> Result<Url, AppError> {
    url_safety::validate_public_http_url(raw, 4096)
}

pub fn resolve_direct(
    raw_url: &str,
    duration_ms: Option<u64>,
    context: RequestContext,
) -> Result<ResolvedMedia, AppError> {
    settings::validate_request_context(&context)?;
    let url = validate_url(raw_url)?;
    Ok(direct_media(&url, None, duration_ms, context, None))
}

pub async fn resolve_candidate(
    app: &AppHandle,
    candidate: &MediaCandidate,
    cancel: Option<watch::Receiver<bool>>,
) -> Result<ResolvedMedia, AppError> {
    let context = RequestContext {
        referer: candidate.referer.clone(),
        origin: candidate.origin.clone(),
        user_agent: candidate.user_agent.clone(),
    };
    settings::validate_request_context(&context)?;
    let page_result =
        resolve_with_context(app, &candidate.page_url, &context, cancel.clone()).await;
    match (page_result, candidate.media_url.as_deref()) {
        (Ok(media), _) => Ok(with_candidate_metadata(media, candidate)),
        (Err(error), _) if matches!(error.code, "DRM_PROTECTED" | "CANCELLED") => Err(error),
        (Err(page_error), Some(media_url))
            if media_url != candidate.page_url && !candidate_is_audio_only(candidate) =>
        {
            match resolve_with_context(app, media_url, &context, cancel).await {
                Ok(media) => Ok(with_candidate_metadata(media, candidate)),
                Err(error) if error.code == "DRM_PROTECTED" => Err(error),
                Err(_)
                    if matches!(
                        candidate.protocol,
                        MediaProtocol::Http | MediaProtocol::Hls | MediaProtocol::Dash
                    ) =>
                {
                    let url = validate_url(media_url)?;
                    Ok(direct_media(
                        &url,
                        candidate.page_title.as_deref(),
                        candidate.duration_ms,
                        context,
                        Some(candidate.page_url.clone()).filter(|page| page != media_url),
                    ))
                }
                Err(_) => Err(page_error),
            }
        }
        (Err(error), _) => Err(error),
    }
}

fn with_candidate_metadata(mut media: ResolvedMedia, candidate: &MediaCandidate) -> ResolvedMedia {
    if media.duration_ms.is_none() {
        media.duration_ms = preferred_duration(media.duration_ms, candidate.duration_ms);
    }
    if media.title == "Untitled media" {
        if let Some(title) = candidate
            .page_title
            .as_deref()
            .filter(|title| !title.trim().is_empty())
        {
            media.title = title.to_owned();
        }
    }
    if media.refresh_url.is_none() {
        media.refresh_url = Some(candidate.page_url.clone());
    }
    media
}

fn preferred_duration(extracted: Option<u64>, detected: Option<u64>) -> Option<u64> {
    extracted.or_else(|| detected.filter(|duration| *duration > 0))
}

pub async fn resolve_with_context(
    app: &AppHandle,
    raw_url: &str,
    context: &RequestContext,
    cancel: Option<watch::Receiver<bool>>,
) -> Result<ResolvedMedia, AppError> {
    let url = validate_url(raw_url)?;
    if is_known_non_media_page(&url) {
        return Err(AppError::new(
            "SINGLE_MEDIA_REQUIRED",
            "Bu bağlantı tek bir video açmıyor. Doğrudan video bağlantısını kullanın.",
        ));
    }
    settings::validate_request_context(context)?;
    let mut args = vec![
        "--ignore-config".into(),
        "--no-playlist".into(),
        "--dump-single-json".into(),
        "--skip-download".into(),
        "--no-warnings".into(),
    ];
    args.extend(settings::yt_dlp_args(app, context)?);
    args.extend(["--".into(), url.to_string()]);
    let output = match binary::run(
        app,
        Binary::YtDlp,
        &args,
        Duration::from_secs(20),
        cancel,
        |_, _| {},
    )
    .await
    {
        Ok(output) => output,
        Err(error) if error.code == "NO_MEDIA_FOUND" && is_direct_media_path(url.path()) => {
            return Ok(direct_media(&url, None, None, context.clone(), None));
        }
        Err(error) => return Err(error),
    };
    let value: Value = serde_json::from_str(output.stdout.trim())
        .map_err(|_| AppError::new("METADATA_INVALID", "Medya bilgileri okunamadı."))?;
    if value.get("_type").and_then(Value::as_str) == Some("playlist") {
        return Err(AppError::new(
            "PLAYLIST_UNSUPPORTED",
            "Lütfen oynatma listesi yerine tek bir video adresi girin.",
        ));
    }
    if is_drm(&value) {
        return Err(AppError::new(
            "DRM_PROTECTED",
            "DRM korumalı medya indirilemez.",
        ));
    }
    if !has_video_stream(&value) {
        return Err(AppError::new(
            "NO_VIDEO_STREAM",
            "Seçilen medya kaynağında video akışı bulunamadı.",
        ));
    }
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("Untitled media");
    let duration_ms = value
        .get("duration")
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite() && *n > 0.0)
        .map(|n| (n * 1000.0).round() as u64);
    let is_live = value.get("is_live").and_then(Value::as_bool) == Some(true)
        || matches!(
            value.get("live_status").and_then(Value::as_str),
            Some("is_live" | "is_upcoming" | "post_live")
        );
    let thumbnail = value
        .get("thumbnail")
        .and_then(Value::as_str)
        .and_then(|s| url_safety::validate_public_http_url(s, 4096).ok())
        .map(|u| u.to_string());
    let profiles = normalize_profiles(&value);
    Ok(ResolvedMedia {
        url: url.to_string(),
        title: title.to_owned(),
        uploader: value
            .get("uploader")
            .and_then(Value::as_str)
            .map(str::to_owned),
        duration_ms,
        thumbnail,
        profiles,
        drm: false,
        direct: false,
        is_live,
        refresh_url: Some(url.to_string()),
        request_context: context.clone(),
    })
}

fn is_known_non_media_page(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if !matches!(
        host.as_str(),
        "youtube.com" | "www.youtube.com" | "m.youtube.com"
    ) {
        return false;
    }
    let path = url.path().trim_end_matches('/');
    path.starts_with("/@")
        || path.starts_with("/channel/")
        || path.starts_with("/user/")
        || path.starts_with("/c/")
}

fn is_direct_media_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [".mp4", ".webm", ".mov", ".m4v", ".m3u8", ".m3u", ".mpd"]
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn candidate_is_audio_only(candidate: &MediaCandidate) -> bool {
    candidate
        .mime_type
        .as_deref()
        .is_some_and(|mime| mime.to_ascii_lowercase().starts_with("audio/"))
}

fn has_video_stream(value: &Value) -> bool {
    let top_level_video = value
        .get("vcodec")
        .and_then(Value::as_str)
        .is_some_and(|codec| codec != "none");
    top_level_video
        || value
            .get("formats")
            .and_then(Value::as_array)
            .is_some_and(|formats| {
                formats.iter().any(|format| {
                    format
                        .get("vcodec")
                        .and_then(Value::as_str)
                        .is_some_and(|codec| codec != "none")
                })
            })
}

fn direct_media(
    url: &Url,
    suggested_title: Option<&str>,
    duration_ms: Option<u64>,
    request_context: RequestContext,
    refresh_url: Option<String>,
) -> ResolvedMedia {
    let filename = url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|value| !value.is_empty())
        .unwrap_or("video");
    let fallback_title = filename
        .rsplit_once('.')
        .map(|(name, _)| name)
        .filter(|name| !name.is_empty())
        .unwrap_or(filename);
    let lower_path = url.path().to_ascii_lowercase();
    let is_manifest = [".m3u8", ".m3u", ".mpd"]
        .iter()
        .any(|extension| lower_path.ends_with(extension));
    ResolvedMedia {
        url: url.to_string(),
        title: suggested_title
            .filter(|title| !title.trim().is_empty())
            .unwrap_or(fallback_title)
            .to_owned(),
        uploader: url.host_str().map(str::to_owned),
        duration_ms,
        thumbnail: None,
        profiles: vec![QualityProfile {
            height: None,
            label: "Kaynak kalite".into(),
            fps: None,
        }],
        drm: false,
        direct: true,
        is_live: duration_ms.is_none() && is_manifest,
        refresh_url,
        request_context,
    }
}

fn is_drm(value: &Value) -> bool {
    if value.get("has_drm").and_then(Value::as_bool) == Some(true) {
        return true;
    }
    value
        .get("formats")
        .and_then(Value::as_array)
        .is_some_and(|formats| {
            formats
                .iter()
                .any(|format| format.get("has_drm").and_then(Value::as_bool) == Some(true))
        })
}

fn normalize_profiles(value: &Value) -> Vec<QualityProfile> {
    let mut profiles = vec![QualityProfile {
        height: None,
        label: "En iyi kalite".into(),
        fps: None,
    }];
    let mut qualities: Vec<(u32, u32, Option<f64>)> = value
        .get("formats")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|format| format.get("has_drm").and_then(Value::as_bool) != Some(true))
        .filter(|format| format.get("vcodec").and_then(Value::as_str) != Some("none"))
        .filter_map(|format| {
            let height = format
                .get("height")
                .and_then(Value::as_u64)
                .and_then(|n| u32::try_from(n).ok())?;
            if !(100..=4320).contains(&height) {
                return None;
            }
            Some((
                nominal_quality(format, height),
                height,
                format.get("fps").and_then(Value::as_f64),
            ))
        })
        .collect();
    qualities.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    let mut grouped: Vec<(u32, u32, Option<f64>)> = Vec::new();
    for (nominal, actual, fps) in qualities {
        if let Some(existing) = grouped.iter_mut().find(|entry| entry.0 == nominal) {
            existing.1 = existing.1.max(actual);
            existing.2 = match (existing.2, fps) {
                (Some(left), Some(right)) => Some(left.max(right)),
                (left, right) => left.or(right),
            };
        } else {
            grouped.push((nominal, actual, fps));
        }
    }
    grouped.truncate(10);
    profiles.extend(
        grouped
            .into_iter()
            .map(|(nominal, selector_height, fps)| QualityProfile {
                height: Some(selector_height),
                label: if fps.is_some_and(|fps| fps >= 50.0) {
                    format!("{nominal}p60")
                } else {
                    format!("{nominal}p")
                },
                fps,
            }),
    );
    profiles
}

fn nominal_quality(format: &Value, actual_height: u32) -> u32 {
    for field in ["format_note", "resolution", "format"] {
        if let Some(label) = format.get(field).and_then(Value::as_str) {
            if let Some(height) = parse_progressive_label(label) {
                return height;
            }
        }
    }
    const STANDARD_HEIGHTS: [u32; 9] = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];
    STANDARD_HEIGHTS
        .into_iter()
        .min_by_key(|height| height.abs_diff(actual_height))
        .filter(|height| height.abs_diff(actual_height) as f64 / *height as f64 <= 0.08)
        .unwrap_or(actual_height)
}

fn parse_progressive_label(label: &str) -> Option<u32> {
    let bytes = label.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if !matches!(byte, b'p' | b'P') || index == 0 {
            continue;
        }
        let mut start = index;
        while start > 0 && bytes[start - 1].is_ascii_digit() {
            start -= 1;
        }
        if start == index {
            continue;
        }
        let height = label.get(start..index)?.parse::<u32>().ok()?;
        if (100..=4320).contains(&height) {
            return Some(height);
        }
    }
    None
}

pub fn format_selector(height: Option<u32>) -> Result<String, AppError> {
    match height {
        None => Ok("bv[vcodec^=avc]+ba[acodec^=mp4a]/bv+ba/best".into()),
        Some(height) if (100..=4320).contains(&height) => Ok(format!(
            "bv[height<={height}][vcodec^=avc]+ba[acodec^=mp4a]/bv[height<={height}]+ba/b[height<={height}]"
        )),
        _ => Err(AppError::new("INVALID_QUALITY", "Geçersiz kalite seçimi.")),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        direct_media, has_video_stream, is_direct_media_path, is_known_non_media_page,
        normalize_profiles, preferred_duration,
    };
    use crate::models::RequestContext;
    use url::Url;

    #[test]
    fn uses_detected_duration_when_extractor_omits_it() {
        assert_eq!(preferred_duration(None, Some(17_250)), Some(17_250));
        assert_eq!(preferred_duration(Some(16_000), Some(17_250)), Some(16_000));
        assert_eq!(preferred_duration(None, Some(0)), None);
    }

    #[test]
    fn recognizes_direct_and_manifest_paths() {
        for path in [
            "/video.mp4",
            "/video.webm",
            "/video.mov",
            "/master.m3u8",
            "/stream.mpd",
        ] {
            assert!(is_direct_media_path(path), "expected direct path: {path}");
        }
        assert!(!is_direct_media_path("/watch/123"));
        assert!(!is_direct_media_path("/segment001.ts"));
    }

    #[test]
    fn treats_unknown_duration_manifests_as_live() {
        let media = direct_media(
            &Url::parse("https://cdn.example/live/master.m3u8").unwrap(),
            None,
            None,
            RequestContext::default(),
            Some("https://example.com/watch/1".into()),
        );
        assert!(media.is_live);
        assert_eq!(
            media.refresh_url.as_deref(),
            Some("https://example.com/watch/1")
        );
    }

    #[test]
    fn rejects_youtube_profile_before_starting_the_extractor() {
        assert!(is_known_non_media_page(
            &Url::parse("https://www.youtube.com/@BugraSisman").unwrap()
        ));
        assert!(!is_known_non_media_page(
            &Url::parse("https://www.youtube.com/watch?v=video").unwrap()
        ));
    }

    #[test]
    fn normalizes_encoded_heights_to_player_quality_tiers() {
        let value = json!({
            "formats": [
                { "height": 1350, "fps": 60.0, "vcodec": "avc1" },
                { "height": 1012, "fps": 60.0, "vcodec": "avc1" },
                { "height": 674, "fps": 60.0, "vcodec": "avc1" },
                { "height": 450, "fps": 30.0, "vcodec": "avc1" },
                { "height": 338, "fps": 30.0, "vcodec": "avc1" },
                { "height": 224, "fps": 30.0, "vcodec": "avc1" },
                { "height": 134, "fps": 30.0, "vcodec": "avc1" }
            ]
        });
        let labels: Vec<String> = normalize_profiles(&value)
            .into_iter()
            .map(|profile| profile.label)
            .collect();
        assert_eq!(
            labels,
            [
                "En iyi kalite",
                "1440p60",
                "1080p60",
                "720p60",
                "480p",
                "360p",
                "240p",
                "144p"
            ]
        );
    }

    #[test]
    fn prefers_extractor_quality_label() {
        let value = json!({
            "formats": [
                { "height": 1000, "fps": 30.0, "vcodec": "avc1", "format_note": "1080p" }
            ]
        });
        assert_eq!(normalize_profiles(&value)[1].label, "1080p");
    }

    #[test]
    fn rejects_audio_only_extractor_metadata() {
        let audio = json!({
            "vcodec": "none",
            "formats": [{ "vcodec": "none", "acodec": "mp4a.40.5" }]
        });
        let video = json!({
            "formats": [
                { "vcodec": "none", "acodec": "mp4a.40.2" },
                { "vcodec": "avc1.640028", "acodec": "none" }
            ]
        });
        assert!(!has_video_stream(&audio));
        assert!(has_video_stream(&video));
    }
}
