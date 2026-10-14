// Pure helpers shared by the UI. No React or Tauri imports, so they can be
// unit tested with `node --test` (see format.test.ts).

import type { AppError, JobStatus, QualityProfile } from "../types.ts";

export const statusLabels: Record<JobStatus, string> = {
  queued: "Sırada",
  resolving: "Medya çözümleniyor",
  downloading: "İndiriliyor",
  analyzing: "Dosya inceleniyor",
  encoding: "MP4 hazırlanıyor",
  saving: "Kaydediliyor",
  completed: "Tamamlandı",
  failed: "Başarısız",
  cancelled: "İptal edildi",
};

export const isActive = (status: JobStatus) =>
  !["completed", "failed", "cancelled"].includes(status);

export const errorMessage = (error: unknown) =>
  typeof error === "object" && error !== null && "message" in error
    ? String((error as AppError).message)
    : "İşlem tamamlanamadı. Bağlantıyı ve medya araçlarını kontrol edin.";

export const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as AppError).code)
    : "UNKNOWN";

export const formatDuration = (ms: number | null) =>
  ms == null
    ? "Süre bilinmiyor"
    : [
        Math.floor(ms / 3_600_000),
        Math.floor((ms % 3_600_000) / 60_000),
        Math.floor((ms % 60_000) / 1000),
      ]
        .map((part) => String(part).padStart(2, "0"))
        .join(":");

/** `SS:DD:ss.mmm`, the format video tools commonly use. */
export const timecode = (ms: number) => {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const milliseconds = safe % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    seconds,
  ).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
};

/**
 * Accepts `SS:DD:ss.mmm`, `DD:ss.mmm`, `ss.mmm` and the legacy
 * `SS:DD:ss:mmm` format. Milliseconds may have one to three digits.
 */
export const parseTimecode = (value: string): number | null => {
  const text = value.trim();
  const legacy = text.match(/^(\d{1,4}):([0-5]?\d):([0-5]?\d):(\d{1,3})$/);
  const modern = text.match(/^(?:(?:(\d{1,4}):)?([0-5]?\d):)?([0-5]?\d)(?:[.,](\d{1,3}))?$/);
  const match = legacy ?? modern;
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  const milliseconds = fraction ? Number(fraction.padEnd(3, "0")) : 0;
  return (
    Number(hours ?? 0) * 3_600_000 +
    Number(minutes ?? 0) * 60_000 +
    Number(seconds) * 1000 +
    milliseconds
  );
};

export const fileSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
};

export const transferSpeed = (bytesPerSecond: number | null) =>
  bytesPerSecond == null || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0
    ? null
    : `${fileSize(bytesPerSecond)}/sn`;

export const remainingTime = (seconds: number | null) => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `${Math.round(seconds)} sn kaldı`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk ${Math.round(seconds % 60)} sn kaldı`;
  return `${Math.floor(minutes / 60)} sa ${minutes % 60} dk kaldı`;
};

export const historyDate = (milliseconds: number) =>
  new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(milliseconds));

export const clipPresets = [15_000, 30_000, 45_000, 60_000, 120_000, 300_000] as const;
export const qualityPresets = [null, 2160, 1440, 1080, 720, 480] as const;

export const clipPresetLabel = (milliseconds: number) =>
  milliseconds >= 60_000
    ? `${Math.round((milliseconds / 60_000) * 10) / 10} dk`
    : `${Math.round((milliseconds / 1000) * 10) / 10} sn`;

export const qualityPresetLabel = (height: number | null) =>
  height == null ? "En iyi" : `${height}p`;

/** Highest available quality not above the preference, otherwise the lowest. */
export const quickQualityHeight = (
  profiles: QualityProfile[],
  preferredHeight: number | null,
) => {
  if (preferredHeight == null) return profiles[0]?.height ?? null;
  const available = profiles
    .map((profile) => profile.height)
    .filter((height): height is number => height != null)
    .sort((left, right) => right - left);
  return (
    available.find((height) => height <= preferredHeight) ??
    available[available.length - 1] ??
    null
  );
};

export const initialClipRange = (
  durationMs: number | null,
  requestedStart = 0,
  clipDurationMs = 30_000,
) => {
  const knownEnd = durationMs ?? requestedStart + clipDurationMs;
  const startMs = Math.min(Math.max(0, requestedStart), Math.max(0, knownEnd - 100));
  return {
    startMs,
    endMs: Math.min(knownEnd, Math.max(startMs + 100, startMs + clipDurationMs)),
  };
};

/** `1.0.0-beta.5` → `1.0 BETA 5`. */
export const displayVersion = (version: string) => {
  const parts = version.match(/^(\d+\.\d+)\.\d+-beta\.(\d+)$/);
  return parts ? `${parts[1]} BETA ${parts[2]}` : version.toUpperCase();
};

/** The extension's numeric manifest version for an app version (`1.0.0.5`). */
export const extensionVersionFor = (appVersion: string) => {
  const parts = appVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/);
  if (!parts) return null;
  return parts.slice(1).filter((part) => part != null).join(".");
};

/** Compares dotted numeric versions (`2026.08.19`, `1.0.0.5`). */
export const compareVersions = (left: string, right: string) => {
  const parse = (value: string) =>
    value
      .replace(/^v/i, "")
      .split(/[.-]/)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : 0));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
};

/** Normalizes a release tag such as `v1.0.0-beta.6` to `1.0.0.6`. */
export const releaseTagVersion = (tag: string) =>
  extensionVersionFor(tag.replace(/^v/i, "")) ?? tag.replace(/^v/i, "");

export const relativeTime = (milliseconds: number, now = Date.now()) => {
  const seconds = Math.max(0, Math.round((now - milliseconds) / 1000));
  if (seconds < 60) return "az önce";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} sa önce`;
  return `${Math.round(hours / 24)} gün önce`;
};
