// Once-a-day release check against public release pages. It only reads
// version numbers; nothing is downloaded or installed without confirmation.
// The check can be turned off in Settings ("Güncellemeleri denetle").

import { compareVersions, extensionVersionFor, releaseTagVersion } from "./format.ts";

const LAST_CHECK_KEY = "lipit.updates.lastCheck";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const APP_RELEASES = "https://api.github.com/repos/duhapolat/lipit-capture/releases?per_page=5";
const ENGINE_RELEASE = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

export type UpdateInfo = {
  app: { version: string; url: string } | null;
  engine: { version: string } | null;
};

type Release = { tag_name?: string; html_url?: string; draft?: boolean };

const fetchJson = async <T,>(url: string): Promise<T | null> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
};

export const updateCheckDue = () => {
  try {
    const last = Number(window.localStorage.getItem(LAST_CHECK_KEY) || 0);
    return !Number.isFinite(last) || Date.now() - last > CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
};

export const checkForUpdates = async (
  appVersion: string,
  engineVersion: string | null,
): Promise<UpdateInfo> => {
  const [releases, engine] = await Promise.all([
    fetchJson<Release[]>(APP_RELEASES),
    engineVersion ? fetchJson<Release>(ENGINE_RELEASE) : Promise.resolve(null),
  ]);
  try {
    window.localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    // Storage may be unavailable; the check simply runs again next start.
  }
  const current = extensionVersionFor(appVersion) ?? appVersion;
  const newest = (releases ?? [])
    .filter((release) => !release.draft && release.tag_name)
    .map((release) => ({
      version: releaseTagVersion(release.tag_name ?? ""),
      tag: (release.tag_name ?? "").replace(/^v/i, ""),
      url: release.html_url ?? "",
    }))
    .sort((left, right) => compareVersions(right.version, left.version))[0];
  const engineTag = engine?.tag_name?.trim();
  return {
    app:
      newest && compareVersions(newest.version, current) > 0
        ? { version: newest.tag, url: newest.url }
        : null,
    engine:
      engineTag && engineVersion && compareVersions(engineTag, engineVersion) > 0
        ? { version: engineTag }
        : null,
  };
};
