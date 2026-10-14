import { useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { FolderOpen, History as HistoryIcon, LoaderCircle, Play, Search, Trash2, X } from "lucide-react";
import type { HistoryEntry } from "../types";
import { fileSize, formatDuration, historyDate } from "../lib/format";
import { RUNNING_IN_TAURI } from "../lib/api";
import { Dialog } from "./Dialog";

function HistoryThumbnail({ entry, loading }: { entry: HistoryEntry; loading: boolean }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!RUNNING_IN_TAURI || !entry.fileExists) return;
    let alive = true;
    invoke<string | null>("history_thumbnail", { historyId: entry.id })
      .then((path) => {
        if (alive && path) setSrc(convertFileSrc(path));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [entry.id, entry.fileExists]);

  return (
    <span className="workspace-history-thumb">
      {src && <img src={src} alt="" />}
      <i>{loading ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}</i>
      {entry.kind === "clip" && entry.startMs != null && entry.endMs != null && (
        <b>{formatDuration(entry.endMs - entry.startMs)}</b>
      )}
    </span>
  );
}

type HistoryActions = {
  onPreview: (entry: HistoryEntry) => void;
  onReveal: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => void;
};

function HistoryRow({
  entry,
  previewLoading,
  actions,
  showActions,
}: {
  entry: HistoryEntry;
  previewLoading: boolean;
  actions: HistoryActions;
  showActions: boolean;
}) {
  return (
    <div className={`history-row ${entry.fileExists ? "" : "missing"}`}>
      <button
        type="button"
        className="workspace-history-item"
        onClick={() => actions.onPreview(entry)}
        disabled={!entry.fileExists || previewLoading}
        title={entry.fileExists ? "Önizle" : "Dosya artık bu konumda değil"}
      >
        <HistoryThumbnail entry={entry} loading={previewLoading} />
        <span>
          <strong>{entry.title}</strong>
          <small>
            {entry.kind === "clip" ? "Klip" : "Video"} · {fileSize(entry.sizeBytes)} ·{" "}
            {historyDate(entry.completedAtMs)}
            {entry.fileExists ? "" : " · dosya taşınmış"}
          </small>
        </span>
      </button>
      {showActions && (
        <span className="history-row-actions">
          <button
            type="button"
            onClick={() => actions.onReveal(entry)}
            disabled={!entry.fileExists}
            aria-label={`${entry.title} dosyasını klasörde göster`}
            title="Klasörde göster"
          >
            <FolderOpen size={14} />
          </button>
          <button
            type="button"
            onClick={() => actions.onDelete(entry)}
            aria-label={`${entry.title} kaydını geçmişten sil`}
            title="Geçmişten sil (dosya silinmez)"
          >
            <Trash2 size={14} />
          </button>
        </span>
      )}
    </div>
  );
}

export function HistoryPanel({
  history,
  previewLoading,
  actions,
  onShowAll,
  onClear,
}: {
  history: HistoryEntry[];
  previewLoading: boolean;
  actions: HistoryActions;
  onShowAll: () => void;
  onClear: () => void;
}) {
  return (
    <section className="workspace-side-card recent-card">
      <div className="workspace-side-head">
        <span><HistoryIcon size={19} /></span>
        <div>
          <h2>Son dosyalar</h2>
          <p>{history.length ? `${history.length} tamamlanan dosya` : "Henüz kayıt yok"}</p>
        </div>
        {history.length > 0 && (
          <button type="button" onClick={onClear} title="Geçmişi temizle" aria-label="Geçmişi temizle">
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {history.length > 0 ? (
        <>
          <div className="workspace-history-list">
            {history.slice(0, 6).map((entry) => (
              <HistoryRow
                key={entry.id}
                entry={entry}
                previewLoading={previewLoading}
                actions={actions}
                showActions
              />
            ))}
          </div>
          {history.length > 6 && (
            <button type="button" className="side-card-more" onClick={onShowAll}>
              Tümünü göster ({history.length})
            </button>
          )}
        </>
      ) : (
        <div className="workspace-side-empty">
          <HistoryIcon size={21} />
          <span>Tamamlanan dosyaların burada görünür.</span>
        </div>
      )}
    </section>
  );
}

export function HistoryDialog({
  history,
  previewLoading,
  actions,
  onClose,
}: {
  history: HistoryEntry[];
  previewLoading: boolean;
  actions: HistoryActions;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "download" | "clip">("all");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr-TR");
    return history.filter(
      (entry) =>
        (kind === "all" || entry.kind === kind) &&
        (!needle ||
          entry.title.toLocaleLowerCase("tr-TR").includes(needle) ||
          entry.sourceHost.toLocaleLowerCase("tr-TR").includes(needle)),
    );
  }, [history, kind, query]);

  return (
    <Dialog className="history-modal" labelledBy="history-title" onClose={onClose}>
      <div className="modal-head">
        <span className="side-icon"><HistoryIcon size={18} /></span>
        <div>
          <h2 id="history-title">İndirme geçmişi</h2>
          <p>{history.length} kayıt · Kayıt silmek medya dosyasını silmez</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Geçmişi kapat"><X size={18} /></button>
      </div>
      <div className="history-filters">
        <label className="history-search">
          <Search size={15} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Başlık veya kaynakta ara"
            aria-label="Geçmişte ara"
          />
        </label>
        <div className="settings-choice-grid three-columns" role="group" aria-label="Tür filtresi">
          {(["all", "download", "clip"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              className={kind === value ? "selected" : ""}
              onClick={() => setKind(value)}
            >
              {value === "all" ? "Tümü" : value === "download" ? "Videolar" : "Klipler"}
            </button>
          ))}
        </div>
      </div>
      <div className="history-modal-list">
        {filtered.length ? (
          filtered.map((entry) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              previewLoading={previewLoading}
              actions={actions}
              showActions
            />
          ))
        ) : (
          <div className="workspace-side-empty"><span>Aramanla eşleşen kayıt yok.</span></div>
        )}
      </div>
    </Dialog>
  );
}
