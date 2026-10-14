# Lipit Capture Gizlilik Bildirimi

**Yürürlük tarihi:** 13 Ekim 2026

Lipit Capture ("Lipit"), kullanıcının bilgisayarında çalışan yerel bir uygulamadır. Lipit'in geliştiricisine ait bir sunucu yoktur; Lipit analitik, reklam, kullanım istatistiği veya çökme raporu **göndermez**. Geliştirici, Lipit aracılığıyla hiçbir kişisel veriye erişmez ve hiçbir kişisel veriyi saklamaz.

## 1. Bilgisayarında saklanan bilgiler

Aşağıdaki bilgiler yalnızca senin bilgisayarında, Windows kullanıcı klasörlerinde tutulur:

| Bilgi | İçerik | Konum |
|---|---|---|
| Ayarlar | Hızlı profil (kayıt klasörü, kalite, klip süresi, kesim yöntemi), uyumluluk seçenekleri, kullanım koşulları onayı | `%APPDATA%\com.lipit.capture\settings.json` |
| İndirme geçmişi | Dosya adı, dosyanın bilgisayardaki yolu, kaynak alan adı, boyut, tarih, klip aralığı (en fazla 200 kayıt). Tam video bağlantısı saklanmaz. | `%APPDATA%\com.lipit.capture\history.json` |
| Tarayıcıdan gelen istekler | Uzantıdan gelen ve henüz işlenmemiş medya adayları; işlendikten sonra silinir, işlenmezse en geç 7 gün sonra temizlenir | `%APPDATA%\com.lipit.capture\native-messaging\inbox` |
| Geçici iş dosyaları | İndirme ve dönüştürme sırasında oluşan ara dosyalar; işlem bitince ve uygulama açılışında silinir | `%LOCALAPPDATA%\com.lipit.capture` |
| Güncellenen medya motoru | Kullanıcının başlattığı motor güncellemesi sonrası dosyalar | `%LOCALAPPDATA%\com.lipit.capture\engines` |
| Geçmiş küçük resimleri | Tamamlanan dosyalardan üretilen küçük JPEG görseller; geçmiş temizlenince silinir | `%LOCALAPPDATA%\com.lipit.capture\thumbnails` |
| Klip önizleme kareleri | Klip aralığı seçilirken üretilen geçici kareler; uygulama açılışında silinir | `%LOCALAPPDATA%\com.lipit.capture` (önbellek) |
| Yerel istatistikler | Tamamlanan, başarısız ve iptal edilen iş sayıları, hata kodları ve kaynak alan adları; yalnız Ayarlar'da gösterilir, sıfırlanabilir | `%LOCALAPPDATA%\com.lipit.capture\stats.json` |
| Günlük dosyası | Tanılama için olay kayıtları. Adresler yalnızca alan adı olarak yazılır, kullanıcı klasörü `%USERPROFILE%` olarak maskelenir. En fazla 5 × 1 MB tutulur. | `%LOCALAPPDATA%\com.lipit.capture\logs` |
| Uzantı bağlantı kaydı | Uzantının son bağlandığı zaman ve sürüm numarası | `%APPDATA%\com.lipit.capture\native-messaging` |

**Geçmişi temizlemek** kayıtları siler, indirilen medya dosyalarını silmez. Lipit kaldırıldığında ayarların ve geçmişin korunur; bunları tamamen silmek için yukarıdaki klasörleri silebilirsin.

## 2. Tarayıcı uzantısı

- Uzantı, açık sekmelerdeki video öğelerini ve medya isteklerinin adres/tür bilgisini, yalnızca seçtiğin videoyu doğru belirleyebilmek için gözlemler.
- Bu bilgiler tarayıcının oturum belleğinde, sekme başına sınırlı sayıda ve en fazla 30 dakika tutulur; sekme veya tarayıcı kapanınca silinir.
- Uzantı çerezleri, yetkilendirme başlıklarını, form verilerini veya sayfa içeriğini **toplamaz**. Ağ isteklerini değiştirmez veya engellemez.
- Uzantı kurulduğunda veya tarayıcı açıldığında, bağlantı durumunu gösterebilmek için bilgisayarındaki Lipit'e yalnızca kendi sürüm numarasını iletir.
- Uzantı, bir medya adayını yalnızca video üzerindeki bir Lipit düğmesine bastığında ve yalnızca bilgisayarındaki Lipit uygulamasına gönderir. Bu aday; sayfa ve medya adresini, sayfa başlığını, video süresini ve oynatma anını, tarayıcının kullanıcı aracısı bilgisini içerir.
- Video araçlarını gizleme tercihin tarayıcının yerel deposunda saklanır.

## 3. Ağ bağlantıları

Lipit yalnızca sen bir işlem başlattığında internete bağlanır:

- **Video çözümleme ve indirme:** Bağlantısını verdiğin sitenin sunucularına, uyumluluk için gereken en az istek bilgisiyle (yönlendiren sayfa, köken, kullanıcı aracısı) bağlanılır.
- **Motor güncellemesi:** Yalnızca "güncelle" seçeneğini onayladığında, ilgili açık kaynak aracın resmi sürüm kaynağına bağlanılır.
- **Güncelleme denetimi:** Ayarlar'daki "Güncellemeleri denetle" açıkken, günde en fazla bir kez Lipit'in ve yt-dlp'nin herkese açık yayın sayfasından yalnızca en son sürüm numarası okunur. Bu istekte kimlik, çerez veya kullanım bilgisi gönderilmez. Seçenek kapatılabilir; onayın olmadan hiçbir şey indirilmez.
- **İsteğe bağlı uyumluluk bileşenleri:** Ayarlarda açıkça etkinleştirirsen ilgili bileşen resmi kaynağından alınır. Varsayılan olarak kapalıdır.

Video kapak görselleri, ilgili sitenin sunucusundan doğrudan yüklenir; bu sırada site, standart web isteklerinde olduğu gibi IP adresini görebilir.

## 4. Tarayıcı çerezleri seçeneği

"Tarayıcı çerezlerini kullan" seçeneği varsayılan olarak kapalıdır. Etkinleştirirsen, seçtiğin tarayıcının bilgisayarındaki oturum bilgileri yalnızca istenen işlem sırasında yerel medya aracı tarafından okunur. Çerezler uzantıya kopyalanmaz, Lipit geçmişine yazılmaz ve geliştiriciye gönderilmez.

## 5. Tanılama bilgisi

Ayarlardaki "Tanılamayı kopyala" seçeneği; Lipit ve motor sürümlerini, uyumluluk ayarlarını ve son işlemlerin durum/hata kodlarını panoya kopyalar. Video bağlantıları ve dosya yolları dahil edilmez. Bu bilgi yalnızca sen bir yere yapıştırırsan paylaşılır.

## 6. Kişisel verilerin korunması

Lipit'in geliştiricisi, Lipit aracılığıyla kişisel veri toplamadığı, almadığı ve işlemediği için bu bilgiler bakımından veri sorumlusu konumunda değildir. Bilgisayarındaki tüm veriler senin denetimindedir; istediğin zaman görüntüleyebilir, değiştirebilir veya silebilirsin.

## 7. Çocuklar

Lipit çocuklara yönelik değildir ve yaşa göre farklı veri işlemez. Reşit olmayan kullanıcıların Lipit'i ebeveyn veya vasi gözetiminde kullanması önerilir.

## 8. Değişiklikler

Bu bildirim yeni sürümlerle güncellenebilir. Güncel metin Lipit ile birlikte dağıtılır ve proje deposunda yayımlanır.
