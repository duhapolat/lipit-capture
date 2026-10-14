# Değişiklik günlüğü

Bu dosya [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) biçimini izler. Sürüm notları GitHub sürüm iş akışında bu dosyadan üretilir; her sürüm etiketinden önce ilgili başlık eklenmelidir.

## [Yayımlanmamış]

## [1.0.0-beta.6] - 2026-10-14

### Güvenlik
- Derleme makinesinin yolu artık üretim ikilisine gömülmüyor. Medya motorları yalnızca kurulum klasöründen yükleniyor. Sürüm iş akışı bunu ayrıca denetliyor.
- Video adresinin alan adı çözümlenip yerel veya özel ağ adreslerine yönlenenler reddediliyor.
- Sürüm iş akışı ikiye ayrıldı. Derleme yalnızca okuma izniyle çalışıyor; yayımlama ayrı bir işte yapılıyor.
- Güvenlik denetimine iki kural eklendi: izin verilen bağlantı adresleri listesi ve derleme yolu sızıntısı.

### Düzeltilenler
- Arka arkaya gönderilen hızlı indirme ve hızlı klip istekleri artık kaybolmuyor veya birbirini iptal etmiyor. Hızlı işlemler arka planda sıraya alınıyor ve gizli pencereye bağlı kalmıyor.
- Sabit klasörde aynı adı alan iki işten ikincisi, indirme bittikten sonra hata vermek yerine `ad_1.mp4` olarak kaydediliyor.
- Çözümleme zaman aşımı yeniden deneme süresiyle uyumlu hale getirildi (45 sn). On saniyeden sonra "kaynak yavaş yanıt veriyor" bilgisi gösteriliyor.
- Bozuk ayar veya geçmiş dosyası uygulamayı kilitlemiyor. Dosya yedekleniyor, varsayılanlarla devam ediliyor ve kullanıcı bilgilendiriliyor.
- Alt bilgideki ve durum rozetindeki metinler artık motorların gerçek durumunu gösteriyor.

### Eklenenler
- Klip aralığı seçilirken başlangıç ve bitiş noktalarının karesi önizleniyor.
- Hata mesajları ayrıntılandı: giriş gerekli, özel video, yaş doğrulaması, bölge kısıtı, kaldırılmış video, desteklenmeyen bağlantı, ağ hatası ve motor güncelliği ayrı ayrı anlatılıyor.
- Kurulum sihirbazına uzantı kurulum adımı eklendi. Uzantının bağlantı durumu ve sürüm uyumu canlı olarak gösteriliyor.
- Tamamlanan işler için "Oynat" ve "Klasörde göster", başarısız işler için "Tekrar dene" eklendi. İndirme hızı ve kalan süre görünüyor.
- Tüm geçmiş ekranı eklendi: arama, türe göre filtre, tek kayıt silme, klasörde gösterme ve küçük resimler.
- Dosya adı şablonu eklendi: başlık, başlık + tarih veya kaynak + başlık + tarih.
- Çerez kaynağı olarak `cookies.txt` dosyası seçilebiliyor.
- Günde bir kez ve kapatılabilen biçimde yeni uygulama ve yt-dlp sürümü denetleniyor; yalnızca sürüm numarası okunuyor.
- Yerel günlük dosyası eklendi. Adresler alan adına indiriliyor ve kullanıcı klasörü maskeleniyor.
- Yerel istatistikler eklendi (yalnız bu bilgisayarda tutuluyor).
- Hakkında penceresi eklendi: sürüm, kaynak kodu, hata bildirimi ve yasal belgeler uygulama içinden okunabiliyor.
- Kullanım koşulları, Türkçe gizlilik bildirimi ve ilk açılışta koşul onayı eklendi.
- Ön yüz birim testleri (`npm run test:ui`), her push'ta çalışan CI ve gece motor duman testi eklendi.

### Değişenler
- Ürün adı her yerde "Lipit Capture" oldu. Ana başlık "Yeni video", zaman kodu biçimi `SS:DD:ss.mmm` oldu; eski biçim de kabul ediliyor.
- Uzman uyumluluk ayarları (uzak EJS, PO Token) katlanabilir bir bölüme taşındı.
- Onay pencereleri uygulama içi diyaloglarla değiştirildi. Tüm pencerelerde odak yönetimi ve Esc ile kapatma var.
- Uzantının sayfa bağlamı hesaplaması önbelleğe alındı. Sürekli düzen hesaplaması kaldırıldı.
- Arayüz bileşenlere bölündü. Tailwind bağımlılığı kaldırıldı.
- Küçük metinlerin boyutu ve kontrastı artırıldı. Hareket azaltma tercihine uyuluyor.

### Kaldırılanlar
- Aynı kapak görselinin tekrarlandığı sahte film şeridi.
- Tekrarlayan `Ctrl+Shift+D` kısayolu (`Ctrl+1` ile aynı işi yapıyordu).
- Native host'un her istekte `tasklist.exe` çalıştırması. Yerine adlandırılmış mutex denetimi geldi.

## [1.0.0-beta.5] - 2026-10-08

- Video üzerindeki araçlar üç simgeli, sürüklenebilir çubuğa dönüştürüldü. Shift+F9 ile gizlenebiliyor.
- Tarayıcı bağlantısını onarma aracı eklendi.

## [1.0.0-beta.1] - 2026-09-27

- İlk herkese açık beta: yerel indirme ve klip, Chromium uzantısı, Native Messaging köprüsü, hızlı profil, geçmiş ve önizleme.
