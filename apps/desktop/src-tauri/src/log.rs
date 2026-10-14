//! Local, privacy-preserving diagnostic log.
//!
//! The log never leaves the computer. Before a line is written, URLs are
//! reduced to their host and the Windows profile directory is replaced with
//! `%USERPROFILE%`, so the file can be shared for support without exposing
//! visited pages, signed media tokens or the user's account name.

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

const LOG_FILE: &str = "lipit.log";
const MAX_LOG_BYTES: u64 = 1024 * 1024;
const ROTATED_FILES: usize = 4;
const MAX_LINE_CHARS: usize = 4000;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn as_str(self) -> &'static str {
        match self {
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
        }
    }
}

pub fn init(directory: PathBuf) {
    let _ = fs::create_dir_all(&directory);
    let _ = LOG_DIR.set(directory);
}

pub fn directory() -> Option<PathBuf> {
    LOG_DIR.get().cloned()
}

pub fn info(message: impl AsRef<str>) {
    write(Level::Info, message.as_ref());
}

pub fn warn(message: impl AsRef<str>) {
    write(Level::Warn, message.as_ref());
}

pub fn error(message: impl AsRef<str>) {
    write(Level::Error, message.as_ref());
}

fn write(level: Level, message: &str) {
    let Some(directory) = LOG_DIR.get() else {
        return;
    };
    let Ok(_guard) = WRITE_LOCK.lock() else {
        return;
    };
    let path = directory.join(LOG_FILE);
    if fs::metadata(&path).is_ok_and(|metadata| metadata.len() > MAX_LOG_BYTES) {
        rotate(directory);
    }
    let mut line = mask(message);
    if line.chars().count() > MAX_LINE_CHARS {
        line = line.chars().take(MAX_LINE_CHARS).collect::<String>() + "…";
    }
    let line = line.replace(['\r', '\n'], " ⏎ ");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{} {} {}", timestamp(), level.as_str(), line);
    }
}

fn rotate(directory: &std::path::Path) {
    let name = |index: usize| directory.join(format!("lipit.{index}.log"));
    let _ = fs::remove_file(name(ROTATED_FILES));
    for index in (1..ROTATED_FILES).rev() {
        let _ = fs::rename(name(index), name(index + 1));
    }
    let _ = fs::rename(directory.join(LOG_FILE), name(1));
}

/// Masks URLs (host only) and the user's profile directory.
pub fn mask(message: &str) -> String {
    let mut masked = String::with_capacity(message.len());
    let mut rest = message;
    while let Some(start) = find_url_start(rest) {
        masked.push_str(&rest[..start]);
        let candidate = &rest[start..];
        let end = candidate
            .find(|character: char| {
                character.is_whitespace() || matches!(character, '"' | '\'' | '<' | '>' | ')')
            })
            .unwrap_or(candidate.len());
        let url = &candidate[..end];
        let host = url::Url::parse(url)
            .ok()
            .and_then(|parsed| parsed.host_str().map(str::to_owned))
            .unwrap_or_else(|| "?".into());
        masked.push_str(&format!("<url:{host}>"));
        rest = &candidate[end..];
    }
    masked.push_str(rest);
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        let profile = profile.to_string_lossy().into_owned();
        if profile.len() > 3 {
            masked = replace_case_insensitive(&masked, &profile, "%USERPROFILE%");
            masked =
                replace_case_insensitive(&masked, &profile.replace('\\', "/"), "%USERPROFILE%");
        }
    }
    masked
}

fn find_url_start(value: &str) -> Option<usize> {
    let lower = value.to_ascii_lowercase();
    match (lower.find("http://"), lower.find("https://")) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (left, right) => left.or(right),
    }
}

fn replace_case_insensitive(haystack: &str, needle: &str, replacement: &str) -> String {
    let lower_haystack = haystack.to_lowercase();
    let lower_needle = needle.to_lowercase();
    if lower_needle.is_empty() || lower_haystack.len() != haystack.len() {
        return haystack.replace(needle, replacement);
    }
    let mut result = String::with_capacity(haystack.len());
    let mut position = 0;
    while let Some(found) = lower_haystack[position..].find(&lower_needle) {
        let start = position + found;
        result.push_str(&haystack[position..start]);
        result.push_str(replacement);
        position = start + needle.len();
    }
    result.push_str(&haystack[position..]);
    result
}

fn timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let (year, month, day) = crate::filename::civil_from_days((seconds / 86_400) as i64);
    let remainder = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        remainder / 3600,
        (remainder % 3600) / 60,
        remainder % 60
    )
}

#[cfg(test)]
mod tests {
    use super::mask;

    #[test]
    fn masks_urls_to_their_host() {
        assert_eq!(
            mask("failed https://cdn.example.org/v.mp4?token=secret now"),
            "failed <url:cdn.example.org> now"
        );
        assert_eq!(mask("no url here"), "no url here");
    }
}
