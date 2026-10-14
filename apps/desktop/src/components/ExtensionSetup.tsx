import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, CircleAlert, Clipboard, FolderOpen, Puzzle, RefreshCw } from "lucide-react";
import type { ExtensionStatus } from "../types";
import { errorMessage, extensionVersionFor, relativeTime } from "../lib/format";
import { RUNNING_IN_TAURI } from "../lib/api";

const EXTENSIONS_PAGE = "chrome://extensions";

export function useExtensionStatus(pollMs = 10_000) {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const refresh = useCallback(async () => {
    if (!RUNNING_IN_TAURI) return;
    try {
      setStatus(await invoke<ExtensionStatus>("extension_status"));
    } catch {
      // The status is informational only.
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, refresh]);
  return { status, refresh };
}

export function extensionMismatch(status: ExtensionStatus | null, appVersion: string) {
  const expected = extensionVersionFor(appVersion);
  return Boolean(
    status?.extensionVersion && expected && status.extensionVersion !== expected,
  );
}

/** Setup guide and live connection state for the browser extension. */
export function ExtensionSetup({
  appVersion,
  onError,
}: {
  appVersion: string;
  onError: (message: string) => void;
}) {
  const { status, refresh } = useExtensionStatus(4_000);
  const [copied, setCopied] = useState(false);
  const connected = status?.lastSeenMs != null;
  const mismatch = extensionMismatch(status, appVersion);

  async function openFolder() {
    try {
      await invoke("open_extension_folder");
    } catch (cause) {
      onError(errorMessage(cause));
    }
  }

  async function copyExtensionsPage() {
    try {
      await navigator.clipboard.writeText(EXTENSIONS_PAGE);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      onError("Adres panoya kopyalanamadı.");
    }
  }

  return (
    <section className="settings-group extension-setup">
      <div className="settings-group-head">
        <span className="side-icon"><Puzzle size={17} /></span>
        <div>
          <h3>Tarayıcı uzantısı</h3>
          <p>Video üzerindeki Lipit düğmeleri için uzantıyı bir kez kur.</p>
        </div>
      </div>
      <div
        className={`extension-state ${mismatch ? "warning" : connected ? "ok" : "pending"}`}
        role="status"
        aria-live="polite"
      >
        {connected && !mismatch ? <Check size={15} /> : <CircleAlert size={15} />}
        <span>
          {mismatch
            ? `Uzantı sürümü (${status?.extensionVersion}) bu uygulamayla uyumlu değil. Uzantılar sayfasında Lipit'i yeniden yükle.`
            : connected
              ? `Uzantı bağlı · son görülme ${relativeTime(status?.lastSeenMs ?? Date.now())}`
              : status && !status.hostRegistered
                ? "Tarayıcı köprüsü kayıtlı değil. Ayarlar'daki “Tarayıcı bağlantısını onar” düğmesini kullan."
                : "Uzantı henüz bağlanmadı. Aşağıdaki adımları izle; kurulunca burası yeşile döner."}
        </span>
        <button type="button" onClick={() => void refresh()} aria-label="Durumu yenile">
          <RefreshCw size={14} />
        </button>
      </div>
      <ol className="extension-steps">
        <li>
          Chrome, Edge veya Brave'de <code>{EXTENSIONS_PAGE}</code> sayfasını aç.
          <button type="button" onClick={() => void copyExtensionsPage()}>
            <Clipboard size={13} /> {copied ? "Kopyalandı" : "Adresi kopyala"}
          </button>
        </li>
        <li>Sağ üstteki <strong>Geliştirici modu</strong> anahtarını aç.</li>
        <li>
          <strong>Paketlenmemiş öğe yükle</strong> ile Lipit'in uzantı klasörünü seç.
          <button type="button" onClick={() => void openFolder()} disabled={!status?.extensionFolder}>
            <FolderOpen size={13} /> Klasörü aç
          </button>
        </li>
        <li>Video içeren bir sayfayı yenile; videonun köşesinde Lipit düğmeleri görünür.</li>
      </ol>
    </section>
  );
}
