import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BarChart3, FolderOpen, RotateCcw } from "lucide-react";
import type { Stats } from "../types";
import { errorMessage, historyDate } from "../lib/format";
import { RUNNING_IN_TAURI } from "../lib/api";

const top = (record: Record<string, number>, count = 5) =>
  Object.entries(record)
    .sort((left, right) => right[1] - left[1])
    .slice(0, count);

const percent = (part: number, total: number) =>
  total > 0 ? `%${Math.round((part / total) * 100)}` : "—";

/** Local-only usage numbers, so improvements can be measured without telemetry. */
export function StatsPanel({
  onError,
  onResetRequest,
  refreshKey,
}: {
  onError: (message: string) => void;
  onResetRequest: (reset: () => Promise<void>) => void;
  refreshKey: number;
}) {
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(async () => {
    if (!RUNNING_IN_TAURI) return;
    try {
      setStats(await invoke<Stats>("get_stats"));
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const finished = (stats?.completed ?? 0) + (stats?.failed ?? 0);
  const quickTotal = stats?.quickStarted ?? 0;

  return (
    <section className="settings-group stats-group">
      <div className="settings-group-head">
        <span className="side-icon"><BarChart3 size={17} /></span>
        <div>
          <h3>Yerel istatistikler</h3>
          <p>
            Yalnız bu bilgisayarda tutulur, hiçbir yere gönderilmez
            {stats?.sinceMs ? ` · ${historyDate(stats.sinceMs)} tarihinden beri` : ""}.
          </p>
        </div>
      </div>
      {stats ? (
        <>
          <div className="stats-grid">
            <div><strong>{stats.completed}</strong><span>Tamamlanan</span></div>
            <div><strong>{percent(stats.completed, finished)}</strong><span>Başarı oranı</span></div>
            <div><strong>{stats.failed}</strong><span>Başarısız</span></div>
            <div>
              <strong>{percent(stats.quickCompleted, quickTotal)}</strong>
              <span>Hızlı işlem başlatma ({quickTotal})</span>
            </div>
          </div>
          {Object.keys(stats.errorCodes).length > 0 && (
            <div className="stats-list">
              <strong>En sık hatalar</strong>
              {top(stats.errorCodes).map(([code, count]) => (
                <span key={code}><code>{code}</code><b>{count}</b></span>
              ))}
            </div>
          )}
          {Object.keys(stats.sourceHosts).length > 0 && (
            <div className="stats-list">
              <strong>En çok kullanılan kaynaklar</strong>
              {top(stats.sourceHosts).map(([host, count]) => (
                <span key={host}><code>{host}</code><b>{count}</b></span>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="cookie-note">İstatistikler yükleniyor…</p>
      )}
      <div className="stats-actions">
        <button
          type="button"
          className="settings-repair-button"
          onClick={() => void invoke("open_log_folder").catch((cause) => onError(errorMessage(cause)))}
        >
          <FolderOpen size={15} /> Günlük klasörünü aç
        </button>
        <button
          type="button"
          className="settings-repair-button"
          onClick={() =>
            onResetRequest(async () => {
              try {
                await invoke("reset_stats");
                await load();
              } catch (cause) {
                onError(errorMessage(cause));
              }
            })
          }
        >
          <RotateCcw size={15} /> İstatistikleri sıfırla
        </button>
      </div>
    </section>
  );
}
