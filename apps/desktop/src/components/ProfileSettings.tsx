import {
  BellRing,
  Cookie,
  Cpu,
  FileText,
  Film,
  FolderOpen,
  Puzzle,
  RefreshCw,
  Zap,
} from "lucide-react";
import type { AppSettings, CookieBrowser, FilenameTemplate } from "../types";
import {
  clipPresetLabel,
  clipPresets,
  qualityPresetLabel,
  qualityPresets,
} from "../lib/format";

type ProfileSettingsProps = {
  value: AppSettings;
  onChange: (settings: AppSettings) => void;
  onChooseDirectory: () => void;
  onChooseCookieFile?: () => void;
  showAdvanced: boolean;
  pluginDirectory?: string;
  onRepairNativeBridge?: () => void;
  bridgeRepairing?: boolean;
};

const filenameTemplates: { value: FilenameTemplate; label: string; example: string }[] = [
  { value: "title_date", label: "Başlık + tarih", example: "Video başlığı_2026-10-13.mp4" },
  { value: "title", label: "Yalnız başlık", example: "Video başlığı.mp4" },
  {
    value: "source_title_date",
    label: "Kaynak + başlık + tarih",
    example: "site.org - Video başlığı_2026-10-13.mp4",
  },
];

export function ProfileSettings({
  value,
  onChange,
  onChooseDirectory,
  onChooseCookieFile,
  showAdvanced,
  pluginDirectory,
  onRepairNativeBridge,
  bridgeRepairing = false,
}: ProfileSettingsProps) {
  const updateQuickProfile = (changes: Partial<AppSettings["quickProfile"]>) =>
    onChange({ ...value, quickProfile: { ...value.quickProfile, ...changes } });
  const updateCompatibility = (changes: Partial<AppSettings["compatibility"]>) =>
    onChange({ ...value, compatibility: { ...value.compatibility, ...changes } });
  const selectedTemplate =
    filenameTemplates.find((template) => template.value === value.filenameTemplate) ??
    filenameTemplates[0];

  return (
    <div className="profile-settings-form">
      <section className="settings-group">
        <div className="settings-group-head">
          <span className="side-icon"><FolderOpen size={17} /></span>
          <div>
            <h3>Kayıt konumu</h3>
            <p>Hızlı işlemlerde dosyanın nereye kaydedileceğini seç.</p>
          </div>
        </div>
        <div className="settings-choice-grid two-columns">
          <button
            type="button"
            aria-pressed={value.quickProfile.destinationMode === "ask"}
            className={value.quickProfile.destinationMode === "ask" ? "selected" : ""}
            onClick={() => updateQuickProfile({ destinationMode: "ask" })}
          >
            Her seferinde sor
          </button>
          <button
            type="button"
            aria-pressed={value.quickProfile.destinationMode === "folder"}
            className={value.quickProfile.destinationMode === "folder" ? "selected" : ""}
            onClick={onChooseDirectory}
          >
            <FolderOpen size={14} /> Sabit klasör
          </button>
        </div>
        {value.quickProfile.destinationMode === "folder" && (
          <button
            className="selected-folder"
            type="button"
            onClick={onChooseDirectory}
            title={value.quickProfile.downloadDirectory || "Klasör seçilmedi"}
          >
            {value.quickProfile.downloadDirectory || "Klasör seçilmedi"}
          </button>
        )}
      </section>

      <section className="settings-group">
        <div className="settings-group-head">
          <span className="side-icon"><FileText size={17} /></span>
          <div>
            <h3>Dosya adı</h3>
            <p>Örnek: {selectedTemplate?.example}</p>
          </div>
        </div>
        <div className="settings-choice-grid three-columns">
          {filenameTemplates.map((template) => (
            <button
              type="button"
              key={template.value}
              aria-pressed={value.filenameTemplate === template.value}
              className={value.filenameTemplate === template.value ? "selected" : ""}
              onClick={() => onChange({ ...value, filenameTemplate: template.value })}
            >
              {template.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-head">
          <span className="side-icon"><Film size={17} /></span>
          <div>
            <h3>Hızlı indirme kalitesi</h3>
            <p>Seçilen çözünürlük yoksa en yakın düşük kalite kullanılır.</p>
          </div>
        </div>
        <div className="settings-choice-grid quality-grid">
          {qualityPresets.map((quality) => (
            <button
              type="button"
              key={quality ?? "best"}
              aria-pressed={value.quickProfile.qualityHeight === quality}
              className={value.quickProfile.qualityHeight === quality ? "selected" : ""}
              onClick={() => updateQuickProfile({ qualityHeight: quality })}
            >
              {qualityPresetLabel(quality)}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-head">
          <span className="side-icon"><Zap size={17} /></span>
          <div>
            <h3>Hızlı klip</h3>
            <p>Hızlı klip düğmesi videonun o anki zamanından bu ayarlarla klip alır.</p>
          </div>
        </div>
        <div className="settings-inline-label">
          <strong>Klip süresi</strong>
          <span>{clipPresetLabel(value.quickProfile.clipDurationMs)}</span>
        </div>
        <div className="settings-choice-grid duration-grid">
          {clipPresets.map((milliseconds) => (
            <button
              type="button"
              key={milliseconds}
              aria-pressed={value.quickProfile.clipDurationMs === milliseconds}
              className={value.quickProfile.clipDurationMs === milliseconds ? "selected" : ""}
              onClick={() => updateQuickProfile({ clipDurationMs: milliseconds })}
            >
              {clipPresetLabel(milliseconds)}
            </button>
          ))}
        </div>
        <div className="settings-choice-grid two-columns clip-method-choice">
          <button
            type="button"
            aria-pressed={value.quickProfile.clipMode === "fast"}
            className={value.quickProfile.clipMode === "fast" ? "selected" : ""}
            onClick={() => updateQuickProfile({ clipMode: "fast" })}
          >
            Hızlı kesim
            <small>Daha çabuk hazırlanır</small>
          </button>
          <button
            type="button"
            aria-pressed={value.quickProfile.clipMode === "precise"}
            className={value.quickProfile.clipMode === "precise" ? "selected" : ""}
            onClick={() => updateQuickProfile({ clipMode: "precise" })}
          >
            Hassas kesim
            <small>Seçilen kareye daha yakın</small>
          </button>
        </div>
      </section>

      <section className="settings-group">
        <label className="setting-row">
          <input
            type="checkbox"
            checked={value.updateChecksEnabled}
            onChange={(event) => onChange({ ...value, updateChecksEnabled: event.target.checked })}
          />
          <span className="setting-icon"><BellRing size={14} /></span>
          <span>
            <strong>Güncellemeleri denetle</strong>
            <small>
              Günde bir kez yayın sayfasından yalnızca sürüm numarası okunur; hiçbir şey
              onayın olmadan indirilmez.
            </small>
          </span>
        </label>
      </section>

      {showAdvanced && (
        <section className="settings-group advanced-settings-group">
          <div className="settings-group-head">
            <span className="side-icon"><Cpu size={17} /></span>
            <div>
              <h3>Gelişmiş uyumluluk</h3>
              <p>Yalnız belirli videolar gerektiğinde etkinleştir.</p>
            </div>
          </div>
          <label className="setting-row">
            <input
              type="checkbox"
              checked={value.compatibility.cookiesEnabled}
              onChange={(event) => updateCompatibility({ cookiesEnabled: event.target.checked })}
            />
            <span className="setting-icon"><Cookie size={14} /></span>
            <span>
              <strong>Oturum çerezlerini kullan</strong>
              <small>Oturum gerektiren ve erişim hakkın bulunan videolar için</small>
            </span>
          </label>
          {value.compatibility.cookiesEnabled && (
            <>
              <label className="browser-select">
                <span>Çerez kaynağı</span>
                <select
                  value={value.compatibility.cookieBrowser}
                  onChange={(event) =>
                    updateCompatibility({ cookieBrowser: event.target.value as CookieBrowser })
                  }
                >
                  <option value="chrome">Chrome</option>
                  <option value="edge">Edge</option>
                  <option value="brave">Brave</option>
                  <option value="file">cookies.txt dosyası</option>
                </select>
              </label>
              {value.compatibility.cookieBrowser === "file" ? (
                <button
                  className="selected-folder"
                  type="button"
                  onClick={onChooseCookieFile}
                  title={value.compatibility.cookieFile || "Dosya seçilmedi"}
                >
                  {value.compatibility.cookieFile || "cookies.txt dosyasını seç"}
                </button>
              ) : (
                <p className="cookie-note warning">
                  Chromium tabanlı tarayıcıların yeni sürümleri çerezlerin dışarıdan
                  okunmasını engelleyebilir. Hata alırsan tarayıcıyı kapatıp yeniden dene
                  veya kaynak olarak cookies.txt dosyası seç.
                </p>
              )}
            </>
          )}
          <p className="cookie-note">
            Uzantı çerez göndermez. Bu seçenek yalnız seçtiğin kaynağı işlem sırasında
            yerel olarak kullanır.
          </p>

          <details className="expert-settings">
            <summary>Uzman ayarları</summary>
            <label className="setting-row">
              <input
                type="checkbox"
                checked={value.compatibility.remoteEjsEnabled}
                onChange={(event) =>
                  updateCompatibility({ remoteEjsEnabled: event.target.checked })
                }
              />
              <span className="setting-icon"><RefreshCw size={14} /></span>
              <span>
                <strong>Güncel EJS yedeği</strong>
                <small>Gerektiğinde resmi yt-dlp-ejs bileşenini kullanır</small>
              </span>
            </label>
            <label className="setting-row">
              <input
                type="checkbox"
                checked={value.compatibility.poTokenProvidersEnabled}
                onChange={(event) =>
                  updateCompatibility({ poTokenProvidersEnabled: event.target.checked })
                }
              />
              <span className="setting-icon"><Puzzle size={14} /></span>
              <span>
                <strong>PO Token sağlayıcıları</strong>
                <small>Uygulama klasöründeki uyumlu yt-dlp eklentilerini yükler</small>
              </span>
            </label>
            {value.compatibility.poTokenProvidersEnabled && pluginDirectory && (
              <code className="plugin-path" title={pluginDirectory}>{pluginDirectory}</code>
            )}
          </details>

          {onRepairNativeBridge && (
            <button
              className="settings-repair-button"
              type="button"
              onClick={onRepairNativeBridge}
              disabled={bridgeRepairing}
            >
              <RefreshCw className={bridgeRepairing ? "spin" : ""} size={15} />
              {bridgeRepairing ? "Tarayıcı bağlantısı onarılıyor" : "Tarayıcı bağlantısını onar"}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
