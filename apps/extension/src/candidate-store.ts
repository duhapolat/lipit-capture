const STORAGE_KEY = "lipit.media-candidates.v1";
const MAX_CANDIDATES_PER_TAB = 32;
const CANDIDATE_TTL_MS = 30 * 60 * 1000;

type CandidateEntry = {
  candidate: LipitProtocol.MediaCandidate;
  observedAtMs: number;
};

type CandidateState = Record<string, CandidateEntry[]>;

export interface CandidateStorage {
  read(): Promise<CandidateState>;
  write(state: CandidateState): Promise<void>;
}

class SessionCandidateStorage implements CandidateStorage {
  async read(): Promise<CandidateState> {
    const result = await chrome.storage.session.get(STORAGE_KEY);
    const value = result[STORAGE_KEY];
    return isCandidateState(value) ? value : {};
  }

  async write(state: CandidateState): Promise<void> {
    await chrome.storage.session.set({ [STORAGE_KEY]: state });
  }
}

function isCandidateState(value: unknown): value is CandidateState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entries) =>
      Array.isArray(entries) &&
      entries.every(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as Record<string, unknown>).observedAtMs === "number" &&
          typeof (entry as Record<string, unknown>).candidate === "object",
      ),
  );
}

function canonicalUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const name of [
      "token",
      "expires",
      "expire",
      "signature",
      "sig",
      "policy",
      "key-pair-id",
      "range",
      "rn",
      "rbuf",
      "bytestart",
      "byteend",
    ]) {
      url.searchParams.delete(name);
    }
    url.searchParams.sort();
    return url.href;
  } catch {
    return undefined;
  }
}

function candidateKey(candidate: LipitProtocol.MediaCandidate): string {
  const canonical = canonicalUrl(candidate.mediaUrl);
  if (!canonical) return `candidate:${candidate.id}`;
  if (candidate.protocol !== "hls" && candidate.protocol !== "dash") return canonical;
  const url = new URL(canonical);
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .filter(
      (segment) =>
        !/^(?:avc1|hvc1|hev1|vp09|av01|h264|h265|hevc|\d{3,4}p?|\d{2,5}x\d{2,5}|\d{5,9})$/i.test(
          segment,
        ),
    );
  if (segments.length) {
    const last = segments.length - 1;
    if (/\.(?:m3u8?|mpd)$/i.test(segments[last] || "")) segments[last] = "manifest";
  }
  url.pathname = `/${segments.join("/")}`;
  return `${candidate.protocol}:${url.href}`;
}

function protocolStrength(protocol: LipitProtocol.MediaProtocol): number {
  return { unknown: 0, blob: 1, http: 2, hls: 3, dash: 3 }[protocol];
}

function sourceStrength(source: LipitProtocol.CandidateSource): number {
  return { dom: 1, network: 2, extractor: 3 }[source];
}

function mergeCandidate(
  existing: LipitProtocol.MediaCandidate,
  incoming: LipitProtocol.MediaCandidate,
): LipitProtocol.MediaCandidate {
  const preferredMedia =
    manifestRank(incoming) >= manifestRank(existing) ? incoming : existing;
  const strongerProtocol =
    protocolStrength(incoming.protocol) >= protocolStrength(existing.protocol)
      ? incoming.protocol
      : existing.protocol;
  const strongerSource =
    sourceStrength(incoming.source) >= sourceStrength(existing.source)
      ? incoming.source
      : existing.source;
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    tabId: incoming.tabId,
    pageUrl: incoming.pageUrl || existing.pageUrl,
    ...(preferredMedia.mediaUrl ? { mediaUrl: preferredMedia.mediaUrl } : {}),
    ...(preferredMedia.mimeType || incoming.mimeType || existing.mimeType
      ? { mimeType: preferredMedia.mimeType || incoming.mimeType || existing.mimeType }
      : {}),
    source: strongerSource,
    protocol: strongerProtocol,
    drm: Boolean(existing.drm || incoming.drm),
  };
}

function manifestRank(candidate: LipitProtocol.MediaCandidate): number {
  if (candidate.drm) return 10_000;
  const url = candidate.mediaUrl?.toLowerCase() || "";
  if (isAudioOnlyCandidate(candidate)) return -10_000;
  const masterHint = /(?:master|manifest|playlist|main)[^/]*\.(?:m3u8?|mpd)(?:[?#]|$)/.test(
    url,
  );
  const variantHint = /(?:^|\/)(?:index|\d{3,4}p?)[^/]*\.m3u8?(?:[?#]|$)/.test(url);
  const codecVariantHint = /\/(?:avc1|hvc1|hev1|vp09|av01)\//.test(url);
  const twitterRootManifest = /\/pl\/[^/]+\.m3u8?(?:[?#]|$)/.test(url);
  if (candidate.protocol === "dash") return 900 + (masterHint ? 80 : 0);
  if (candidate.protocol === "hls") {
    return (
      800 +
      (masterHint || twitterRootManifest ? 120 : 0) -
      (variantHint || codecVariantHint ? 80 : 0)
    );
  }
  if (candidate.protocol === "http") return 650;
  if (candidate.protocol === "blob") return 100;
  return 0;
}

function isAudioOnlyCandidate(candidate: LipitProtocol.MediaCandidate): boolean {
  if (candidate.mimeType?.toLowerCase().startsWith("audio/")) return true;
  const url = candidate.mediaUrl?.toLowerCase() || "";
  return (
    /\/(?:mp4a|aac|opus|audio)\//.test(url) ||
    /\/(?:audio|mp4a|aac|opus)[^/]*\.m3u8?(?:[?#]|$)/.test(url)
  );
}

function combineDomAndNetwork(
  dom: LipitProtocol.MediaCandidate,
  network: LipitProtocol.MediaCandidate,
): LipitProtocol.MediaCandidate {
  return {
    ...network,
    ...dom,
    id: network.id,
    tabId: dom.tabId,
    pageUrl: dom.pageUrl,
    source: network.source,
    protocol: network.protocol,
    drm: Boolean(dom.drm || network.drm),
  };
}

export class CandidateStore {
  private operation: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: CandidateStorage = new SessionCandidateStorage()) {}

  add(candidate: LipitProtocol.MediaCandidate): Promise<LipitProtocol.MediaCandidate> {
    return this.serialize(async () => {
      const state = await this.storage.read();
      const tabKey = String(candidate.tabId);
      const now = Date.now();
      const entries = (state[tabKey] || []).filter(
        (entry) => now - entry.observedAtMs <= CANDIDATE_TTL_MS,
      );
      const key = candidateKey(candidate);
      const index = entries.findIndex((entry) => candidateKey(entry.candidate) === key);
      let merged = candidate;
      if (index >= 0) {
        const current = entries[index];
        if (current) {
          merged = mergeCandidate(current.candidate, candidate);
          entries[index] = { candidate: merged, observedAtMs: now };
        }
      } else {
        entries.push({ candidate, observedAtMs: now });
      }
      entries.sort(
        (left, right) =>
          manifestRank(right.candidate) - manifestRank(left.candidate) ||
          right.observedAtMs - left.observedAtMs,
      );
      state[tabKey] = entries.slice(0, MAX_CANDIDATES_PER_TAB);
      await this.storage.write(state);
      return merged;
    });
  }

  selectForDom(
    domCandidate: LipitProtocol.MediaCandidate,
  ): Promise<LipitProtocol.MediaCandidate> {
    return this.serialize(async () => {
      const state = await this.storage.read();
      const entries = state[String(domCandidate.tabId)] || [];
      const pageUrl = normalizePageUrl(domCandidate.pageUrl);
      const referer = domCandidate.referer
        ? normalizePageUrl(domCandidate.referer)
        : undefined;
      if (pageUrl && referer && pageUrl !== referer) return domCandidate;
      const exactUrl = canonicalUrl(domCandidate.mediaUrl);
      if (exactUrl) {
        const exact = entries.find(
          (entry) => canonicalUrl(entry.candidate.mediaUrl) === exactUrl,
        );
        if (exact) return combineDomAndNetwork(domCandidate, exact.candidate);
        return domCandidate;
      }
      if (isTikTokPageWithoutVideoPermalink(domCandidate.pageUrl)) {
        return domCandidate;
      }
      const pageOrigin = safeOrigin(domCandidate.pageUrl);
      const best = entries
        .filter((entry) => Date.now() - entry.observedAtMs <= CANDIDATE_TTL_MS)
        .filter((entry) => !isAudioOnlyCandidate(entry.candidate))
        .filter((entry) => {
          const candidateOrigin = safeOrigin(entry.candidate.pageUrl);
          return !pageOrigin || !candidateOrigin || pageOrigin === candidateOrigin;
        })
        .sort(
          (left, right) =>
            manifestRank(right.candidate) - manifestRank(left.candidate) ||
            right.observedAtMs - left.observedAtMs,
        )[0];
      return best ? combineDomAndNetwork(domCandidate, best.candidate) : domCandidate;
    });
  }

  clearTab(tabId: number): Promise<void> {
    return this.serialize(async () => {
      const state = await this.storage.read();
      delete state[String(tabId)];
      await this.storage.write(state);
    });
  }

  changePage(tabId: number, pageUrl: string): Promise<void> {
    return this.serialize(async () => {
      const state = await this.storage.read();
      const normalized = normalizePageUrl(pageUrl);
      state[String(tabId)] = (state[String(tabId)] || []).filter(
        (entry) => normalizePageUrl(entry.candidate.pageUrl) === normalized,
      );
      await this.storage.write(state);
    });
  }

  list(tabId: number): Promise<LipitProtocol.MediaCandidate[]> {
    return this.serialize(async () => {
      const state = await this.storage.read();
      const now = Date.now();
      return (state[String(tabId)] || [])
        .filter((entry) => now - entry.observedAtMs <= CANDIDATE_TTL_MS)
        .map((entry) => entry.candidate);
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.then(operation, operation);
    this.operation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function safeOrigin(raw: string): string | undefined {
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

function normalizePageUrl(raw: string): string | undefined {
  try {
    return new URL(raw).href;
  } catch {
    return undefined;
  }
}

function isTikTokPageWithoutVideoPermalink(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      /(^|\.)tiktok\.com$/i.test(url.hostname) &&
      !/^\/@[^/]+\/video\/\d+/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}
