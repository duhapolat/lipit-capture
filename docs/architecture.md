# Lipit Capture mimarisi

## Bileşenler

```
Tarayıcı sekmesi
  └─ content.ts ── video üzerinde araç çubuğu (kapalı shadow DOM)
        │ chrome.runtime.sendMessage
        ▼
  background.ts ── CandidateStore (oturum belleği), ağ algılayıcı
        │ Native Messaging (stdio, protokol v1, ≤1 MB)
        ▼
lipit-native-host.exe ── doğrular, %APPDATA%\com.lipit.capture\native-messaging\inbox\*.json yazar,
        │                gerekirse masaüstünü başlatır (--quick-background)
        ▼
lipit-desktop.exe (Tauri 2 / Rust)
  ├─ quick.rs      gelen kutusunu 400 ms'de bir boşaltır
  │                · "Lipit'te aç" → ana pencereye (candidates-available olayı)
  │                · hızlı indirme/klip → FIFO kuyruğu → çözümle → iş başlat
  ├─ media.rs      yt-dlp ile meta veri (45 sn), önizleme kaynağı seçimi
  ├─ jobs.rs       tek eşzamanlı iş, iptal, MP4 hazırlama, üzerine yazmayan kayıt
  ├─ preview.rs    FFmpeg ile tek kare (klip editörü)
  ├─ history.rs    geçmiş (şema v2), küçük resimler, önizleme izni
  ├─ settings.rs   ayarlar (şema v2, migrasyon, bozuk dosya karantinası)
  ├─ stats.rs      yerel sayaçlar
  ├─ log.rs        maskeli, dönen yerel günlük
  ├─ url_safety.rs URL + DNS denetimi (özel ağ reddi)
  └─ binary.rs     sidecar çalıştırma, hata sınıflandırma, yt-dlp güncelleme
        ▲ IPC (invoke / event)
React arayüzü (MainApp + bileşenler) ve hızlı işlem penceresi (QuickWidget)
```

## Güven sınırları

| Sınır | Denetim |
|---|---|
| Web sayfası → uzantı | Kapalı shadow DOM; sayfa düğmelere programatik olarak basamaz. Uzantı çerez ve yetki başlığı toplamaz. |
| Uzantı → native host | Sabit uzantı kimliği (`allowed_origins`), sürümlü şema, `deny_unknown_fields`, boyut sınırları, URL ve başlık doğrulaması. |
| Ön yüz → Rust | Ön yüzün süreç başlatma izni yoktur. Tüm girdiler Rust'ta yeniden doğrulanır. |
| Rust → medya motorları | Argüman dizisi ve `--` ayırıcısı kullanılır. FFmpeg protokol beyaz listesi uygulanır. Motorlar yalnızca kurulum klasöründen yüklenir. |
| İnternetteki medya | Özel ağ adresleri ilk URL'de ve DNS çözümünde reddedilir. Yönlendirmeler motorun kendi ağ katmanındadır (bkz. ADR-005). |

## Veri

[GIZLILIK.md](../GIZLILIK.md) hangi dosyanın nerede tutulduğunu listeler. Ayar ve geçmiş dosyaları `schemaVersion` taşır. Okunamayan bir dosya `*.corrupt-<zaman>.json` olarak yedeklenir ve kullanıcıya bir kez bildirim gösterilir.

## Mimari karar kayıtları (ADR)

### ADR-001: Native Messaging + dosya gelen kutusu
- **Karar:** Native host isteği bir dosyaya yazar, masaüstü bu kutuyu boşaltır.
- **Neden:** Masaüstü kapalıyken gelen istek kaybolmaz. Host kısa ömürlüdür. Sürekli açık bir yerel port gerekmez, bu da saldırı yüzeyini küçültür.
- **Bedeli:** En fazla 400 ms gecikme. Daha düşük gecikme gerekirse adlandırılmış kanal (named pipe) eklenebilir; dosya kutusu uygulama kapalıyken yine kullanılır.

### ADR-002: Hızlı işlemler Rust'ta sıraya alınır
- **Karar:** Hızlı indirme ve klip, arayüz yerine `quick.rs` içindeki FIFO kuyruğunda işlenir. Hiçbir hızlı işlem diğerini iptal etmez.
- **Neden:** Önceki tasarımda gizli WebView tek "manuel çözümleme" yuvasını paylaşıyordu; arka arkaya istekler düşüyordu (denetim F-01).

### ADR-003: Aynı anda tek iş
- **Karar:** `JobManager` aynı anda bir indirme veya klip işi çalıştırır (`Semaphore(1)`). Diğerleri sırada bekler.
- **Neden:** Platform hız sınırları (429), disk ve CPU kullanımı öngörülebilir kalır; ilerleme ve iptal davranışı basit kalır.
- **Bedeli:** Uzun bir tam indirme sırasında hızlı klip bekler. Talep olursa klipler için ikinci bir yuva açılabilir.

### ADR-004: Dosya adı kayıt anında kesinleşir
- **Karar:** Sabit klasör modunda `autoRename` açıktır. Hedef doluysa kayıt anında `ad_N.mp4` seçilir. "Her seferinde sor" modunda kullanıcının seçtiği ada dokunulmaz.

### ADR-005: Ağ izolasyonu yok, DNS denetimi var
- **Karar:** URL ve DNS düzeyinde özel ağ reddi uygulanır. Yönlendirme ve DNS yeniden bağlama motorun kendi ağ katmanında kaldığı için tam koruma sağlanmaz.
- **Gelecek:** Medya motorlarını kısıtlı bir Job Object veya AppContainer içinde çalıştırmak.

### ADR-006: Telemetri yok
- **Karar:** Kullanım ölçümü yalnızca yereldir (`stats.json`) ve Ayarlar'da gösterilir. Günlük dosyası yereldir ve maskelenir. Güncelleme denetimi yalnızca herkese açık sürüm numaralarını okur ve kapatılabilir.

### ADR-007: Uzantının geniş host izni
- **Karar:** `host_permissions` tüm HTTP/HTTPS sitelerini kapsar.
- **Neden:** Ağ algılayıcısı, video sayfasından farklı alan adlarındaki medya sunucularının isteklerini görmek zorundadır. İsteğe bağlı izinler (`optional_host_permissions`) bu sunucuları önceden bilemediği için algılamayı bozar.
- **Telafi:** İstekler değiştirilmez. Çerez, başlık ve sayfa içeriği toplanmaz. Masaüstüne yalnızca kullanıcı bir Lipit düğmesine bastığında aday gönderilir.
