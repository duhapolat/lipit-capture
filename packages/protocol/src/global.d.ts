declare namespace LipitProtocol {
  type CandidateSource = "dom" | "network" | "extractor";
  type MediaProtocol = "http" | "hls" | "dash" | "blob" | "unknown";
  type CaptureAction = "download" | "clip" | "quick_download" | "quick_clip";

  interface MediaCandidate {
    id: string;
    tabId: number;
    pageUrl: string;
    pageTitle?: string;
    mediaUrl?: string;
    source: CandidateSource;
    protocol: MediaProtocol;
    mimeType?: string;
    width?: number;
    height?: number;
    fps?: number;
    durationMs?: number;
    currentTimeMs?: number;
    referer?: string;
    origin?: string;
    userAgent?: string;
    drm?: boolean;
  }

  interface MediaDetectedMessage {
    protocolVersion: 1;
    type: "MEDIA_DETECTED";
    action: CaptureAction;
    candidate: MediaCandidate;
  }

  interface NativeResponse {
    protocolVersion: 1;
    type: "MEDIA_ACCEPTED" | "PONG" | "ERROR";
    candidateId?: string;
    error?: {
      code: string;
      message: string;
    };
  }
}
