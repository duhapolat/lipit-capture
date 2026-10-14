import { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ImageOff, LoaderCircle } from "lucide-react";
import type { PreviewSource } from "../types";
import { clipPresetLabel, clipPresets, formatDuration, parseTimecode, timecode } from "../lib/format";
import { RUNNING_IN_TAURI } from "../lib/api";

type FrameState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; src: string }
  | { kind: "error"; message: string };

/** Renders the frame at `positionMs`, debounced while the user drags. */
function FramePreview({
  source,
  positionMs,
  label,
}: {
  source: PreviewSource | null;
  positionMs: number;
  label: string;
}) {
  const [frame, setFrame] = useState<FrameState>({ kind: "idle" });

  useEffect(() => {
    if (!source || !RUNNING_IN_TAURI) {
      setFrame({ kind: "error", message: "Bu kaynak için önizleme yok" });
      return;
    }
    let alive = true;
    setFrame((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    const timer = window.setTimeout(() => {
      setFrame((current) => (current.kind === "ready" ? current : { kind: "loading" }));
      invoke<string>("preview_frame", { source, positionMs })
        .then((path) => {
          if (alive) setFrame({ kind: "ready", src: convertFileSrc(path) });
        })
        .catch(() => {
          if (alive) setFrame({ kind: "error", message: "Kare alınamadı" });
        });
    }, 420);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [source, positionMs]);

  return (
    <figure className="frame-preview">
      <div className="frame-preview-image">
        {frame.kind === "ready" && <img src={frame.src} alt={`${label} karesi`} />}
        {frame.kind === "loading" && <LoaderCircle className="spin" size={22} aria-label="Kare yükleniyor" />}
        {frame.kind === "error" && (
          <span>
            <ImageOff size={20} />
            {frame.message}
          </span>
        )}
      </div>
      <figcaption>
        <strong>{label}</strong>
        <span>{timecode(positionMs)}</span>
      </figcaption>
    </figure>
  );
}

function TimecodeInput({
  value,
  onCommit,
  label,
}: {
  value: number;
  onCommit: (value: number) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(() => timecode(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(timecode(value));
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const parsed = parseTimecode(draft);
    if (parsed == null) {
      setInvalid(true);
      setDraft(timecode(value));
      return;
    }
    setInvalid(false);
    onCommit(parsed);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      spellCheck={false}
      value={draft}
      placeholder="00:00:00.000"
      aria-label={`${label}, saat:dakika:saniye.milisaniye`}
      aria-invalid={invalid}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(timecode(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

type ClipRangeEditorProps = {
  startMs: number;
  endMs: number;
  durationMs: number | null;
  defaultClipMs: number;
  preview: PreviewSource | null;
  onStartChange: (value: number) => void;
  onEndChange: (value: number) => void;
};

export function ClipRangeEditor({
  startMs,
  endMs,
  durationMs,
  defaultClipMs,
  preview,
  onStartChange,
  onEndChange,
}: ClipRangeEditorProps) {
  const timelineMax = durationMs ?? Math.max(endMs, startMs + defaultClipMs, defaultClipMs);
  const clipLength = Math.max(0, endMs - startMs);
  const selectionLeft = timelineMax ? (startMs / timelineMax) * 100 : 0;
  const selectionWidth = timelineMax ? (clipLength / timelineMax) * 100 : 0;

  const updateStart = (next: number) =>
    onStartChange(Math.max(0, Math.min(Math.round(next), endMs - 100)));
  const updateEnd = (next: number) => {
    const bounded = Math.max(Math.round(next), startMs + 100);
    onEndChange(durationMs == null ? bounded : Math.min(durationMs, bounded));
  };
  const applyPreset = (milliseconds: number) => {
    const nextEnd = startMs + milliseconds;
    onEndChange(durationMs == null ? nextEnd : Math.min(durationMs, nextEnd));
  };

  return (
    <>
      <div className="frame-preview-row">
        <FramePreview source={preview} positionMs={startMs} label="Başlangıç" />
        <FramePreview source={preview} positionMs={Math.max(0, endMs - 40)} label="Bitiş" />
      </div>
      <div className="workspace-timeline">
        <div className="timeline-track" aria-hidden="true" />
        <div className="timeline-dim before" style={{ width: `${selectionLeft}%` }} />
        <div className="timeline-dim after" style={{ left: `${selectionLeft + selectionWidth}%` }} />
        <div
          className="timeline-selection-frame"
          style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }}
        />
        <input
          className="range-start"
          type="range"
          min={0}
          max={timelineMax}
          step={100}
          value={startMs}
          onChange={(event) => updateStart(Number(event.target.value))}
          aria-label="Klip başlangıcı"
          aria-valuetext={timecode(startMs)}
        />
        <input
          className="range-end"
          type="range"
          min={0}
          max={timelineMax}
          step={100}
          value={endMs}
          onChange={(event) => updateEnd(Number(event.target.value))}
          aria-label="Klip bitişi"
          aria-valuetext={timecode(endMs)}
        />
      </div>
      <div className="timeline-scale" aria-hidden="true">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <span key={ratio}>{formatDuration(Math.round(timelineMax * ratio))}</span>
        ))}
      </div>
      <div className="range-controls">
        <label className="time-field">
          <span>Başlangıç</span>
          <TimecodeInput value={startMs} onCommit={updateStart} label="Başlangıç zamanı" />
          <small>SAAT : DAKİKA : SANİYE . MS</small>
        </label>
        <label className="time-field">
          <span>Bitiş</span>
          <TimecodeInput value={endMs} onCommit={updateEnd} label="Bitiş zamanı" />
          <small>SAAT : DAKİKA : SANİYE . MS</small>
        </label>
        <div className="selected-duration">
          <span>Seçilen süre</span>
          <strong>{timecode(clipLength)}</strong>
          <small>{clipPresetLabel(clipLength)}</small>
        </div>
        <div className="workspace-presets" aria-label="Klip süresi kısayolları">
          {clipPresets.map((milliseconds) => (
            <button
              type="button"
              key={milliseconds}
              aria-pressed={clipLength === milliseconds}
              className={clipLength === milliseconds ? "selected" : ""}
              onClick={() => applyPreset(milliseconds)}
            >
              {clipPresetLabel(milliseconds)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
