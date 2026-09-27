# Lipit Capture 1.0 beta 1 — sürüm öncesi teknik denetim

**Denetim tarihi:** 27 Eylül 2026  
**Kapsam:** Windows x64 masaüstü uygulaması, Chromium Manifest V3 uzantısı, Native Messaging köprüsü, yerleşik medya motorları ve gerçek indirme/klip akışı.

## Sonuç

Kaynak kodda veya kilitli bağımlılıklarda bilinen kritik/yüksek güvenlik açığı bulunmadı. Üretim derlemesi, uzantı, yerel köprü, URL çözümleme, hızlı işlem penceresi, gerçek MP4 klip hattı ve NSIS kurulum/kaldırma senaryosu geçti. Kod **1.0.0-beta.1** olarak etiketlendi.

GPL-3.0-or-later proje lisansı, üçüncü taraf lisans envanteri ve imzasız beta setup hazırlandı. Herkese açık GitHub sürümünden önce kalan dağıtım kapısı SignPath başvurusu ile setup'ın imzalanmasıdır.

## Uygulanan güvenlik düzenlemeleri

- HTTP/HTTPS dışındaki, kullanıcı bilgisi taşıyan, localhost, özel ağ, link-local ve ayrılmış IP adresleri reddediliyor.
- Tarayıcıdan gelen URL, başlık, dosya adı ve hızlı pencere iş kimliği doğrulanıyor.
- Hedef dosyanın üzerine yazılmıyor; çıktı önce geçici iş alanında hazırlanıyor.
- FFmpeg ağ protokolleri gerekli HTTP/HTTPS kümesiyle sınırlandırılıyor.
- Uygulama içi yt-dlp güncellemesi doğrulama atlandığında veya sürüm biçimi geçersiz olduğunda yedeği geri yüklüyor.
- Tarayıcı çerezleri, uzak EJS bileşeni ve üçüncü taraf PO Token sağlayıcıları varsayılan olarak kapalı.
- Masaüstü WebView CSP ayarında `unsafe-eval` yok; ön yüz kabuk çalıştırma izni almıyor.
- Uzantı `cookies`, `downloads`, `history`, `clipboardRead` veya `management` izni istemiyor.
- Uzantı imzalama özel anahtarı çalışma alanından çıkarıldı; yalnızca kullanıcı profilindeki yerel imzalama klasöründe tutuluyor. Gizli anahtar uzantıları Git tarafından ve güvenlik testi tarafından engelleniyor.
- Paketlenmiş motorların SHA-256 değerleri derleme hazırlığında ve beta güvenlik kapısında doğrulanıyor.

## Test sonuçları

| Alan | Sonuç | Kanıt |
|---|---:|---|
| TypeScript ve üretim arayüz derlemesi | Geçti | 1.887 modül, ana JS 285,01 kB / gzip 86,69 kB |
| Rust birim testleri | Geçti | 24/24 |
| Rust Clippy sıkı tarama | Geçti | `-D warnings`, release, locked, all targets |
| Chromium uzantı testleri | Geçti | CandidateStore ve ağ algılayıcı |
| Native Messaging | Geçti | PING alışverişi |
| Hızlı işlem penceresi | Geçti | Koyu tema, içerik ve ilerleme kökü WebView üzerinde doğrulandı |
| Gerçek YouTube çözümleme | Geçti | Başlık döndü, çözümleme takılı kalmadı |
| Gerçek klip hattı | Geçti | 5,04 sn MP4, H.264; 3. saniyeye seek ve kare çözme başarılı |
| npm güvenlik taraması | Geçti | 0 bilinen açık |
| RustSec güvenlik taraması | Geçti | 465 paket, 0 bilinen açık |
| Üretim uygulama derlemesi | Geçti | `lipit-desktop.exe` üretildi |
| Windows setup kurulumu | Geçti | Sessiz NSIS kurulumu; uygulama, WebView2Loader, medya motorları ve lisanslar doğrulandı |
| Kurulu uygulama açılışı | Geçti | Kurulu `lipit-desktop.exe` 8 sn boyunca sağlıklı çalıştı |
| Kurulu Native Messaging köprüsü | Geçti | Manifest, Chrome/Edge/Brave kayıtları ve kurulu host PING doğrulandı |
| Windows kaldırma | Geçti | Uygulama/köprü dosyaları ve kayıtları kaldırıldı; kullanıcı verisi korundu |
| Boşta kaynak kullanımı | Geçti | 26,4 MB RAM; 20 sn ölçümde tek çekirdek ortalaması %0,08; medya motoru 0 |
| İşlem temizliği | Geçti | Testlerden sonra Lipit/yt-dlp/FFmpeg/Deno işlemi kalmadı |

RustSec ayrıca altı bakımı bırakılmış dolaylı paket ve `glib 0.18.5` için bir sağlamlık uyarısı gösteriyor. Bunlar bilinen güvenlik açığı olarak sınıflandırılmıyor. `glib` Windows hedef bağımlılık ağacında bulunmuyor; diğer kayıtlar üst bağımlılıkların güncellenmesiyle izlenecek.

## Üretilen beta dosyaları

| Dosya | Sürüm | SHA-256 |
|---|---|---|
| `lipit-desktop.exe` | 1.0.0-beta.1 | `64CD1874F5FB77092B3C1379B24E4C718EC8458DB7FC73B013EBF155AF5311CA` |
| `lipit-native-host.exe` | 1.0.0-beta.1 | `D3410FB76DBBB51E449E103C233D7D368F25CA8CCD5D404BE6B5F37AB6D3556B` |
| `Lipit-Capture-1.0.0-beta.1-Windows-x64-unsigned-setup.exe` | 1.0.0-beta.1 | `BCC821D99547E7752112328639E893D21B1603D32799EF734269AD2C4BA3EA19` |

Motor sürümleri ve sabit özetleri [binaries.md](binaries.md) dosyasındadır.

## Otomatik beta kapısı

Lipit kapalıyken proje kökünde:

```powershell
npm run check:release
```

Bu komut statik güvenlik ve bağımlılık kontrollerini, Rust ve uzantı testlerini, üretim derlemesini, yerel köprüyü, hızlı pencereyi, gerçek URL çözümlemeyi ve gerçek klip/ileri sarma hattını sırayla çalıştırır. Çevrim içi testler ağ erişimi gerektirir.

## Paketleme ve GitHub öncesi kapılar

| Kapı | Durum | Açıklama |
|---|---:|---|
| Proje lisansı | Tamamlandı | GPL-3.0-or-later; telif sahibi Muhammed Duha Polat |
| Üçüncü taraf lisans paketi | Tamamlandı | FFmpeg, yt-dlp, Deno ve kilitli Rust/JavaScript bağımlılıkları setup'a eklendi |
| Windows kurulum/kaldırma | Tamamlandı | Gerçek kullanıcı kurulumu, açılış, köprü, sessiz kaldırma ve veri koruma denendi |
| Windows kod imzası | Bekliyor | Açık kaynak depo yayımlandıktan ve SignPath Foundation başvurusu onaylandıktan sonra CI çıktısı imzalanacak |
| Sürüm bütünlüğü | GitHub aşamasında | Git etiketi, sürüm notu, imzalı setup ve yayımlanan SHA-256 aynı sürüm iş akışından üretilecek |

## Kalan teknik riskler

- yt-dlp ve FFmpeg internetteki güvenilmeyen medya verisini işler. Sürümlerin sabitlenmesi, özet doğrulaması, protokol sınırı ve güncelleme geri alma mekanizması riski azaltır; medya motorları Windows AppContainer içinde çalışmıyor.
- İlk URL'de özel ağ ve yerel adresler engellenir. Bir dış alan adının sonradan DNS cevabını değiştirmesi veya uzak sunucunun başka bir adrese yönlendirmesi medya motorunun kendi ağ katmanında gerçekleşir. Tam ağ izolasyonu ileride ayrı bir yardımcı işlem/sandbox gerektirir.
- Evrensel sayfa algılama için uzantı HTTP/HTTPS sayfalarda geniş host erişimi kullanır. Uzantı istekleri değiştirmez, çerez/yetkilendirme başlığı toplamaz ve yalnızca kullanıcının Lipit düğmesine basmasıyla masaüstüne aday gönderir.
