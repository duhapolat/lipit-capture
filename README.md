# Lipit Capture

Kullanıcının erişim ve indirme hakkına sahip olduğu ( öncelikle Twitter, Instagram, YouTube ) DRM korumasız medyaları yerel olarak indirmek ve klip oluşturmak için tasarlanan masaüstü uygulaması.

## Sürüm 1.0 beta 1

1.0 beta 1, Lipit'in yerel medya atölyesi arayüzünü getirir. Tarayıcıdaki hızlı indirme ve hızlı klip işlemleri küçük bir ilerleme penceresinde çalışır; ana uygulama arka planda kalabilir. FFmpeg ağ protokolleri HTTP/HTTPS akışlarıyla sınırlıdır, canlı yayınların yanlışlıkla sınırsız indirilmesi engellenir, iptalde Windows işlem ağacı kapatılır ve uygulama açılışında eski geçici iş dosyaları temizlenir.

Tarayıcıdaki medya araçları video üzerinde sürüklenebilir ve yarı şeffaftır. Hızlı indirme ve hızlı klip işlemleri ana pencereyi göstermeden arka planda başlar; küçük bir ilerleme penceresi yüzdeyi gösterir ve işlem tamamlandığında kendiliğinden kapanır. Medya motorlarının durumu ana sayfadaki kart yerine üst çubuktaki açılır panelde bulunur.

Videonun tamamı indirilebilir veya başlangıç ve bitiş zamanı milisaniye hassasiyetinde seçilerek MP4 klip oluşturulabilir. **Hızlı kesim** sosyal medya kaynaklarında da bağımsız ve sorunsuz ileri sarılabilen bir MP4 üretmek için hızlı H.264 kodlama kullanır. **Hassas kesim** daha yüksek kalite ayarıyla seçilen kareye ulaşır. Tarayıcıdaki **Klip** düğmesi, videonun o anki oynatma zamanını başlangıç noktası olarak masaüstüne aktarır.

Masaüstü uygulaması tarayıcıdan gelen Referer, Origin ve User-Agent bağlamını doğrulayarak yt-dlp ve doğrudan FFmpeg isteklerine aktarır. Gelişmiş uyumluluk ayarlarında tarayıcı çerezleri yalnızca kullanıcı açıkça etkinleştirirse işlem sırasında yt-dlp tarafından okunur; uzantı çerezleri toplamaz veya native mesaja eklemez.

Deno çalışma zamanı ve yt-dlp-ejs desteği uygulamayla birlikte gelir. Yerleşik yt-dlp motoru uygulamadan ayrı güncellenebilir. İhtiyaç halinde resmi uzak EJS bileşeni etkinleştirilebilir. PO Token sağlayıcıları için uygulamaya özel, varsayılan olarak kapalı bir yt-dlp eklenti klasörü hazırlanır; üçüncü taraf sağlayıcı otomatik kurulmaz.

Tamamlanan indirmeler yerel geçmişte tutulur ve dosya bilgisayarda duruyorsa uygulama içinde MP4 olarak önizlenebilir. Geçmiş temizlendiğinde medya dosyaları silinmez. Klavye kısayolları `?` tuşuyla görüntülenebilir. Akış varyantları geçici CDN imzaları, kalite klasörleri ve manifest adları normalize edilerek aynı medya altında gruplanır.

Uzantı DOM algılamasına ek olarak ağ trafiğini pasif biçimde gözlemler. MP4, WebM, MOV, HLS ve DASH kaynakları MIME türü ve URL sinyalleriyle tanınır. Segment ve range istekleri elenir; adaylar sekme bazlı CandidateStore içinde normalize edilir, aynı kaynaklar birleştirilir ve sayı sınırı uygulanır. Blob video görüldüğünde en uygun ağ manifesti DOM bilgileriyle birleştirilerek Native Messaging üzerinden masaüstüne aktarılır. Video araçlarında standart İndir/Klip seçeneklerine ek olarak hızlı profile bağlı tek tık işlemleri ve gizle/tekrar göster kontrolü bulunur.

X/Twitter akışlarında uzantı video kartının tweet kalıcı bağlantısını doğrudan bulur. `mp4a` gibi yalnızca ses içeren HLS listeleri elenir ve mevcutsa ana HLS manifesti tercih edilir.

TikTok akışlarında videoyu saran kalıcı bağlantı ve görünür karta en yakın `/@kullanici/video/kimlik` bağlantısı seçilir. Böylece akışta önceden yüklenen sonraki video yerine, düğmenin üzerinde bulunduğu video çözülür.

Uzantı ağ isteklerini değiştirmez veya engellemez. Çerez, token ve yetkilendirme başlığı toplamaz.

## Çalıştırma

1. [Tauri Windows ön koşullarını](https://v2.tauri.app/start/prerequisites/) kurun: Rust, Microsoft C++ Build Tools ve WebView2. Bu çalışma alanında yerel GNU Rust toolchain de `.toolchain/` altında bulunabilir.
2. `node scripts/prepare-binaries.mjs` ile Windows x64 medya araçlarını ve Deno'yu indirin. Betik sürümleri sabitler ve SHA-256 doğrulaması yapar.
3. `cd apps/desktop` ve `npm install` çalıştırın.
4. Proje kökünde `npm run dev` çalıştırın.

Derleme: `npm run build` (çalıştırılabilir dosya). Testleri çalıştırıp imzasız Windows setup üretmek için proje kökünde `npm run bundle:windows` kullanın. Daha önce doğrulanmış aynı derlemeden yalnızca setup üretmek için `npm run package:windows` kullanılabilir. Medya araçları Tauri `externalBin` olarak paketlenir; React process başlatamaz. Kaynaklar ve sürümler [docs/binaries.md](docs/binaries.md) dosyasındadır.

Beta sürüm kapısı: Lipit kapalıyken proje kökünde `npm run check:release` çalıştırın. Bu komut güvenlik kurallarını, bağımlılıkları, Rust birim testlerini, sıkı kod taramasını, uzantıyı ve arayüzü kontrol eder; uygulamayı yeniden derler; ardından yerel köprü, hızlı pencere, gerçek YouTube çözümleme ve beş saniyelik MP4 klip/ileri sarma testini çalıştırır. Çevrim içi testler için internet bağlantısı gerekir. Son denetim sonuçları [beta sürüm raporunda](docs/beta-release-audit.md) kayıtlıdır.

## Tarayıcı uzantısını kurma

1. Proje kökünde `npm run build` çalıştırın.
2. Bir kez `npm run install:bridge` çalıştırın. Bu işlem Native Messaging hostunu mevcut Windows kullanıcısı için Chrome, Edge ve Brave'e kaydeder.
3. Tarayıcının uzantılar sayfasında **Geliştirici modu**nu açın.
4. **Paketlenmemiş öğe yükle** ile `apps/extension/dist` klasörünü seçin.
5. Video içeren bir HTTP/HTTPS sayfasını yenileyin. Videonun sağ üstündeki **İndir** düğmesi adayı masaüstüne gönderir ve Lipit'i açar.

Uzantı kimliği sabittir: `nhcgifoaikjkndkbnkkllknmlfbkdcbc`. Native host kayıt dosyası yalnızca bu uzantının bağlanmasına izin verir. Uzantı çerez veya yetkilendirme başlığı toplamaz.

## Kullanım

Tek video URL’sini yapıştırın, **Videoyu çözümle** düğmesine basın ve kaliteyi seçin. Alt bölümdeki **Tamamını indir** düğmesi videonun tamamını, yanındaki **Klip oluştur** düğmesi seçilen zaman aralığını kaydeder. İlk açılışta hızlı profil hazırlanır; kayıt konumu, kalite, 15 saniye ile 5 dakika arasındaki klip süresi ve kesim yöntemi daha sonra **Ayarlar** bölümünden değiştirilebilir. Mevcut dosyanın üzerine yazılmaz; başka bir ad seçin. Uygulama önce kendi geçici iş klasöründe çalışır, çıktı dosyasını seçilen dizine güvenli şekilde taşır ve iş klasörünü temizler.

DRM korumalı içerikleri çözmeye veya indirmeye çalışmaz. Çıktı kalitesi ve kullanılabilir biçimler kaynağa ve yt-dlp desteğine bağlıdır.

## Sonraki aşamalar

- [x] Chromium Manifest V3 uzantısı, DOM detector ve video overlay
- [x] Sürümlü Native Messaging protokolü, şema ve boyut doğrulaması
- [x] Tarayıcıdan gelen adayı masaüstünde otomatik çözümleme
- [x] Phase 3: network detector, MP4/HLS/DASH adayları, CandidateStore ve deduplication
- [x] Phase 4: Hızlı kesim, Hassas kesim ve timeline kontrolleri
- [x] Phase 5: İstek başlıkları, isteğe bağlı çerezler, motor güncelleme, Deno, yt-dlp-ejs ve PO Token sağlayıcı hazırlığı
- [x] Phase 6: İndirme geçmişi, klavye kısayolları, masaüstü önizleme ve gelişmiş akış gruplama
- [x] 0.7: İlk açılış hızlı profili, bağımsız Ayarlar ekranı ve kompakt hızlı işlem düğmeleri

Arayüz için ertelenen son düzenleme maddeleri [docs/polish-backlog.md](docs/polish-backlog.md) dosyasında tutulur.

## Lisans ve kod imzası

Copyright © 2026 Muhammed Duha Polat. Lipit Capture, [GNU GPL sürüm 3 veya sonrası](LICENSE) ile lisanslanır. Birlikte dağıtılan üçüncü taraf araçların koşulları [üçüncü taraf bildirimlerinde](THIRD_PARTY_NOTICES.md) ve [lisans envanterinde](licenses/DEPENDENCY_LICENSES.txt) bulunur.

Windows açık kaynak sürümleri SignPath Foundation üzerinden imzalanacaktır. Ayrıntılar [kod imzalama politikasında](docs/code-signing-policy.md) açıklanır. İmzasız yerel setup adayı `npm run bundle:windows` ile üretilir; herkese açık sürüm olarak yalnızca SignPath tarafından imzalanmış setup yayımlanır.
