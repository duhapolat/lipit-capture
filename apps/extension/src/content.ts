const overlays = new Map<HTMLVideoElement, OverlayController>();
const candidateIds = new WeakMap<HTMLVideoElement, string>();
const encryptedVideos = new WeakSet<HTMLVideoElement>();
const capturesInFlight = new WeakSet<HTMLVideoElement>();
const lastCaptureAt = new WeakMap<HTMLVideoElement, number>();
const overlayPositions = new WeakMap<
  HTMLVideoElement,
  { xRatio: number; yRatio: number }
>();
let layoutQueued = false;
let observedPageUrl = location.href;

type ContentBridgeResponse =
  | { ok: true; candidateId: string }
  | { ok: false; message: string };

type OverlayController = {
  host: HTMLDivElement;
  status: HTMLSpanElement;
  video: HTMLVideoElement;
  destroy: () => void;
};

type VideoPageContext = {
  pageUrl: string;
  pageTitle?: string;
  linked: boolean;
};

function createCandidateId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function protocolFor(url: string | undefined): LipitProtocol.MediaProtocol {
  if (!url) return "unknown";
  if (url.startsWith("blob:")) return "blob";
  const clean = url.toLowerCase().split(/[?#]/, 1)[0] || "";
  if (clean.endsWith(".m3u8") || clean.endsWith(".m3u")) return "hls";
  if (clean.endsWith(".mpd")) return "dash";
  if (url.startsWith("http://") || url.startsWith("https://")) return "http";
  return "unknown";
}

function usableUrl(raw: string | null | undefined): string | undefined {
  if (!raw || raw.startsWith("blob:")) return undefined;
  try {
    const value = new URL(raw, location.href);
    return value.protocol === "http:" || value.protocol === "https:"
      ? value.href
      : undefined;
  } catch {
    return undefined;
  }
}

function getSource(video: HTMLVideoElement): {
  mediaUrl?: string;
  protocol: LipitProtocol.MediaProtocol;
  mimeType?: string;
} {
  const source = Array.from(video.querySelectorAll("source")).find(
    (item) => usableUrl(item.src) != null,
  );
  const rawUrl = video.currentSrc || video.src || source?.src;
  const mediaUrl = usableUrl(rawUrl);
  const protocol = protocolFor(rawUrl);
  const mimeType = source?.type || video.getAttribute("type") || undefined;
  return {
    ...(mediaUrl ? { mediaUrl } : {}),
    protocol,
    ...(mimeType ? { mimeType } : {}),
  };
}

function milliseconds(seconds: number): number | undefined {
  return Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds * 1000)
    : undefined;
}

function usablePageLink(anchor: HTMLAnchorElement): VideoPageContext | undefined {
  try {
    const url = new URL(anchor.href, location.href);
    if (!matchesHttp(url) || samePage(url.href, location.href)) return undefined;
    const title =
      anchor.getAttribute("aria-label")?.trim() ||
      anchor.getAttribute("title")?.trim() ||
      anchor.querySelector<HTMLImageElement>("img[alt]")?.alt.trim() ||
      undefined;
    return {
      pageUrl: url.href,
      ...(title ? { pageTitle: title.slice(0, 512) } : {}),
      linked: true,
    };
  } catch {
    return undefined;
  }
}

function matchesHttp(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function samePage(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return left === right;
  }
}

function tiktokVideoUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw, location.href);
    if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) return undefined;
    const match = url.pathname.match(/^\/(?:@[^/]+)\/video\/(\d+)/i);
    if (!match) return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

function tiktokVideoContext(video: HTMLVideoElement): VideoPageContext | undefined {
  if (!/(^|\.)tiktok\.com$/i.test(location.hostname)) return undefined;

  const currentPageUrl = tiktokVideoUrl(location.href);
  if (currentPageUrl) {
    return {
      pageUrl: currentPageUrl,
      ...(document.title ? { pageTitle: document.title.slice(0, 512) } : {}),
      linked: false,
    };
  }

  // TikTok's feed does not expose the current post as a /video/ anchor. The
  // player wrapper contains the video id (xgwrapper-0-<id>) and the surrounding
  // article contains the author's profile link. Together they are the exact
  // permalink exposed by the browser's "Bağlantıyı kopyala" context menu.
  const player = video.closest<HTMLElement>('[id^="xgwrapper-"]');
  const videoId = player?.id.match(/(\d{15,25})$/)?.[1];
  const card = video.closest<HTMLElement>(
    '[data-e2e="recommend-list-item-container"], article',
  );
  const profile = card
    ? Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href*="/@"]'))
        .map((anchor) => {
          try {
            const url = new URL(anchor.href, location.href);
            const match = url.pathname.match(/^\/@([^/]+)\/?$/i);
            return match?.[1] ? { anchor, username: match[1] } : undefined;
          } catch {
            return undefined;
          }
        })
        .find(
          (value): value is { anchor: HTMLAnchorElement; username: string } =>
            value != null,
        )
    : undefined;
  if (videoId && profile) {
    const pageUrl = `${location.origin}/@${profile.username}/video/${videoId}?is_from_webapp=1&sender_device=pc`;
    const title =
      video.getAttribute("aria-label")?.trim() ||
      card?.querySelector<HTMLImageElement>("img[alt]")?.alt.trim() ||
      profile.anchor.getAttribute("aria-label")?.trim() ||
      undefined;
    return {
      pageUrl,
      ...(title ? { pageTitle: title.slice(0, 512) } : {}),
      linked: true,
    };
  }

  const enclosingLink = video.closest<HTMLAnchorElement>('a[href*="/video/"]');
  const enclosingUrl = enclosingLink ? tiktokVideoUrl(enclosingLink.href) : undefined;
  if (enclosingLink && enclosingUrl) {
    const title =
      video.getAttribute("aria-label")?.trim() ||
      enclosingLink.getAttribute("aria-label")?.trim() ||
      enclosingLink.getAttribute("title")?.trim() ||
      undefined;
    return {
      pageUrl: enclosingUrl,
      ...(title ? { pageTitle: title.slice(0, 512) } : {}),
      linked: !samePage(enclosingUrl, location.href),
    };
  }

  let ancestor = video.parentElement;
  for (let depth = 0; ancestor && depth < 8; depth += 1) {
    const links = [
      ...(ancestor instanceof HTMLAnchorElement ? [ancestor] : []),
      ...Array.from(
        ancestor.querySelectorAll<HTMLAnchorElement>('a[href*="/video/"]'),
      ),
    ]
      .map((anchor) => ({ anchor, url: tiktokVideoUrl(anchor.href) }))
      .filter(
        (item): item is { anchor: HTMLAnchorElement; url: string } => item.url != null,
      );
    if (links.length) {
      const videoRect = video.getBoundingClientRect();
      links.sort((left, right) => {
        const leftRect = left.anchor.getBoundingClientRect();
        const rightRect = right.anchor.getBoundingClientRect();
        const leftDistance = Math.abs(
          (leftRect.top + leftRect.bottom) / 2 - (videoRect.top + videoRect.bottom) / 2,
        );
        const rightDistance = Math.abs(
          (rightRect.top + rightRect.bottom) / 2 - (videoRect.top + videoRect.bottom) / 2,
        );
        return leftDistance - rightDistance;
      });
      const match = links[0];
      if (match) {
        const title =
          video.getAttribute("aria-label")?.trim() ||
          match.anchor.getAttribute("aria-label")?.trim() ||
          match.anchor.getAttribute("title")?.trim() ||
          undefined;
        return {
          pageUrl: match.url,
          ...(title ? { pageTitle: title.slice(0, 512) } : {}),
          linked: !samePage(match.url, location.href),
        };
      }
    }
    ancestor = ancestor.parentElement;
  }

  // TikTok sometimes renders the clickable permalink next to the video through a
  // portal, outside the video's ancestor tree. This is the same link exposed by
  // the browser's "Bağlantıyı kopyala" context-menu item. Prefer the closest
  // visible permalink to the actual video instead of a preloaded feed item.
  const videoRect = video.getBoundingClientRect();
  const videoCenterX = (videoRect.left + videoRect.right) / 2;
  const videoCenterY = (videoRect.top + videoRect.bottom) / 2;
  const spatialMatch = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/video/"]'),
  )
    .map((anchor) => {
      const url = tiktokVideoUrl(anchor.href);
      const rect = anchor.getBoundingClientRect();
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < innerHeight &&
        rect.left < innerWidth;
      const centerX = (rect.left + rect.right) / 2;
      const centerY = (rect.top + rect.bottom) / 2;
      const distance = Math.hypot(centerX - videoCenterX, centerY - videoCenterY);
      return { anchor, url, visible, distance, overlap: overlapRatio(videoRect, rect) };
    })
    .filter(
      (item): item is {
        anchor: HTMLAnchorElement;
        url: string;
        visible: boolean;
        distance: number;
        overlap: number;
      } => item.url != null && item.visible,
    )
    .sort(
      (left, right) =>
        Number(right.overlap > 0.15) - Number(left.overlap > 0.15) ||
        right.overlap - left.overlap ||
        left.distance - right.distance,
    )[0];
  if (spatialMatch && (spatialMatch.overlap > 0.15 || spatialMatch.distance < 900)) {
    const title =
      video.getAttribute("aria-label")?.trim() ||
      spatialMatch.anchor.getAttribute("aria-label")?.trim() ||
      spatialMatch.anchor.getAttribute("title")?.trim() ||
      undefined;
    return {
      pageUrl: spatialMatch.url,
      ...(title ? { pageTitle: title.slice(0, 512) } : {}),
      linked: !samePage(spatialMatch.url, location.href),
    };
  }
  return undefined;
}

function twitterStatusUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw, location.href);
    if (!/(^|\.)(?:x|twitter)\.com$/i.test(url.hostname)) return undefined;
    const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/i);
    if (!match) return undefined;
    return `${url.origin}/${match[1]}/status/${match[2]}`;
  } catch {
    return undefined;
  }
}

function twitterVideoContext(video: HTMLVideoElement): VideoPageContext | undefined {
  const container = video.closest<HTMLElement>('article, [data-testid="tweet"]');
  if (!container) return undefined;
  const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'))
    .map((anchor) => ({
      url: twitterStatusUrl(anchor.href),
      hasTime: anchor.querySelector("time") != null,
    }))
    .filter((item): item is { url: string; hasTime: boolean } => item.url != null)
    .sort((left, right) => Number(right.hasTime) - Number(left.hasTime));
  const match = links[0];
  if (!match) return undefined;
  return {
    pageUrl: match.url,
    ...(document.title ? { pageTitle: document.title.slice(0, 512) } : {}),
    linked: !samePage(match.url, location.href),
  };
}

function overlapRatio(left: DOMRect, right: DOMRect): number {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  const area = Math.max(1, left.width * left.height);
  return (width * height) / area;
}

function videoPageContext(video: HTMLVideoElement): VideoPageContext {
  const tiktok = tiktokVideoContext(video);
  if (tiktok) return tiktok;

  const twitter = twitterVideoContext(video);
  if (twitter) return twitter;

  const closest = video.closest<HTMLAnchorElement>("a[href]");
  const direct = closest ? usablePageLink(closest) : undefined;
  if (direct) return direct;

  const videoRect = video.getBoundingClientRect();
  let ancestor = video.parentElement;
  for (let depth = 0; ancestor && depth < 6; depth += 1) {
    const links = Array.from(ancestor.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .map((anchor) => ({
        anchor,
        context: usablePageLink(anchor),
        overlap: overlapRatio(videoRect, anchor.getBoundingClientRect()),
      }))
      .filter(
        (item): item is {
          anchor: HTMLAnchorElement;
          context: VideoPageContext;
          overlap: number;
        } => item.context != null && item.overlap >= 0.45,
      )
      .sort((left, right) => {
        const leftHint = /(?:watch|shorts|video|thumbnail)/i.test(
          `${left.anchor.id} ${left.anchor.className} ${left.context.pageUrl}`,
        );
        const rightHint = /(?:watch|shorts|video|thumbnail)/i.test(
          `${right.anchor.id} ${right.anchor.className} ${right.context.pageUrl}`,
        );
        return Number(rightHint) - Number(leftHint) || right.overlap - left.overlap;
      });
    const match = links[0];
    if (match) return match.context;
    ancestor = ancestor.parentElement;
  }

  return {
    pageUrl: location.href,
    ...(document.title ? { pageTitle: document.title.slice(0, 512) } : {}),
    linked: false,
  };
}

function renderedVideoArea(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function candidateFor(video: HTMLVideoElement): LipitProtocol.MediaCandidate {
  let id = candidateIds.get(video);
  if (!id) {
    id = createCandidateId();
    candidateIds.set(video, id);
  }
  const source = getSource(video);
  const context = videoPageContext(video);
  const durationMs = milliseconds(video.duration);
  const currentTimeMs = milliseconds(video.currentTime);
  return {
    id,
    tabId: 0,
    pageUrl: context.pageUrl,
    ...(context.pageTitle ? { pageTitle: context.pageTitle } : {}),
    ...source,
    source: "dom",
    ...(video.videoWidth > 0 ? { width: video.videoWidth } : {}),
    ...(video.videoHeight > 0 ? { height: video.videoHeight } : {}),
    ...(durationMs != null ? { durationMs } : {}),
    ...(currentTimeMs != null ? { currentTimeMs } : {}),
    referer: location.href,
    origin: location.origin,
    userAgent: navigator.userAgent.slice(0, 1024),
    drm: encryptedVideos.has(video),
  };
}

function sendCapture(
  video: HTMLVideoElement,
  action: LipitProtocol.CaptureAction,
  status: HTMLSpanElement,
): void {
  const toolbar = status.closest<HTMLElement>(".bar");
  if (toolbar) toolbar.dataset.open = "true";
  const now = Date.now();
  if (capturesInFlight.has(video) || now - (lastCaptureAt.get(video) ?? 0) < 1500) {
    status.textContent = "İstek zaten gönderiliyor";
    status.dataset.kind = "busy";
    return;
  }
  const candidate = candidateFor(video);
  if (candidate.drm) {
    status.textContent = "DRM protected — download unavailable";
    status.dataset.kind = "error";
    return;
  }
  status.textContent = "Masaüstüne gönderiliyor…";
  status.dataset.kind = "busy";
  capturesInFlight.add(video);
  lastCaptureAt.set(video, now);
  try {
    chrome.runtime.sendMessage<ContentBridgeResponse>(
      { type: "CAPTURE_MEDIA", action, candidate },
      (response) => {
      capturesInFlight.delete(video);
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError || !response?.ok) {
        status.textContent =
          response && !response.ok
            ? response.message
            : "Masaüstü bağlantısı kurulamadı";
        status.dataset.kind = "error";
        return;
      }
      status.textContent =
        action === "quick_download"
          ? "Hızlı indirme başlatıldı"
          : action === "quick_clip"
            ? "Hızlı klip başlatıldı"
            : action === "download"
              ? "Masaüstünde hazır"
              : "Klip adayı gönderildi";
      status.dataset.kind = "success";
      window.setTimeout(() => {
        if (status.isConnected) {
          status.textContent = "";
          if (toolbar) delete toolbar.dataset.open;
        }
      }, 3200);
      },
    );
  } catch {
    capturesInFlight.delete(video);
    status.textContent = "Uzantı güncellendi. Bu sekmeyi yenileyin.";
    status.dataset.kind = "error";
  }
}

function createOverlay(video: HTMLVideoElement): OverlayController {
  const host = document.createElement("div");
  host.className = "lipit-overlay-host";
  host.style.cssText = [
    "all:initial",
    "position:fixed",
    "z-index:2147483646",
    "display:none",
    "pointer-events:none",
    "font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif",
  ].join(";");
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { color-scheme: dark; }
      .bar { display:flex; align-items:center; min-width:36px; min-height:36px; padding:4px; border:1px solid rgba(210,255,157,.2); border-radius:12px; background:rgba(10,15,16,.5); box-shadow:0 8px 24px rgba(0,0,0,.24); backdrop-filter:blur(8px); pointer-events:auto; opacity:.68; transition:border-color .18s ease, box-shadow .18s ease, opacity .18s ease, background .18s ease; }
      .bar:hover,.bar:focus-within,.bar[data-open=true],.bar[data-dragging=true] { border-color:rgba(199,255,97,.55); background:rgba(10,15,16,.72); box-shadow:0 10px 28px rgba(0,0,0,.34),0 0 0 2px rgba(199,255,97,.08); opacity:.96; }
      .brand { width:28px; height:28px; display:grid; place-items:center; flex:none; padding:0; border:0; border-radius:8px; color:#10150f; background:linear-gradient(145deg,rgba(199,255,97,.88),rgba(99,230,212,.88)); cursor:grab; touch-action:none; }
      .bar[data-dragging=true] .brand { cursor:grabbing; }
      .brand svg { width:16px; height:16px; }
      .actions { max-width:0; display:flex; align-items:center; gap:4px; overflow:hidden; opacity:0; transform:translateX(4px); transition:max-width .22s ease,opacity .16s ease,transform .22s ease,margin .22s ease; }
      .bar:hover .actions,.bar:focus-within .actions,.bar[data-open=true] .actions { max-width:390px; margin-left:5px; opacity:1; transform:none; }
      .bar[data-hidden=true] .actions { max-width:0; margin-left:0; opacity:0; transform:translateX(4px); }
      .bar[data-hidden=true] .brand { color:#9dacaa; background:#202a28; }
      .action { appearance:none; border:0; border-radius:7px; padding:7px 9px; color:#10150f; background:rgba(199,255,97,.86); font:700 11px/1 system-ui,sans-serif; white-space:nowrap; cursor:pointer; }
      .action.secondary { color:#dce7e1; background:rgba(38,50,47,.82); }
      .action.quick { width:28px; padding:7px 0; color:#102019; background:rgba(99,230,212,.86); }
      .action.hide { width:28px; padding:7px 0; color:#aab8b3; background:transparent; }
      button:hover { filter:brightness(1.08); }
      button:focus-visible { outline:2px solid #d9ff9a; outline-offset:2px; }
      .status { display:none; max-width:220px; padding:0 6px; color:#c9d6d0; font:600 10px/1.25 system-ui,sans-serif; white-space:nowrap; }
      .status:not(:empty) { display:block; }
      .status[data-kind="error"] { color:#ffb9c4; }
      .status[data-kind="success"] { color:#8cf0bf; }
    </style>
    <div class="bar" role="toolbar" aria-label="Lipit medya araçları">
      <button class="brand" type="button" data-action="toggle" aria-label="Lipit araçlarını aç" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v12H4z"/><path d="m7 4 2 3m4-3 2 3m4-3 1.3 2"/><path d="m10 11 5 3-5 3z"/></svg>
      </button>
      <span class="actions">
        <button class="action" type="button" data-action="download">İndir</button>
        <button class="action quick" type="button" data-action="quick-download" title="Hızlı profile göre indir" aria-label="Hızlı profile göre indir">⚡</button>
        <button class="action secondary" type="button" data-action="clip">Klip</button>
        <button class="action quick" type="button" data-action="quick-clip" title="Hızlı profile göre klip al" aria-label="Hızlı profile göre klip al">⚡</button>
        <button class="action hide" type="button" data-action="hide" title="Lipit araçlarını gizle" aria-label="Lipit araçlarını gizle">×</button>
        <span class="status" role="status" aria-live="polite"></span>
      </span>
    </div>`;
  const toolbar = shadow.querySelector<HTMLElement>(".bar");
  const toggle = shadow.querySelector<HTMLButtonElement>("[data-action=toggle]");
  const status = shadow.querySelector<HTMLSpanElement>(".status");
  const download = shadow.querySelector<HTMLButtonElement>("[data-action=download]");
  const clip = shadow.querySelector<HTMLButtonElement>("[data-action=clip]");
  const quickDownload = shadow.querySelector<HTMLButtonElement>("[data-action=quick-download]");
  const quickClip = shadow.querySelector<HTMLButtonElement>("[data-action=quick-clip]");
  const hide = shadow.querySelector<HTMLButtonElement>("[data-action=hide]");
  if (!toolbar || !toggle || !status || !download || !clip || !quickDownload || !quickClip || !hide) {
    throw new Error("Overlay could not be initialized");
  }
  let dragPointer: number | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragged = false;
  let suppressToggleClick = false;
  const finishDrag = (event: PointerEvent) => {
    if (dragPointer !== event.pointerId) return;
    suppressToggleClick = dragged;
    dragPointer = null;
    delete toolbar.dataset.dragging;
    try {
      toolbar.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can already be released when the page changes.
    }
  };
  toolbar.addEventListener("pointerdown", (event) => {
    const target = event.composedPath()[0];
    if (target !== toggle || event.button !== 0) return;
    const hostRect = host.getBoundingClientRect();
    dragPointer = event.pointerId;
    dragOffsetX = event.clientX - hostRect.left;
    dragOffsetY = event.clientY - hostRect.top;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragged = false;
    toolbar.dataset.dragging = "true";
    toolbar.setPointerCapture(event.pointerId);
  });
  toolbar.addEventListener("pointermove", (event) => {
    if (dragPointer !== event.pointerId) return;
    if (Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY) > 4) {
      dragged = true;
    }
    if (!dragged) return;
    event.preventDefault();
    const videoRect = video.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const availableX = Math.max(0, videoRect.width - hostRect.width);
    const availableY = Math.max(0, videoRect.height - hostRect.height);
    const left = Math.min(
      videoRect.left + availableX,
      Math.max(videoRect.left, event.clientX - dragOffsetX),
    );
    const top = Math.min(
      videoRect.top + availableY,
      Math.max(videoRect.top, event.clientY - dragOffsetY),
    );
    overlayPositions.set(video, {
      xRatio: availableX > 0 ? (left - videoRect.left) / availableX : 0,
      yRatio: availableY > 0 ? (top - videoRect.top) / availableY : 0,
    });
    host.style.right = "auto";
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
  });
  toolbar.addEventListener("pointerup", finishDrag);
  toolbar.addEventListener("pointercancel", finishDrag);
  toggle.addEventListener("click", () => {
    if (suppressToggleClick) {
      suppressToggleClick = false;
      return;
    }
    if (toolbar.dataset.hidden === "true") {
      delete toolbar.dataset.hidden;
      toolbar.dataset.open = "true";
      toggle.setAttribute("aria-label", "Lipit araçlarını kapat");
      toggle.setAttribute("aria-expanded", "true");
      return;
    }
    const open = toolbar.dataset.open !== "true";
    if (open) toolbar.dataset.open = "true";
    else delete toolbar.dataset.open;
    toggle.setAttribute("aria-expanded", String(open));
  });
  download.addEventListener("click", () => sendCapture(video, "download", status));
  clip.addEventListener("click", () => sendCapture(video, "clip", status));
  quickDownload.addEventListener("click", () =>
    sendCapture(video, "quick_download", status),
  );
  quickClip.addEventListener("click", () => sendCapture(video, "quick_clip", status));
  hide.addEventListener("click", () => {
    toolbar.dataset.hidden = "true";
    delete toolbar.dataset.open;
    status.textContent = "";
    toggle.setAttribute("aria-label", "Lipit araçlarını tekrar göster");
    toggle.setAttribute("aria-expanded", "false");
  });
  document.documentElement.append(host);

  const markEncrypted = () => {
    encryptedVideos.add(video);
    status.textContent = "DRM protected — download unavailable";
    status.dataset.kind = "error";
  };
  video.addEventListener("encrypted", markEncrypted);

  return {
    host,
    status,
    video,
    destroy: () => {
      video.removeEventListener("encrypted", markEncrypted);
      host.remove();
    },
  };
}

function observeVideo(video: HTMLVideoElement): void {
  if (overlays.has(video)) return;
  try {
    overlays.set(video, createOverlay(video));
    queueLayout();
  } catch {
    // A page-level DOM restriction should not affect playback.
  }
}

function scan(root: ParentNode): void {
  if (root instanceof HTMLVideoElement) observeVideo(root);
  root.querySelectorAll?.("video").forEach((item) => {
    if (item instanceof HTMLVideoElement) observeVideo(item);
  });
}

function layoutOverlays(): void {
  layoutQueued = false;
  const fullscreen = document.fullscreenElement;
  const largestVideoArea = Math.max(
    1,
    ...Array.from(overlays.keys())
      .filter((video) => video.isConnected)
      .map(renderedVideoArea),
  );
  for (const [video, controller] of overlays) {
    if (!video.isConnected) {
      controller.destroy();
      overlays.delete(video);
      continue;
    }
    const rect = video.getBoundingClientRect();
    const context = videoPageContext(video);
    const primaryEnough = renderedVideoArea(video) >= largestVideoArea * 0.55;
    const visible =
      rect.width >= 180 &&
      rect.height >= 100 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth;
    const fullscreenCompatible =
      !fullscreen || (fullscreen !== video && fullscreen.contains(video));
    if (!visible || !fullscreenCompatible || (!context.linked && !primaryEnough)) {
      controller.host.style.display = "none";
      continue;
    }
    if (fullscreen && controller.host.parentElement !== fullscreen) {
      fullscreen.append(controller.host);
    } else if (!fullscreen && controller.host.parentElement !== document.documentElement) {
      document.documentElement.append(controller.host);
    }
    controller.host.style.display = "block";
    const saved = overlayPositions.get(video);
    if (saved) {
      const hostRect = controller.host.getBoundingClientRect();
      const availableX = Math.max(0, rect.width - hostRect.width);
      const availableY = Math.max(0, rect.height - hostRect.height);
      controller.host.style.left = `${rect.left + availableX * saved.xRatio}px`;
      controller.host.style.top = `${rect.top + availableY * saved.yRatio}px`;
      controller.host.style.right = "auto";
    } else {
      controller.host.style.top = `${Math.max(8, rect.top + 10)}px`;
      controller.host.style.left = "auto";
      controller.host.style.right = `${Math.max(8, innerWidth - rect.right + 10)}px`;
    }
  }
}

function queueLayout(): void {
  checkPageContext();
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(layoutOverlays);
}

function checkPageContext(): void {
  if (location.href === observedPageUrl) return;
  observedPageUrl = location.href;
  try {
    chrome.runtime.sendMessage<{ ok: boolean }>(
      { type: "PAGE_CONTEXT_CHANGED", pageUrl: observedPageUrl },
      () => {
        void chrome.runtime.lastError;
      },
    );
  } catch {
    // Extension reloads invalidate content scripts in already-open tabs.
  }
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof Element) scan(node);
    }
  }
  queueLayout();
});

scan(document);
observer.observe(document, { childList: true, subtree: true });
addEventListener("scroll", queueLayout, { capture: true, passive: true });
addEventListener("resize", queueLayout, { passive: true });
document.addEventListener("fullscreenchange", queueLayout);
addEventListener("popstate", queueLayout);
addEventListener("hashchange", queueLayout);
window.setInterval(queueLayout, 1500);
