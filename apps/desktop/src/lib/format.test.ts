/// <reference types="node" />
// Run with: node --test apps/desktop/src/lib/format.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clipPresetLabel,
  compareVersions,
  displayVersion,
  extensionVersionFor,
  fileSize,
  formatDuration,
  initialClipRange,
  isActive,
  parseTimecode,
  quickQualityHeight,
  releaseTagVersion,
  remainingTime,
  timecode,
  transferSpeed,
} from "./format.ts";

test("timecode uses hours:minutes:seconds.milliseconds", () => {
  assert.equal(timecode(0), "00:00:00.000");
  assert.equal(timecode(3_723_045), "01:02:03.045");
  assert.equal(timecode(-5), "00:00:00.000");
});

test("parseTimecode accepts modern, short and legacy formats", () => {
  assert.equal(parseTimecode("01:02:03.045"), 3_723_045);
  assert.equal(parseTimecode("02:03.5"), 123_500);
  assert.equal(parseTimecode("7"), 7_000);
  assert.equal(parseTimecode("7,25"), 7_250);
  assert.equal(parseTimecode("00:00:30:500"), 30_500);
  assert.equal(parseTimecode("00:61:00.000"), null);
  assert.equal(parseTimecode("abc"), null);
  assert.equal(parseTimecode(timecode(83_500)), 83_500);
});

test("formatDuration and fileSize are human readable", () => {
  assert.equal(formatDuration(null), "Süre bilinmiyor");
  assert.equal(formatDuration(65_000), "00:01:05");
  assert.equal(fileSize(500), "1 KB");
  assert.equal(fileSize(3.5 * 1_048_576), "3.5 MB");
  assert.equal(transferSpeed(null), null);
  assert.equal(transferSpeed(2 * 1_048_576), "2.0 MB/sn");
  assert.equal(remainingTime(42), "42 sn kaldı");
  assert.equal(remainingTime(125), "2 dk 5 sn kaldı");
  assert.equal(remainingTime(null), null);
});

test("clip presets and ranges stay inside the video", () => {
  assert.equal(clipPresetLabel(30_000), "30 sn");
  assert.equal(clipPresetLabel(120_000), "2 dk");
  assert.deepEqual(initialClipRange(60_000, 10_000, 30_000), { startMs: 10_000, endMs: 40_000 });
  assert.deepEqual(initialClipRange(60_000, 50_000, 30_000), { startMs: 50_000, endMs: 60_000 });
  assert.deepEqual(initialClipRange(null, 5_000, 15_000), { startMs: 5_000, endMs: 20_000 });
});

test("quick quality picks the nearest lower height", () => {
  const profiles = [
    { height: null, label: "En iyi", fps: null },
    { height: 1080, label: "1080p", fps: null },
    { height: 720, label: "720p", fps: null },
  ];
  assert.equal(quickQualityHeight(profiles, null), null);
  assert.equal(quickQualityHeight(profiles, 1440), 1080);
  assert.equal(quickQualityHeight(profiles, 480), 720);
});

test("versions compare numerically", () => {
  assert.equal(displayVersion("1.0.0-beta.5"), "1.0 BETA 5");
  assert.equal(extensionVersionFor("1.0.0-beta.5"), "1.0.0.5");
  assert.equal(extensionVersionFor("1.2.3"), "1.2.3");
  assert.equal(releaseTagVersion("v1.0.0-beta.6"), "1.0.0.6");
  assert.equal(compareVersions("1.0.0.6", "1.0.0.5"), 1);
  assert.equal(compareVersions("2026.08.19", "2026.10.01"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0.0"), 0);
});

test("job activity", () => {
  assert.equal(isActive("downloading"), true);
  assert.equal(isActive("failed"), false);
});
