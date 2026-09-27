const DIRECT_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v"]);
const HLS_EXTENSIONS = new Set(["m3u8", "m3u"]);
const DASH_EXTENSIONS = new Set(["mpd"]);
const SEGMENT_EXTENSIONS = new Set([
  "ts",
  "m4s",
  "cmfv",
  "cmfa",
  "aac",
  "m4a",
  "mp4a",
  "vtt",
]);
const DIRECT_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const HLS_MIME_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
]);
const DASH_MIME_TYPES = new Set(["application/dash+xml"]);
const ENDPOINT_HINT = /(?:^|[\/_-])(manifest|playlist|videoplayback|stream)(?:[\/_\-.]|$)/i;
const SEGMENT_HINT = /(?:^|[\/_-])(segment|chunk|frag(?:ment)?|init)[_-]?\d*(?:[\/_\-.]|$)/i;
const DRM_HINT = /(?:widevine|playready|fairplay|contentprotection|license|drm|pssh)/i;

export type NetworkObservation = {
  tabId: number;
  url: string;
  type: string;
  documentUrl?: string;
  initiator?: string;
  responseHeaders?: LipitHttpHeader[];
};

export function detectNetworkCandidate(
  observation: NetworkObservation,
): LipitProtocol.MediaCandidate | null {
  if (observation.tabId < 0) return null;
  const mediaUrl = safeHttpUrl(observation.url);
  if (!mediaUrl) return null;
  const mimeType = responseMime(observation.responseHeaders);
  if (isAudioOnlyMedia(mediaUrl, mimeType)) return null;
  const extension = pathExtension(mediaUrl);
  const explicitManifest = HLS_EXTENSIONS.has(extension) || DASH_EXTENSIONS.has(extension);
  if (!explicitManifest && isSegment(mediaUrl, extension)) return null;

  const protocol = classifyProtocol(mediaUrl, extension, mimeType, observation.type);
  if (!protocol) return null;
  const pageUrl =
    safeHttpUrl(observation.documentUrl) ||
    safeHttpUrl(observation.initiator) ||
    mediaUrl;
  const drm =
    DRM_HINT.test(mediaUrl) ||
    (observation.responseHeaders || []).some(
      (header) => DRM_HINT.test(header.name) || DRM_HINT.test(header.value || ""),
    );
  const origin = safeOrigin(pageUrl);
  return {
    id: createNetworkId(),
    tabId: observation.tabId,
    pageUrl,
    mediaUrl,
    source: "network",
    protocol,
    ...(mimeType ? { mimeType } : {}),
    referer: pageUrl,
    ...(origin ? { origin } : {}),
    userAgent: navigator.userAgent.slice(0, 1024),
    drm,
  };
}

function classifyProtocol(
  url: string,
  extension: string,
  mimeType: string | undefined,
  requestType: string,
): LipitProtocol.MediaProtocol | null {
  if (HLS_EXTENSIONS.has(extension) || (mimeType && HLS_MIME_TYPES.has(mimeType))) {
    return "hls";
  }
  if (DASH_EXTENSIONS.has(extension) || (mimeType && DASH_MIME_TYPES.has(mimeType))) {
    return "dash";
  }
  if (
    DIRECT_EXTENSIONS.has(extension) ||
    (mimeType && DIRECT_MIME_TYPES.has(mimeType)) ||
    (ENDPOINT_HINT.test(new URL(url).pathname) &&
      (mimeType?.startsWith("video/") || requestType === "media"))
  ) {
    return "http";
  }
  return null;
}

function isSegment(url: string, extension: string): boolean {
  if (SEGMENT_EXTENSIONS.has(extension)) return true;
  const parsed = new URL(url);
  const pathname = parsed.pathname;
  if (
    ENDPOINT_HINT.test(pathname) &&
    (parsed.searchParams.has("range") || parsed.searchParams.has("sq"))
  ) {
    return true;
  }
  return SEGMENT_HINT.test(pathname) && !ENDPOINT_HINT.test(pathname);
}

function isAudioOnlyMedia(url: string, mimeType: string | undefined): boolean {
  if (mimeType?.startsWith("audio/")) return true;
  const pathname = new URL(url).pathname.toLowerCase();
  return (
    /\/(?:mp4a|aac|opus|audio)\//.test(pathname) ||
    /\/(?:audio|mp4a|aac|opus)[^/]*\.m3u8?$/.test(pathname)
  );
}

function pathExtension(raw: string): string {
  const pathname = new URL(raw).pathname.toLowerCase();
  const filename = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1) : "";
}

function responseMime(headers: LipitHttpHeader[] | undefined): string | undefined {
  const value = headers
    ?.find((header) => header.name.toLowerCase() === "content-type")
    ?.value?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  return value || undefined;
}

function safeHttpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function safeOrigin(raw: string): string | undefined {
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

function createNetworkId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
