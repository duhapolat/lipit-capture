use std::{
    collections::HashMap,
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{watch, Semaphore};
use uuid::Uuid;

use crate::{
    binary::{self, Binary},
    clip::{self, ClipSpec},
    history, media,
    models::{
        AppError, ClipMode, ClipRequest, DownloadJob, DownloadRequest, JobKind, JobStatus,
        RequestContext,
    },
    settings,
};

#[derive(Clone)]
pub struct JobManager {
    shared: Arc<Shared>,
}

struct Shared {
    jobs: Mutex<HashMap<String, DownloadJob>>,
    cancellations: Mutex<HashMap<String, watch::Sender<bool>>>,
    capacity: Semaphore,
}

impl Default for JobManager {
    fn default() -> Self {
        Self {
            shared: Arc::new(Shared {
                jobs: Mutex::new(HashMap::new()),
                cancellations: Mutex::new(HashMap::new()),
                capacity: Semaphore::new(1),
            }),
        }
    }
}

pub fn cleanup_stale_cache(app: &AppHandle) {
    let Ok(root) = app.path().app_cache_dir().map(|path| path.join("jobs")) else {
        return;
    };
    if root.is_dir() {
        let _ = fs::remove_dir_all(&root);
    }
    let _ = fs::create_dir_all(root);
}

impl JobManager {
    pub async fn start(
        &self,
        app: AppHandle,
        request: DownloadRequest,
    ) -> Result<DownloadJob, AppError> {
        self.enqueue(app, request, None).await
    }

    pub async fn start_clip(
        &self,
        app: AppHandle,
        request: ClipRequest,
    ) -> Result<DownloadJob, AppError> {
        let clip = ClipSpec::from_request(&request)?;
        let download = DownloadRequest {
            url: request.url,
            quality_height: request.quality_height,
            output_path: request.output_path,
            direct: request.direct,
            refresh_url: request.refresh_url,
            known_duration_ms: request.known_duration_ms,
            request_context: request.request_context,
        };
        self.enqueue(app, download, Some(clip)).await
    }

    async fn enqueue(
        &self,
        app: AppHandle,
        request: DownloadRequest,
        clip: Option<ClipSpec>,
    ) -> Result<DownloadJob, AppError> {
        media::validate_url(&request.url)?;
        if let Some(refresh_url) = request.refresh_url.as_deref() {
            media::validate_url(refresh_url)?;
        }
        media::format_selector(request.quality_height)?;
        settings::validate_request_context(&request.request_context)?;
        if request
            .known_duration_ms
            .is_some_and(|duration| duration == 0 || duration > 7 * 24 * 60 * 60 * 1000)
        {
            return Err(AppError::new("INVALID_DURATION", "Medya süresi geçersiz."));
        }
        let destination = validate_destination(&request.output_path)?;
        let id = Uuid::new_v4().to_string();
        let job = DownloadJob {
            id: id.clone(),
            kind: if clip.is_some() {
                JobKind::Clip
            } else {
                JobKind::Download
            },
            source_url: request.url.clone(),
            quality_height: request.quality_height,
            start_ms: clip.map(|value| value.start_ms),
            end_ms: clip.map(|value| value.end_ms),
            clip_mode: clip.map(|value| value.mode),
            output_path: destination.to_string_lossy().into_owned(),
            status: JobStatus::Queued,
            progress_percent: Some(0.0),
            speed_bytes_per_second: None,
            eta_seconds: None,
            error: None,
        };
        let (sender, receiver) = watch::channel(false);
        {
            let mut jobs = self.shared.jobs.lock().map_err(lock_error)?;
            if jobs.values().any(|current| {
                !matches!(
                    current.status,
                    JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled
                ) && current.kind == job.kind
                    && current.source_url == job.source_url
                    && current.start_ms == job.start_ms
                    && current.end_ms == job.end_ms
            }) {
                return Err(AppError::new(
                    "DUPLICATE_JOB",
                    "Aynı video için bu işlem zaten sırada veya devam ediyor.",
                ));
            }
            jobs.insert(id.clone(), job.clone());
        }
        self.shared
            .cancellations
            .lock()
            .map_err(lock_error)?
            .insert(id.clone(), sender);
        let _ = app.emit("job-update", &job);
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            manager
                .execute(app, request, clip, destination, id, receiver)
                .await;
        });
        Ok(job)
    }

    pub async fn cancel(&self, app: &AppHandle, id: &str) -> Result<(), AppError> {
        let sender = self
            .shared
            .cancellations
            .lock()
            .map_err(lock_error)?
            .get(id)
            .cloned()
            .ok_or_else(|| {
                AppError::new("JOB_NOT_FOUND", "İşlem bulunamadı veya zaten tamamlandı.")
            })?;
        sender
            .send(true)
            .map_err(|_| AppError::new("JOB_NOT_FOUND", "İşlem artık çalışmıyor."))?;
        self.update(app, id, |job| {
            if job.status == JobStatus::Queued {
                job.status = JobStatus::Cancelled;
            }
        });
        Ok(())
    }

    pub async fn list(&self) -> Vec<DownloadJob> {
        self.shared
            .jobs
            .lock()
            .map(|jobs| jobs.values().cloned().collect())
            .unwrap_or_default()
    }

    pub async fn has_active(&self) -> bool {
        self.shared
            .jobs
            .lock()
            .map(|jobs| {
                jobs.values().any(|job| {
                    !matches!(
                        job.status,
                        JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled
                    )
                })
            })
            .unwrap_or(false)
    }

    fn update(&self, app: &AppHandle, id: &str, change: impl FnOnce(&mut DownloadJob)) {
        if let Ok(mut jobs) = self.shared.jobs.lock() {
            if let Some(job) = jobs.get_mut(id) {
                change(job);
                let _ = app.emit("job-update", job.clone());
            }
        }
    }

    async fn execute(
        &self,
        app: AppHandle,
        request: DownloadRequest,
        clip: Option<ClipSpec>,
        destination: PathBuf,
        id: String,
        cancel: watch::Receiver<bool>,
    ) {
        let permit = match self.shared.capacity.acquire().await {
            Ok(permit) => permit,
            Err(_) => return,
        };
        let cache_root = app
            .path()
            .app_cache_dir()
            .ok()
            .map(|path| path.join("jobs"));
        let job_dir = cache_root.as_ref().map(|root| root.join(&id));
        let result = if *cancel.borrow() {
            Err(AppError::new("CANCELLED", "İşlem iptal edildi."))
        } else if let Some(job_dir) = job_dir.as_ref() {
            self.execute_inner(&app, &request, clip, &destination, &id, job_dir, cancel)
                .await
        } else {
            Err(AppError::new(
                "TEMP_UNAVAILABLE",
                "Geçici klasör oluşturulamadı.",
            ))
        };
        if let (Some(root), Some(dir)) = (cache_root.as_ref(), job_dir.as_ref()) {
            if dir.parent() == Some(root.as_path())
                && dir.file_name().and_then(|s| s.to_str()) == Some(id.as_str())
            {
                let _ = fs::remove_dir_all(dir);
            }
        }
        match result {
            Ok(()) => {
                let _ = history::record_completed(&app, &id, &request, clip, &destination);
                self.update(&app, &id, |job| {
                    job.status = JobStatus::Completed;
                    job.progress_percent = Some(100.0);
                    job.speed_bytes_per_second = None;
                    job.eta_seconds = None;
                });
            }
            Err(error) if error.code == "CANCELLED" => self.update(&app, &id, |job| {
                job.status = JobStatus::Cancelled;
                job.error = None;
            }),
            Err(error) => self.update(&app, &id, |job| {
                job.status = JobStatus::Failed;
                job.error = Some(error);
            }),
        }
        self.shared
            .cancellations
            .lock()
            .ok()
            .and_then(|mut items| items.remove(&id));
        drop(permit);
    }

    #[allow(clippy::too_many_arguments)]
    async fn execute_inner(
        &self,
        app: &AppHandle,
        request: &DownloadRequest,
        clip: Option<ClipSpec>,
        destination: &Path,
        id: &str,
        job_dir: &Path,
        cancel: watch::Receiver<bool>,
    ) -> Result<(), AppError> {
        fs::create_dir_all(job_dir)
            .map_err(|_| AppError::new("TEMP_UNAVAILABLE", "Geçici klasör oluşturulamadı."))?;
        self.update(app, id, |job| job.status = JobStatus::Resolving);
        let mut media = if request.direct {
            if let Some(refresh_url) = request
                .refresh_url
                .as_deref()
                .filter(|value| *value != request.url)
            {
                match media::resolve_with_context(
                    app,
                    refresh_url,
                    &request.request_context,
                    Some(cancel.clone()),
                )
                .await
                {
                    Ok(media) => media,
                    Err(error) if error.code == "CANCELLED" => return Err(error),
                    Err(_) => media::resolve_direct(
                        &request.url,
                        request.known_duration_ms,
                        request.request_context.clone(),
                    )?,
                }
            } else {
                media::resolve_direct(
                    &request.url,
                    request.known_duration_ms,
                    request.request_context.clone(),
                )?
            }
        } else {
            media::resolve_with_context(
                app,
                &request.url,
                &request.request_context,
                Some(cancel.clone()),
            )
            .await?
        };
        if media.duration_ms.is_none() {
            media.duration_ms = request.known_duration_ms;
        }
        if clip.is_none() && media.is_live {
            return Err(AppError::new(
                "LIVE_DOWNLOAD_REQUIRES_CLIP",
                "Canlı yayınlarda tamamını indirmek yerine süreli bir klip oluşturun.",
            ));
        }
        if let Some(clip) = clip {
            clip.validate(media.duration_ms)?;
        }
        if !media
            .profiles
            .iter()
            .any(|p| p.height == request.quality_height)
        {
            return Err(AppError::new(
                "INVALID_QUALITY",
                "Seçilen kalite artık mevcut değil.",
            ));
        }
        if *cancel.borrow() {
            return Err(AppError::new("CANCELLED", "İşlem iptal edildi."));
        }
        self.update(app, id, |job| job.status = JobStatus::Downloading);
        if media.direct {
            let target = job_dir.join("media.mp4");
            if clip.is_some_and(|value| matches!(value.mode, ClipMode::Precise)) {
                self.update(app, id, |job| job.status = JobStatus::Encoding);
            }
            let args = direct_ffmpeg_args(&media.url, &target, clip, &request.request_context)?;
            let expected_ms = clip
                .map(ClipSpec::duration_ms)
                .or(media.duration_ms)
                .filter(|duration| *duration > 0);
            let manager = self.clone();
            let app_for_progress = app.clone();
            let id_for_progress = id.to_owned();
            binary::run(
                app,
                Binary::Ffmpeg,
                &args,
                Duration::from_secs(60 * 60 * 6),
                Some(cancel.clone()),
                move |_, line| {
                    if let Some(percent) =
                        expected_ms.and_then(|duration| parse_ffmpeg_progress(line, duration))
                    {
                        manager.update(&app_for_progress, &id_for_progress, |job| {
                            job.progress_percent = Some(percent);
                        });
                    }
                },
            )
            .await?;
        } else {
            let selector = media::format_selector(request.quality_height)?;
            let output_template = job_dir.join("media.%(ext)s").to_string_lossy().into_owned();
            let mut args = vec![
                "--ignore-config".into(), "--no-playlist".into(), "--newline".into(),
                "--no-warnings".into(), "--progress".into(),
                "--progress-template".into(), "download:LIPIT_PROGRESS|%(progress._percent_str)s|%(progress.speed)s|%(progress.eta)s".into(),
                "-f".into(), selector,
                "--merge-output-format".into(), "mp4".into(),
                "-o".into(), output_template,
            ];
            args.extend(settings::yt_dlp_args(app, &request.request_context)?);
            if let Some(clip) = clip {
                args.extend(["--download-sections".into(), clip.section()]);
                if matches!(clip.mode, ClipMode::Precise) {
                    args.push("--force-keyframes-at-cuts".into());
                }
            }
            if let Some(ffmpeg_dir) = binary::ffmpeg_dir() {
                args.extend([
                    "--ffmpeg-location".into(),
                    ffmpeg_dir.to_string_lossy().into_owned(),
                ]);
            }
            args.extend(["--".into(), request.url.clone()]);
            let manager = self.clone();
            let app_for_progress = app.clone();
            let id_for_progress = id.to_owned();
            binary::run(
                app,
                Binary::YtDlp,
                &args,
                Duration::from_secs(60 * 60 * 6),
                Some(cancel.clone()),
                move |_, line| {
                    if let Some((percent, speed, eta)) = parse_progress(line) {
                        manager.update(&app_for_progress, &id_for_progress, |job| {
                            job.progress_percent = Some(percent);
                            job.speed_bytes_per_second = speed;
                            job.eta_seconds = eta;
                        });
                    }
                },
            )
            .await?;
        }
        if *cancel.borrow() {
            return Err(AppError::new("CANCELLED", "İşlem iptal edildi."));
        }
        let downloaded = find_download(job_dir)?;
        self.update(app, id, |job| job.status = JobStatus::Analyzing);
        let probe_args = vec![
            "-v".into(),
            "error".into(),
            "-show_entries".into(),
            "format=format_name:stream=codec_type,codec_name".into(),
            "-of".into(),
            "json".into(),
            downloaded.to_string_lossy().into_owned(),
        ];
        let probe = binary::run(
            app,
            Binary::Ffprobe,
            &probe_args,
            Duration::from_secs(30),
            Some(cancel.clone()),
            |_, _| {},
        )
        .await?;
        let info: Value = serde_json::from_str(&probe.stdout).map_err(|_| {
            AppError::new("FFPROBE_INVALID", "İndirilen dosyanın biçimi okunamadı.")
        })?;
        let final_media =
            prepare_mp4(app, self, id, job_dir, &downloaded, &info, cancel.clone()).await?;
        if *cancel.borrow() {
            return Err(AppError::new("CANCELLED", "İşlem iptal edildi."));
        }
        self.update(app, id, |job| job.status = JobStatus::Saving);
        save_noclobber(&final_media, destination)?;
        Ok(())
    }
}

fn direct_ffmpeg_args(
    source_url: &str,
    target: &Path,
    clip: Option<ClipSpec>,
    context: &RequestContext,
) -> Result<Vec<String>, AppError> {
    let mut args = vec!["-hide_banner".into(), "-nostdin".into(), "-y".into()];
    let restricted_protocols = [
        "-protocol_whitelist".into(),
        "http,https,tcp,tls,crypto,httpproxy".into(),
    ];
    if let Some(spec) = clip {
        let coarse_start = if matches!(spec.mode, ClipMode::Precise) {
            spec.start_ms.saturating_sub(5_000)
        } else {
            spec.start_ms
        };
        args.extend(["-ss".into(), clip::seconds(coarse_start)]);
        args.extend(restricted_protocols.clone());
        args.extend(settings::ffmpeg_input_args(context)?);
        args.extend(["-i".into(), source_url.into()]);
        if matches!(spec.mode, ClipMode::Precise) {
            args.extend(["-ss".into(), clip::seconds(spec.start_ms - coarse_start)]);
        }
        args.extend(["-t".into(), clip::seconds(spec.duration_ms())]);
        args.extend([
            "-map".into(),
            "0:v:0".into(),
            "-map".into(),
            "0:a:0?".into(),
        ]);
        if matches!(spec.mode, ClipMode::Precise) {
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "medium".into(),
                "-crf".into(),
                "18".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "192k".into(),
            ]);
        } else {
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "veryfast".into(),
                "-crf".into(),
                "21".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "160k".into(),
            ]);
        }
        args.extend(["-avoid_negative_ts".into(), "make_zero".into()]);
    } else {
        args.extend(restricted_protocols);
        args.extend(settings::ffmpeg_input_args(context)?);
        args.extend(["-i".into(), source_url.into(), "-c".into(), "copy".into()]);
    }
    args.extend([
        "-movflags".into(),
        "+faststart".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        target.to_string_lossy().into_owned(),
    ]);
    Ok(args)
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> AppError {
    AppError::new("INTERNAL_ERROR", "İşlem durumu okunamadı.")
}

fn validate_destination(raw: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(raw);
    if !path.is_absolute()
        || path
            .file_name()
            .and_then(|name| name.to_str())
            .is_none_or(|name| !settings::valid_output_filename(name))
        || path
            .extension()
            .and_then(|s| s.to_str())
            .is_none_or(|s| !s.eq_ignore_ascii_case("mp4"))
    {
        return Err(AppError::new(
            "INVALID_DESTINATION",
            "MP4 dosyası için geçerli bir kayıt konumu seçin.",
        ));
    }
    if !path.parent().is_some_and(Path::is_dir) || path.exists() {
        return Err(AppError::new(
            "FILE_EXISTS",
            "Hedef dosya mevcut veya klasör kullanılamıyor. Başka bir ad seçin.",
        ));
    }
    Ok(path)
}

fn find_download(dir: &Path) -> Result<PathBuf, AppError> {
    let mut files: Vec<(u64, PathBuf)> = fs::read_dir(dir)
        .map_err(|_| AppError::new("NO_MEDIA_FOUND", "İndirilen dosya bulunamadı."))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            let path = entry.path();
            if !metadata.is_file()
                || path
                    .extension()
                    .and_then(|s| s.to_str())
                    .is_some_and(|s| matches!(s, "part" | "ytdl"))
            {
                return None;
            }
            Some((metadata.len(), path))
        })
        .collect();
    files.sort_by_key(|item| std::cmp::Reverse(item.0));
    files
        .into_iter()
        .next()
        .map(|(_, path)| path)
        .ok_or_else(|| AppError::new("NO_MEDIA_FOUND", "İndirilen dosya bulunamadı."))
}

async fn prepare_mp4(
    app: &AppHandle,
    manager: &JobManager,
    id: &str,
    dir: &Path,
    source: &Path,
    info: &Value,
    cancel: watch::Receiver<bool>,
) -> Result<PathBuf, AppError> {
    let streams = info.get("streams").and_then(Value::as_array);
    let video = streams
        .into_iter()
        .flatten()
        .find(|s| s.get("codec_type").and_then(Value::as_str) == Some("video"))
        .and_then(|s| s.get("codec_name"))
        .and_then(Value::as_str);
    let audio = streams
        .into_iter()
        .flatten()
        .find(|s| s.get("codec_type").and_then(Value::as_str) == Some("audio"))
        .and_then(|s| s.get("codec_name"))
        .and_then(Value::as_str);
    if video.is_none() {
        return Err(AppError::new(
            "NO_VIDEO_STREAM",
            "Dosyada video akışı bulunamadı.",
        ));
    }
    let mp4_container = info
        .get("format")
        .and_then(|f| f.get("format_name"))
        .and_then(Value::as_str)
        .is_some_and(|s| s.split(',').any(|name| name == "mp4"));
    if mp4_container && video == Some("h264") && (audio.is_none() || audio == Some("aac")) {
        return Ok(source.to_path_buf());
    }
    manager.update(app, id, |job| job.status = JobStatus::Encoding);
    let target = dir.join("final.mp4");
    let video_codec = if video == Some("h264") {
        "copy"
    } else {
        "libx264"
    };
    let audio_codec = if audio.is_none() || audio == Some("aac") {
        "copy"
    } else {
        "aac"
    };
    let args = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-y".into(),
        "-i".into(),
        source.to_string_lossy().into_owned(),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a:0?".into(),
        "-c:v".into(),
        video_codec.into(),
        "-c:a".into(),
        audio_codec.into(),
        "-movflags".into(),
        "+faststart".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        target.to_string_lossy().into_owned(),
    ];
    binary::run(
        app,
        Binary::Ffmpeg,
        &args,
        Duration::from_secs(60 * 60 * 6),
        Some(cancel),
        |_, _| {},
    )
    .await?;
    Ok(target)
}

fn save_noclobber(source: &Path, destination: &Path) -> Result<(), AppError> {
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::new("INVALID_DESTINATION", "Kayıt konumu geçersiz."))?;
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(file_write_error)?;
    let mut input = File::open(source)
        .map_err(|_| AppError::new("FILE_PERMISSION_DENIED", "Geçici dosya okunamadı."))?;
    io::copy(&mut input, staged.as_file_mut()).map_err(file_write_error)?;
    staged.as_file_mut().flush().map_err(file_write_error)?;
    staged.persist_noclobber(destination).map_err(|error| {
        if destination.exists() {
            AppError::new("FILE_EXISTS", "Hedef dosya zaten mevcut.")
        } else {
            file_write_error(error.error)
        }
    })?;
    Ok(())
}

fn file_write_error(error: io::Error) -> AppError {
    if matches!(error.raw_os_error(), Some(28 | 39 | 112)) {
        AppError::new("DISK_FULL", "Diskte yeterli boş alan yok.")
    } else if error.kind() == io::ErrorKind::PermissionDenied {
        AppError::new(
            "FILE_PERMISSION_DENIED",
            "Seçilen klasöre yazma izni yok veya dosya başka bir uygulama tarafından kullanılıyor.",
        )
    } else {
        AppError::new("FILE_WRITE_FAILED", "Dosya seçilen klasöre kaydedilemedi.")
    }
}

fn parse_progress(line: &str) -> Option<(f64, Option<f64>, Option<u64>)> {
    let parts: Vec<&str> = line
        .trim()
        .strip_prefix("LIPIT_PROGRESS|")?
        .split('|')
        .collect();
    let percent = parts
        .first()?
        .trim()
        .trim_end_matches('%')
        .trim()
        .parse::<f64>()
        .ok()?
        .clamp(0.0, 100.0);
    let speed = parts.get(1).and_then(|s| s.trim().parse::<f64>().ok());
    let eta = parts.get(2).and_then(|s| s.trim().parse::<u64>().ok());
    Some((percent, speed, eta))
}

fn parse_ffmpeg_progress(output: &str, expected_ms: u64) -> Option<f64> {
    let microseconds = output.lines().find_map(|line| {
        line.trim()
            .strip_prefix("out_time_ms=")?
            .parse::<u64>()
            .ok()
    })?;
    let elapsed_ms = microseconds / 1000;
    Some((elapsed_ms as f64 / expected_ms as f64 * 100.0).clamp(0.0, 99.5))
}

#[cfg(test)]
mod tests {
    use super::{direct_ffmpeg_args, parse_ffmpeg_progress};
    use crate::{
        clip::ClipSpec,
        models::{ClipMode, RequestContext},
    };
    use std::path::Path;

    #[test]
    fn precise_clip_uses_two_stage_seek_and_encoding() {
        let args = direct_ffmpeg_args(
            "https://example.com/video.mp4",
            Path::new("clip.mp4"),
            Some(ClipSpec {
                start_ms: 83_500,
                end_ms: 130_000,
                mode: ClipMode::Precise,
            }),
            &RequestContext::default(),
        )
        .unwrap();
        assert!(args.windows(2).any(|pair| pair == ["-ss", "78.500"]));
        assert!(args.windows(2).any(|pair| pair == ["-ss", "5.000"]));
        assert!(args.windows(2).any(|pair| pair == ["-c:v", "libx264"]));
        assert!(args.windows(2).any(|pair| {
            pair == ["-protocol_whitelist", "http,https,tcp,tls,crypto,httpproxy"]
        }));
    }

    #[test]
    fn fast_clip_creates_an_independent_seekable_video() {
        let args = direct_ffmpeg_args(
            "https://example.com/video.mp4",
            Path::new("clip.mp4"),
            Some(ClipSpec {
                start_ms: 83_500,
                end_ms: 130_000,
                mode: ClipMode::Fast,
            }),
            &RequestContext::default(),
        )
        .unwrap();
        assert!(args.windows(2).any(|pair| pair == ["-ss", "83.500"]));
        assert!(args.windows(2).any(|pair| pair == ["-preset", "veryfast"]));
        assert!(args.windows(2).any(|pair| pair == ["-c:v", "libx264"]));
        assert!(!args.windows(2).any(|pair| pair == ["-c", "copy"]));
    }

    #[test]
    fn parses_ffmpeg_microsecond_progress() {
        assert_eq!(
            parse_ffmpeg_progress("out_time_ms=2500000", 5_000),
            Some(50.0)
        );
    }
}
