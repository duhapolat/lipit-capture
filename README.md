# Lipit Capture

[![Windows release build](https://github.com/duhapolat/lipit-capture/actions/workflows/windows-release.yml/badge.svg)](https://github.com/duhapolat/lipit-capture/actions/workflows/windows-release.yml)

Kendi videoların, açık lisanslı içerikler ve indirme iznin olan DRM korumasız videolar için yerel, kişisel bir arşivleme ve klip oluşturma aracı. Tüm işlemler bilgisayarında gerçekleşir; Lipit içerik barındırmaz veya paylaşmaz.

> Lipit herhangi bir video platformu veya içerik sağlayıcısıyla bağlantılı değildir. Bir içeriği indirme ve kullanma hakkına sahip olup olmadığını belirlemek kullanıcının sorumluluğundadır. Ayrıntılar için [Kullanım Koşulları](KULLANIM-KOSULLARI.md) ve [Gizlilik Bildirimi](GIZLILIK.md) belgelerine bakın.

## Özellikler

- **Tarayıcıdan tek tıkla:** Video üzerindeki araç çubuğundan "Lipit'te aç", "Hızlı klip" ve "Hızlı indir". Hızlı klip videonun o anki zamanından başlar. Arka arkaya gönderilen hızlı işlemler sıraya alınır, hiçbiri kaybolmaz.
- **Klip editörü:** Başlangıç ve bitiş milisaniye hassasiyetinde seçilir ve seçilen anların karesi önizlenir. **Hızlı kesim** çabuk ve sorunsuz ileri sarılabilen bir MP4 üretir; **Hassas kesim** seçilen kareye daha yakın keser.
- **Güvenli kayıt:** Hiçbir dosyanın üzerine yazılmaz. Sabit klasörde çakışan adlar `ad_1.mp4` olur. Çıktı önce geçici iş alanında hazırlanır.
- **Geçmiş:** Küçük resimler, arama, oynatma, klasörde gösterme ve tek kayıt silme. Geçmişi silmek dosyaları silmez.
- **Anlaşılır hatalar:** Giriş gerekli, özel video, bölge kısıtı, kaldırılmış video, hız sınırı ve motor güncelliği ayrı ayrı açıklanır.
- **Gizlilik:** Telemetri yok. Yerel günlük maskelenir, istatistikler yalnızca bu bilgisayarda tutulur. Güncelleme denetimi yalnızca sürüm numarası okur ve kapatılabilir.
- **Güvenlik:** Özel ağ ve yerel adresler (DNS çözümü dahil) reddedilir. FFmpeg protokolleri sınırlıdır. Motorlar sabit sürüm ve SHA-256 ile doğrulanır. yt-dlp güncellemesi doğrulanamazsa geri alınır.

Uzantı ağ isteklerini değiştirmez veya engellemez; çerez, token ve yetkilendirme başlığı toplamaz. DRM korumalı içerik desteklenmez.

Mimari ve güvenlik sınırları [docs/architecture.md](docs/architecture.md) dosyasında, değişiklikler [CHANGELOG.md](CHANGELOG.md) dosyasında, ürün kapsamı [docs/urun-vizyonu.md](docs/urun-vizyonu.md) dosyasında anlatılır.

## Çalıştırma

1. [Tauri Windows ön koşullarını](https://v2.tauri.app/start/prerequisites/) kurun: Rust, Microsoft C++ Build Tools ve WebView2. Bu çalışma alanında yerel GNU Rust toolchain de `.toolchain/` altında bulunabilir.
2. `node scripts/prepare-binaries.mjs` ile Windows x64 medya araçlarını ve Deno'yu indirin. Betik sürümleri sabitler ve SHA-256 doğrulaması yapar.
3. `cd apps/desktop` ve `npm install` çalıştırın.
4. Proje kökünde `npm run dev` çalıştırın.

Derleme: `npm run build` (çalıştırılabilir dosya). Testleri çalıştırıp imzasız Windows setup üretmek için proje kökünde `npm run bundle:windows` kullanın. Daha önce doğrulanmış aynı derlemeden yalnızca setup üretmek için `npm run package:windows` kullanılabilir. Medya araçları Tauri `externalBin` olarak paketlenir; React process başlatamaz. Kaynaklar ve sürümler [docs/binaries.md](docs/binaries.md) dosyasındadır.

Beta sürüm kapısı: Lipit kapalıyken proje kökünde `npm run check:release` çalıştırın. Bu komut güvenlik kurallarını, bağımlılıkları, Rust birim testlerini, sıkı kod taramasını, uzantıyı ve arayüzü kontrol eder; uygulamayı yeniden derler; ardından yerel köprü, hızlı pencere, açık lisanslı örnek bir videoyla gerçek çözümleme ve beş saniyelik MP4 klip/ileri sarma testini çalıştırır. Örnek video `LIPIT_TEST_MEDIA_URL` ortam değişkeniyle, sahibi olduğun veya indirme iznin bulunan başka bir videoyla değiştirilebilir. Çevrim içi testler için internet bağlantısı gerekir. Son denetim sonuçları [beta sürüm raporunda](docs/beta-release-audit.md) kayıtlıdır.

## Tarayıcı uzantısını kurma

1. Proje kökünde `npm run build` çalıştırın.
2. Bir kez `npm run install:bridge` çalıştırın. Bu işlem Native Messaging hostunu mevcut Windows kullanıcısı için Chrome, Edge ve Brave'e kaydeder.
3. Tarayıcının uzantılar sayfasında **Geliştirici modu**nu açın.
4. **Paketlenmemiş öğe yükle** ile `apps/extension/dist` klasörünü seçin.
5. Video içeren bir HTTP/HTTPS sayfasını yenileyin. Videonun köşesindeki Lipit düğmeleri adayı masaüstüne gönderir.

Kurulu uygulamada aynı adımlar ilk açılış sihirbazında ve Ayarlar › Tarayıcı uzantısı bölümünde, bağlantı durumuyla birlikte gösterilir.

Uzantı kimliği sabittir: `nhcgifoaikjkndkbnkkllknmlfbkdcbc`. Native host kayıt dosyası yalnızca bu uzantının bağlanmasına izin verir. Uzantı çerez veya yetkilendirme başlığı toplamaz.

## Kullanım

İlk açılışta kullanım koşullarını onaylayın ve hızlı profili kaydedin. Tek video URL’sini yapıştırın, **Videoyu getir** düğmesine basın ve kaliteyi seçin. Alt bölümdeki **Tamamını indir** düğmesi videonun tamamını, yanındaki **Klip oluştur** düğmesi seçilen zaman aralığını kaydeder. İlk açılışta hızlı profil hazırlanır; kayıt konumu, kalite, 15 saniye ile 5 dakika arasındaki klip süresi ve kesim yöntemi daha sonra **Ayarlar** bölümünden değiştirilebilir. Mevcut dosyanın üzerine yazılmaz; başka bir ad seçin. Uygulama önce kendi geçici iş klasöründe çalışır, çıktı dosyasını seçilen dizine güvenli şekilde taşır ve iş klasörünü temizler.

DRM veya benzeri koruma önlemleriyle korunan içerikleri çözmeye, indirmeye veya bu önlemleri aşmaya çalışmaz. Çıktı kalitesi ve kullanılabilir biçimler kaynağa ve yt-dlp desteğine bağlıdır.

## Sorun giderme ve katkı

- Sık karşılaşılan sorunlar: [docs/SSS.md](docs/SSS.md)
- Sürüm, geri alma ve olay müdahalesi: [docs/release-process.md](docs/release-process.md)
- Katkı rehberi: [CONTRIBUTING.md](CONTRIBUTING.md)
- Testler: `npm run check:beta` (çevrim dışı), `npm run check:release` (tam sürüm kapısı)

## Yasal

- [Kullanım Koşulları](KULLANIM-KOSULLARI.md): Lipit yalnızca kendi içeriklerin, açık lisanslı içerikler ve hak sahibinin izin verdiği videolar için kullanılabilir.
- [Gizlilik Bildirimi](GIZLILIK.md) ([English](PRIVACY.md)): Lipit telemetri göndermez; tüm veriler bilgisayarında kalır.
- Lipit ücretsizdir; reklam, ücretli sürüm veya içerik barındırma yoktur.
- Üçüncü taraflara ait adlar ve markalar sahiplerine aittir.

## Lisans

Copyright © 2026 Muhammed Duha Polat. Lipit Capture, [GNU GPL sürüm 3 veya sonrası](LICENSE) ile lisanslanır. Birlikte dağıtılan üçüncü taraf araçların koşulları [üçüncü taraf bildirimlerinde](THIRD_PARTY_NOTICES.md) ve [lisans envanterinde](licenses/DEPENDENCY_LICENSES.txt) bulunur.

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/). Roller, imzalama akışı ve gizlilik bilgileri [Lipit code signing policy](docs/code-signing-policy.md) belgesinde açıklanır. İmzasız yerel setup adayı `npm run bundle:windows` ile üretilir; SignPath katılımı tamamlandıktan sonraki herkese açık Windows sürümleri doğrulanmış GitHub Actions çıktısından imzalanacaktır.
