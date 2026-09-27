import { CandidateStore } from "./candidate-store.js";
import { detectNetworkCandidate } from "./network-detector.js";

const NATIVE_HOST = "com.lipit.capture";
const PROTOCOL_VERSION = 1 as const;
const candidateStore = new CandidateStore();

type CaptureRequest = {
  type: "CAPTURE_MEDIA";
  action: LipitProtocol.CaptureAction;
  candidate: LipitProtocol.MediaCandidate;
};

type PageContextRequest = {
  type: "PAGE_CONTEXT_CHANGED";
  pageUrl: string;
};

type BackgroundResponse =
  | { ok: true; candidateId: string }
  | { ok: false; message: string };

function isCaptureRequest(value: unknown): value is CaptureRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.type !== "CAPTURE_MEDIA") return false;
  if (
    !["download", "clip", "quick_download", "quick_clip"].includes(
      String(record.action),
    )
  )
    return false;
  if (typeof record.candidate !== "object" || record.candidate === null) return false;
  const candidate = record.candidate as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.pageUrl === "string" &&
    ["dom", "network", "extractor"].includes(String(candidate.source)) &&
    ["http", "hls", "dash", "blob", "unknown"].includes(
      String(candidate.protocol),
    )
  );
}

function sendToNative(
  message: LipitProtocol.MediaDetectedMessage,
): Promise<LipitProtocol.NativeResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Masaüstü bağlantısı zaman aşımına uğradı."));
    }, 8_000);
    try {
      chrome.runtime.sendNativeMessage<LipitProtocol.NativeResponse>(
        NATIVE_HOST,
        message,
        (response) => {
          if (settled) return;
          settled = true;
          globalThis.clearTimeout(timer);
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "Native host unavailable"));
            return;
          }
          resolve(response);
        },
      );
    } catch (cause) {
      settled = true;
      globalThis.clearTimeout(timer);
      reject(cause);
    }
  });
}

async function captureMedia(
  request: CaptureRequest,
  tabId: number,
): Promise<BackgroundResponse> {
  const domCandidate: LipitProtocol.MediaCandidate = {
    ...request.candidate,
    tabId,
  };
  await candidateStore.add(domCandidate);
  const candidate = await candidateStore.selectForDom(domCandidate);
  const payload: LipitProtocol.MediaDetectedMessage = {
    protocolVersion: PROTOCOL_VERSION,
    type: "MEDIA_DETECTED",
    action: request.action,
    candidate,
  };
  const response = await sendToNative(payload);
  if (response.type === "MEDIA_ACCEPTED" && response.candidateId) {
    return { ok: true, candidateId: response.candidateId };
  }
  return {
    ok: false,
    message: response.error?.message || "Masaüstü uygulaması isteği kabul etmedi.",
  };
}

function observeNetwork(details: LipitWebRequestDetails): void {
  const candidate = detectNetworkCandidate(details);
  if (candidate) void candidateStore.add(candidate).catch(() => {});
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId >= 0 && details.type === "main_frame") {
      void candidateStore.clearTab(details.tabId);
    }
    observeNetwork(details);
  },
  { urls: ["http://*/*", "https://*/*"] },
);

chrome.webRequest.onHeadersReceived.addListener(
  observeNetwork,
  { urls: ["http://*/*", "https://*/*"] },
  ["responseHeaders"],
);

chrome.tabs.onRemoved.addListener((tabId) => {
  void candidateStore.clearTab(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    typeof message === "object" &&
    message !== null &&
    (message as Record<string, unknown>).type === "PAGE_CONTEXT_CHANGED" &&
    typeof (message as Record<string, unknown>).pageUrl === "string"
  ) {
    const request = message as PageContextRequest;
    const tabId = sender.tab?.id;
    if (
      Number.isInteger(tabId) &&
      tabId != null &&
      tabId >= 0 &&
      sender.frameId === 0
    ) {
      void candidateStore.changePage(tabId, request.pageUrl).then(
        () => sendResponse({ ok: true }),
        () => sendResponse({ ok: false }),
      );
      return true;
    }
    sendResponse({ ok: false });
    return;
  }
  if (!isCaptureRequest(message)) return;
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId) || tabId == null || tabId < 0) {
    sendResponse({ ok: false, message: "Sekme bilgisi okunamadı." });
    return;
  }

  void captureMedia(message, tabId)
    .then(sendResponse)
    .catch((cause: unknown) => {
      const detail = cause instanceof Error ? cause.message.trim() : "";
      const result: BackgroundResponse = {
        ok: false,
        message: detail
          ? `Lipit masaüstü bağlantısı kurulamadı: ${detail}`
          : "Lipit masaüstü bağlantısı kurulamadı. Native host kurulumunu kontrol edin.",
      };
      sendResponse(result);
    });
  return true;
});
