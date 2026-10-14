# Sık sorulan sorular ve sorun giderme

### Windows "bilgisayarınız korundu" (SmartScreen) uyarısı veriyor
Beta kurulum dosyaları henüz kod imzalı değil. Dosyayı yalnızca resmi sürüm sayfasından indir ve `SHA256SUMS.txt` dosyasındaki değerle karşılaştır (PowerShell: `Get-FileHash .\dosya.exe`). Değer eşleşiyorsa "Ek bilgi › Yine de çalıştır" seçilebilir.

### Video üzerinde Lipit düğmeleri görünmüyor
1. Ayarlar › Tarayıcı uzantısı bölümünde durumun yeşil olduğunu kontrol et.
2. Uzantı kurulu değilse oradaki adımları izle ("Klasörü aç" uzantı klasörünü gösterir).
3. Uzantıyı kurduktan veya güncelledikten sonra video sayfasını yenile.
4. Düğmeler gizlenmiş olabilir. Shift+F9 ile tekrar göster.

### "Masaüstü bağlantısı kurulamadı" hatası
Ayarlar › Gelişmiş uyumluluk › "Tarayıcı bağlantısını onar" düğmesine bas. Sonra tarayıcıyı tamamen kapatıp yeniden aç.

### "Uzantı sürümü uyumlu değil" uyarısı
Uygulama güncellendi ama tarayıcıdaki uzantı eski kaldı. Uzantılar sayfasında Lipit'in "yeniden yükle" düğmesine bas veya uzantıyı kurulum klasöründen yeniden yükle.

### "Medya motoru bu kaynağı çözemedi" / "Bu bağlantıda indirilebilir bir video bulunamadı"
Siteler sık değişir. Motorlar menüsünden "yt-dlp güncelle"yi dene. Sorun sürerse bağlantının tek bir video sayfasına ait olduğundan emin ol.

### 429 (çok fazla istek) hatası
Kaynak, kısa sürede çok istek yapıldığı için bekleme istiyor. Birkaç dakika sonra tekrar dene.

### Oturum gerektiren videolar ("giriş gerekli", "yaş doğrulaması")
Erişim hakkın varsa Ayarlar › Gelişmiş uyumluluk › "Oturum çerezlerini kullan" seçeneğini aç. Chromium tabanlı tarayıcıların yeni sürümleri çerezlerin dışarıdan okunmasını engelleyebilir. Bu durumda kaynak olarak bir `cookies.txt` dosyası seç.

### Dosya nereye kaydedildi?
İşlemler panelinde veya geçmişte klasör simgesine bas; dosya Gezgin'de seçili olarak açılır.

### Aynı adla iki dosya kaydettim, biri kayboldu mu?
Hayır. Lipit hiçbir dosyanın üzerine yazmaz. Sabit klasör modunda ikinci dosya `ad_1.mp4` olarak kaydedilir.

### Hata bildirirken ne paylaşmalıyım?
Ayarlar › "Tanılamayı kopyala" çıktısını paylaş; bu çıktıda bağlantı ve dosya yolu bulunmaz. Gerekirse "Günlük klasörünü aç" ile `lipit.log` dosyasını ekle. Günlükte adresler yalnızca alan adı olarak tutulur ve kullanıcı klasörü maskelenir.

### Lipit internete ne gönderiyor?
Yalnızca senin başlattığın işlemlerde ilgili siteye bağlanır. Günde bir kez (kapatılabilir) yayın sayfasından sürüm numarasını okur. Telemetri yoktur. Ayrıntılar: [GIZLILIK.md](../GIZLILIK.md).
