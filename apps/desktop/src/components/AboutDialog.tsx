import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bug, Clapperboard, ExternalLink, FileText, LoaderCircle, X } from "lucide-react";
import { Dialog } from "./Dialog";
import { errorMessage } from "../lib/format";

const documents = [
  { name: "KULLANIM-KOSULLARI.md", label: "Kullanım koşulları" },
  { name: "GIZLILIK.md", label: "Gizlilik bildirimi" },
  { name: "THIRD_PARTY_NOTICES.md", label: "Üçüncü taraf bildirimleri" },
  { name: "LICENSE", label: "Lisans (GPL-3.0)" },
] as const;

export function AboutDialog({
  version,
  displayVersion,
  onClose,
}: {
  version: string;
  displayVersion: string;
  onClose: () => void;
}) {
  const [document, setDocument] = useState<(typeof documents)[number]["name"] | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!document) return;
    let alive = true;
    setText(null);
    setError(null);
    invoke<string>("legal_document", { name: document })
      .then((value) => {
        if (alive) setText(value);
      })
      .catch((cause) => {
        if (alive) setError(errorMessage(cause));
      });
    return () => {
      alive = false;
    };
  }, [document]);

  const openPage = (page: "repository" | "releases" | "issues") =>
    void invoke("open_project_page", { page }).catch((cause) => setError(errorMessage(cause)));

  return (
    <Dialog className="about-modal" labelledBy="about-title" onClose={onClose}>
      <div className="modal-head">
        <span className="side-icon"><Clapperboard size={18} /></span>
        <div>
          <h2 id="about-title">Lipit Capture {displayVersion}</h2>
          <p>Kişisel arşiv ve klip aracı · sürüm {version}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Hakkında penceresini kapat"><X size={18} /></button>
      </div>
      <div className="about-body">
        <p>
          Lipit ücretsiz ve açık kaynaklıdır (GPL-3.0-or-later). Tüm işlemler bu
          bilgisayarda yapılır; telemetri gönderilmez. Lipit hiçbir video platformuyla
          bağlantılı değildir. Yalnızca indirme hakkın olan içerikleri kaydet.
        </p>
        <div className="about-links">
          <button type="button" onClick={() => openPage("repository")}>
            <ExternalLink size={14} /> Kaynak kodu
          </button>
          <button type="button" onClick={() => openPage("releases")}>
            <ExternalLink size={14} /> Sürümler
          </button>
          <button type="button" onClick={() => openPage("issues")}>
            <Bug size={14} /> Hata bildir / öneri
          </button>
        </div>
        <div className="about-documents" role="tablist" aria-label="Yasal belgeler">
          {documents.map((item) => (
            <button
              key={item.name}
              type="button"
              role="tab"
              aria-selected={document === item.name}
              className={document === item.name ? "selected" : ""}
              onClick={() => setDocument(item.name)}
            >
              <FileText size={14} /> {item.label}
            </button>
          ))}
        </div>
        {document && (
          <div className="about-document" role="tabpanel">
            {text == null && !error && <LoaderCircle className="spin" size={18} />}
            {error && <p className="settings-inline-error">{error}</p>}
            {text != null && <pre>{text}</pre>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
