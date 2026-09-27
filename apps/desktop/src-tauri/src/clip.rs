use crate::models::{AppError, ClipMode, ClipRequest};

pub const MAX_CLIP_DURATION_MS: u64 = 6 * 60 * 60 * 1000;

#[derive(Clone, Copy)]
pub struct ClipSpec {
    pub start_ms: u64,
    pub end_ms: u64,
    pub mode: ClipMode,
}

impl ClipSpec {
    pub fn from_request(request: &ClipRequest) -> Result<Self, AppError> {
        let spec = Self {
            start_ms: request.start_ms,
            end_ms: request.end_ms,
            mode: request.mode,
        };
        spec.validate(None)?;
        Ok(spec)
    }

    pub fn validate(self, source_duration_ms: Option<u64>) -> Result<(), AppError> {
        if self.end_ms <= self.start_ms {
            return Err(AppError::new(
                "INVALID_CLIP_RANGE",
                "Klip bitiş zamanı başlangıçtan sonra olmalıdır.",
            ));
        }
        if self.end_ms - self.start_ms > MAX_CLIP_DURATION_MS {
            return Err(AppError::new(
                "INVALID_CLIP_RANGE",
                "Klip süresi en fazla 6 saat olabilir.",
            ));
        }
        if source_duration_ms.is_some_and(|duration| self.end_ms > duration + 1000) {
            return Err(AppError::new(
                "INVALID_CLIP_RANGE",
                "Klip bitiş zamanı video süresini aşıyor.",
            ));
        }
        Ok(())
    }

    pub fn duration_ms(self) -> u64 {
        self.end_ms - self.start_ms
    }

    pub fn section(self) -> String {
        format!("*{}-{}", seconds(self.start_ms), seconds(self.end_ms))
    }
}

pub fn seconds(milliseconds: u64) -> String {
    format!("{}.{:03}", milliseconds / 1000, milliseconds % 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_millisecond_section() {
        let clip = ClipSpec {
            start_ms: 83_500,
            end_ms: 130_000,
            mode: ClipMode::Fast,
        };
        assert_eq!(clip.section(), "*83.500-130.000");
        assert_eq!(clip.duration_ms(), 46_500);
    }

    #[test]
    fn rejects_invalid_range() {
        let clip = ClipSpec {
            start_ms: 10_000,
            end_ms: 10_000,
            mode: ClipMode::Precise,
        };
        assert_eq!(clip.validate(None).unwrap_err().code, "INVALID_CLIP_RANGE");
    }
}
