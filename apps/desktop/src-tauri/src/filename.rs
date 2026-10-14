//! Output file names. The desktop UI and the background quick-action service
//! both use this single implementation so that names never diverge.

use std::time::{SystemTime, UNIX_EPOCH};

use crate::{
    models::{FilenameTemplate, JobKind},
    settings,
};

const MAX_TITLE_CHARS: usize = 80;

pub fn suggest(
    title: &str,
    source_host: Option<&str>,
    kind: JobKind,
    template: FilenameTemplate,
) -> String {
    let title = sanitize(title).unwrap_or_else(|| "video".into());
    let host = source_host
        .and_then(|host| sanitize(host.trim_start_matches("www.")))
        .unwrap_or_default();
    let suffix = if kind == JobKind::Clip { "_clip" } else { "" };
    let date = today();
    let stem = match template {
        FilenameTemplate::Title => format!("{title}{suffix}"),
        FilenameTemplate::TitleDate => format!("{title}{suffix}_{date}"),
        FilenameTemplate::SourceTitleDate if !host.is_empty() => {
            format!("{host} - {title}{suffix}_{date}")
        }
        FilenameTemplate::SourceTitleDate => format!("{title}{suffix}_{date}"),
    };
    let name = format!("{stem}.mp4");
    if settings::valid_output_filename(&name) {
        name
    } else {
        format!("video{suffix}_{date}.mp4")
    }
}

fn sanitize(raw: &str) -> Option<String> {
    let replaced: String = raw
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                ' '
            } else {
                character
            }
        })
        .collect();
    let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let truncated: String = collapsed.chars().take(MAX_TITLE_CHARS).collect();
    let trimmed = truncated.trim().trim_end_matches(['.', ' ']).to_owned();
    (!trimmed.is_empty()).then_some(trimmed)
}

fn today() -> String {
    let days = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Converts days since 1970-01-01 to a (year, month, day) UTC date.
/// Howard Hinnant's public-domain `civil_from_days` algorithm.
pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_unix_days_to_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_739), (2026, 10, 13));
    }

    #[test]
    fn sanitizes_titles_and_applies_templates() {
        let name = suggest(
            "  A/B: test?  ",
            Some("www.media.example.org"),
            JobKind::Clip,
            FilenameTemplate::Title,
        );
        assert_eq!(name, "A B test_clip.mp4");
        let sourced = suggest(
            "Title",
            Some("www.media.example.org"),
            JobKind::Download,
            FilenameTemplate::SourceTitleDate,
        );
        assert!(sourced.starts_with("media.example.org - Title_"));
        assert!(sourced.ends_with(".mp4"));
    }

    #[test]
    fn falls_back_for_empty_or_reserved_titles() {
        assert!(
            suggest("???", None, JobKind::Download, FilenameTemplate::Title).starts_with("video")
        );
        assert!(
            suggest("CON", None, JobKind::Download, FilenameTemplate::Title).starts_with("video_")
        );
    }
}
