import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CandidateStore } from "../dist/candidate-store.js";
import { detectNetworkCandidate } from "../dist/network-detector.js";

const chromiumManifest = JSON.parse(
  await readFile(new URL("../dist/manifest.json", import.meta.url), "utf8"),
);
const chromiumContent = await readFile(
  new URL("../dist/content.js", import.meta.url),
  "utf8",
);
const extensionPackage = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const versionMatch = extensionPackage.version.match(
  /^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/,
);
assert.ok(versionMatch);

assert.equal(chromiumManifest.version, versionMatch.slice(1).join("."));
assert.equal(
  chromiumManifest.version_name,
  `${versionMatch[1]}.${versionMatch[2]} beta ${versionMatch[4]}`,
);
assert.equal(chromiumManifest.background.service_worker, "background.js");
assert.match(chromiumContent, /aria-label="Hızlı profile göre indir"/);
assert.match(chromiumContent, /aria-label="Hızlı profile göre klip al"/);
assert.match(chromiumContent, /function tiktokVideoContext/);
assert.match(chromiumContent, /a\[href\*="\/video\/"\]/);
assert.match(chromiumContent, /video\.closest/);
assert.match(chromiumContent, /document\.querySelectorAll/);
assert.match(chromiumContent, /xgwrapper-/);
assert.match(chromiumContent, /recommend-list-item-container/);
assert.match(chromiumContent, /is_from_webapp=1&sender_device=pc/);
assert.match(
  chromiumContent,
  /data-action="download">İndir<\/button>[\s\S]*data-action="quick-download"[\s\S]*data-action="clip">Klip<\/button>[\s\S]*data-action="quick-clip"/,
);
assert.match(chromiumContent, /Lipit araçlarını tekrar göster/);

class MemoryStorage {
  state = {};

  async read() {
    return structuredClone(this.state);
  }

  async write(state) {
    this.state = structuredClone(state);
  }
}

const pageUrl = "https://media.example/watch/42";
const direct = detectNetworkCandidate({
  tabId: 4,
  url: "https://cdn.example/video.mp4?token=public-test",
  type: "media",
  documentUrl: pageUrl,
  responseHeaders: [{ name: "Content-Type", value: "video/mp4" }],
});
assert.equal(direct?.protocol, "http");

const audioOnlyMp4 = detectNetworkCandidate({
  tabId: 4,
  url: "https://cdn.example/audio-track.mp4?token=public-test",
  type: "media",
  documentUrl: pageUrl,
  responseHeaders: [{ name: "Content-Type", value: "audio/mp4" }],
});
assert.equal(audioOnlyMp4, null);

const twitterAudioPlaylist = detectNetworkCandidate({
  tabId: 4,
  url: "https://video.twimg.com/amplify_video/123/pl/mp4a/128000/audio.m3u8",
  type: "xmlhttprequest",
  documentUrl: "https://x.com/example/status/123",
  responseHeaders: [
    { name: "Content-Type", value: "application/x-mpegURL" },
  ],
});
assert.equal(twitterAudioPlaylist, null);

const hls = detectNetworkCandidate({
  tabId: 4,
  url: "https://cdn.example/live/master.m3u8",
  type: "xmlhttprequest",
  documentUrl: pageUrl,
});
assert.equal(hls?.protocol, "hls");

const segment = detectNetworkCandidate({
  tabId: 4,
  url: "https://cdn.example/live/segment001.ts",
  type: "media",
  documentUrl: pageUrl,
  responseHeaders: [{ name: "Content-Type", value: "video/mp2t" }],
});
assert.equal(segment, null);

const initSegment = detectNetworkCandidate({
  tabId: 4,
  url: "https://cdn.example/live/init.mp4",
  type: "media",
  documentUrl: pageUrl,
  responseHeaders: [{ name: "Content-Type", value: "video/mp4" }],
});
assert.equal(initSegment, null);

const rangedChunk = detectNetworkCandidate({
  tabId: 4,
  url: "https://cdn.example/videoplayback?id=42&range=0-999",
  type: "media",
  documentUrl: pageUrl,
});
assert.equal(rangedChunk, null);

const dash = detectNetworkCandidate({
  tabId: 4,
  url: "https://cdn.example/player/manifest",
  type: "xmlhttprequest",
  documentUrl: pageUrl,
  responseHeaders: [{ name: "Content-Type", value: "application/dash+xml" }],
});
assert.equal(dash?.protocol, "dash");

const storage = new MemoryStorage();
const store = new CandidateStore(storage);
assert.ok(hls);
await store.add(hls);
await store.add({ ...hls, id: "duplicate-network-event" });
assert.equal((await store.list(4)).length, 1);

const groupedStorage = new MemoryStorage();
const groupedStore = new CandidateStore(groupedStorage);
await groupedStore.add({
  ...hls,
  id: "variant-master",
  mediaUrl: "https://cdn.example/live/master.m3u8?token=first",
});
await groupedStore.add({
  ...hls,
  id: "variant-1080",
  mediaUrl: "https://cdn.example/live/1080p/index.m3u8?token=second",
});
await groupedStore.add({
  ...hls,
  id: "variant-720",
  mediaUrl: "https://cdn.example/live/720p/index.m3u8?token=third",
});
assert.equal((await groupedStore.list(4)).length, 1);
assert.equal(
  (await groupedStore.list(4))[0]?.mediaUrl,
  "https://cdn.example/live/master.m3u8?token=first",
);

const dom = {
  id: "dom-video",
  tabId: 4,
  pageUrl,
  pageTitle: "Test video",
  source: "dom",
  protocol: "blob",
  durationMs: 12_000,
};
const selected = await store.selectForDom(dom);
assert.equal(selected.protocol, "hls");
assert.equal(selected.mediaUrl, hls.mediaUrl);
assert.equal(selected.durationMs, 12_000);

const twitterStorage = new MemoryStorage();
const twitterStore = new CandidateStore(twitterStorage);
const twitterPage = "https://x.com/example/status/123";
await twitterStore.add({
  id: "twitter-video-variant",
  tabId: 7,
  pageUrl: twitterPage,
  mediaUrl:
    "https://video.twimg.com/amplify_video/123/pl/avc1/1280x720/video.m3u8",
  source: "network",
  protocol: "hls",
});
await twitterStore.add({
  id: "twitter-master",
  tabId: 7,
  pageUrl: twitterPage,
  mediaUrl: "https://video.twimg.com/amplify_video/123/pl/master-stream.m3u8",
  source: "network",
  protocol: "hls",
});
await twitterStore.add({
  id: "twitter-legacy-audio",
  tabId: 7,
  pageUrl: twitterPage,
  mediaUrl:
    "https://video.twimg.com/amplify_video/123/pl/mp4a/128000/audio.m3u8",
  source: "network",
  protocol: "hls",
});
const selectedTwitter = await twitterStore.selectForDom({
  ...dom,
  id: "twitter-dom",
  tabId: 7,
  pageUrl: twitterPage,
  referer: twitterPage,
});
assert.equal(
  selectedTwitter.mediaUrl,
  "https://video.twimg.com/amplify_video/123/pl/master-stream.m3u8",
);

const directDom = {
  ...dom,
  id: "direct-dom-video",
  mediaUrl: "https://other.example/movie.mp4",
  protocol: "http",
};
const selectedDirect = await store.selectForDom(directDom);
assert.equal(selectedDirect.mediaUrl, directDom.mediaUrl);

const linkedPreview = {
  ...dom,
  id: "linked-recommendation",
  pageUrl: "https://media.example/watch/recommended",
  referer: pageUrl,
};
const selectedPreview = await store.selectForDom(linkedPreview);
assert.equal(selectedPreview.id, "linked-recommendation");
assert.equal(selectedPreview.mediaUrl, undefined);
assert.equal(selectedPreview.pageUrl, linkedPreview.pageUrl);

const tiktokStorage = new MemoryStorage();
const tiktokStore = new CandidateStore(tiktokStorage);
await tiktokStore.add({
  id: "preloaded-next-tiktok-video",
  tabId: 9,
  pageUrl: "https://www.tiktok.com/",
  mediaUrl: "https://v16-webapp-prime.tiktok.com/preloaded-next-video.mp4",
  source: "network",
  protocol: "http",
});
const selectedTikTokFeedVideo = await tiktokStore.selectForDom({
  ...dom,
  id: "visible-tiktok-video",
  tabId: 9,
  pageUrl: "https://www.tiktok.com/",
  referer: "https://www.tiktok.com/",
});
assert.equal(selectedTikTokFeedVideo.id, "visible-tiktok-video");
assert.equal(selectedTikTokFeedVideo.mediaUrl, undefined);

const visibleTikTokPermalink = "https://www.tiktok.com/@creator/video/123456789";
const selectedTikTokPermalink = await tiktokStore.selectForDom({
  ...dom,
  id: "linked-tiktok-video",
  tabId: 9,
  pageUrl: visibleTikTokPermalink,
  referer: "https://www.tiktok.com/",
});
assert.equal(selectedTikTokPermalink.pageUrl, visibleTikTokPermalink);
assert.equal(selectedTikTokPermalink.mediaUrl, undefined);

const drmManifest = detectNetworkCandidate({
  tabId: 5,
  url: "https://secure.example/widevine/manifest.mpd",
  type: "xmlhttprequest",
  documentUrl: "https://secure.example/watch",
});
assert.equal(drmManifest?.drm, true);

await store.changePage(4, "https://media.example/watch/next");
assert.equal((await store.list(4)).length, 0);

console.log("CandidateStore and network detector tests passed.");
