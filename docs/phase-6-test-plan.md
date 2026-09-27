# Lipit Capture 0.7.0 — Bir Günlük Test Planı

Bu sürüm 1.0 öncesi test adayıdır. Her sorun için site adresini, tarayıcıyı, seçilen kaliteyi, klip aralığını ve ekranda görünen hata metnini not edin. İndirilen bozuk dosyayı silmeyin; inceleme için yararlı olabilir.

## 1. Başlangıç kontrolü

- Masaüstü uygulamasını açın; üstte `PHASE 06 · RELEASE CANDIDATE` yazısını görün.
- Tarayıcı uzantısını yeniden yükleyin.
- Masaüstü uygulamasında `Ayarlar` bölümünü açıp yt-dlp, FFmpeg, FFprobe ve Deno durumlarının hazır olduğunu doğrulayın.
- Bir ayarı değiştirip uygulamayı kapatın ve yeniden açın; ayarın korunduğunu kontrol edin.

## 2. Tarayıcı ve site matrisi

Aşağıdaki her satırda bir tam video ve bir kısa klip deneyin.

| Tarayıcı | YouTube | Instagram Reels | X / Twitter | Doğrudan MP4 |
| --- | --- | --- | --- | --- |
| Chrome veya Edge | Tam + klip | Tam + klip | Tam + klip | Tam + klip |

Her denemede şunları kontrol edin:

- Doğru videonun başlığı ve süresi geliyor.
- Önerilen küçük videodaki düğme yanlışlıkla ana videoyu seçmiyor.
- Kalite seçenekleri mantıklı görünüyor; örneğin kaynak 1440p ise 1440p seçeneği sunuluyor.
- İndirme tamamlanınca dosya açılıyor, ses ve görüntü senkron kalıyor.
- Videonun ortasına ve sonuna ilerletme hızlı çalışıyor; karıncalanma veya uzun bekleme olmuyor.
- Instagram Reels süresi gerçek süreye yakın görünüyor ve 10 dakika olarak sabitlenmiyor.
- X / Twitter videosunda ses oynatma listesinin yerine doğru video seçiliyor.

## 3. Klip modları

Aynı videoda üç klip alın:

1. Başlangıçtan 5–10 saniyelik klip.
2. Videonun ortasından 10–20 saniyelik klip.
3. Son 10 saniyeyi içeren klip.

Her klipte başlangıç ve bitiş noktalarının yaklaşık doğru olduğunu, sesin ilk kareden itibaren geldiğini ve dosyada ileri sarma yapılabildiğini kontrol edin. Varsa hem hızlı hem hassas klip modunu deneyin.

## 4. Hızlı profil ve video araçları

- Ayarlardan `Her zaman sor` seçin; `Tamamını indir`, `Klip oluştur` ve tarayıcıdaki İndir/Klip yanındaki `⚡` düğmelerinin kayıt penceresi açtığını doğrulayın.
- Ayarlardan bir indirme klasörü seçip kaydedin; aynı dört işlemin soru sormadan bu klasöre başladığını doğrulayın.
- 15 sn, 30 sn, 45 sn, 60 sn, 2 dk ve 5 dk klip sürelerinin her birini deneyin.
- Videonun sonuna yakınken hızlı klip alın; bitiş zamanının video süresini aşmadığını kontrol edin.
- Video üzerindeki `×` ile araçları gizleyin; küçük Lipit simgesine basınca yeniden açıldığını doğrulayın.
- Masaüstünde `Tamamını indir` ve `Klip oluştur` düğmelerinin aynı alt işlem satırında olduğunu kontrol edin.

## 5. Geçmiş ve yerel önizleme

- En az üç indirme tamamlayın; hepsinin `İndirme geçmişi` listesinde göründüğünü kontrol edin.
- Bir geçmiş kaydındaki oynat düğmesine basın; yerel önizlemenin açıldığını doğrulayın.
- Önizlemede videonun ortasına ve sonuna ilerleyin.
- Uygulamayı kapatıp yeniden açın; geçmişin korunduğunu kontrol edin.
- İndirilen dosyalardan birini Windows Gezgini üzerinden silin; uygulamada `Dosya yok` durumunu görün.
- `Geçmişi temizle` işlemini çalıştırın; kayıtların silindiğini, indirilen video dosyalarının yerinde kaldığını doğrulayın.

## 6. Klavye kısayolları

- `Ctrl + L`: adres alanına gider ve adresi seçer.
- `Ctrl + Enter`: adresi çözümler.
- `Ctrl + 1`: tamamını indirmeyi başlatır.
- `Ctrl + 2`: klip oluşturmayı başlatır.
- `Ctrl + Shift + D`: geçerli indirmeyi başlatır.
- `?`: kısayol penceresini açar.
- `Esc`: açık pencereyi kapatır.

## 7. Uzantı düğmesi ve medya gruplama

- Video üzerindeki küçük Lipit simgesinin normalde dar kaldığını kontrol edin.
- Fareyi üstüne getirdiğinizde `İndir` ve `Klip` seçeneklerinin açıldığını doğrulayın.
- Sayfada aynı videoya ait farklı çözünürlük istekleri oluştuğunda uzantının aynı medyayı tekrar tekrar göstermediğini kontrol edin.
- Oynatıcı içinde kalite değiştirin; seçili video kimliği ve indirme hedefi değişmemeli.

## 8. Kesinti ve hata senaryoları

- İndirme sırasında interneti kısa süre kapatın; uygulamanın anlaşılır bir hata vermesini ve takılı kalmamasını kontrol edin.
- Geçersiz veya özel bir video adresi deneyin; uygulamanın kapanmadığını doğrulayın.
- `https://www.youtube.com/@BugraSisman` gibi kanal/profil bağlantısının kısa sürede açıklayıcı hata verdiğini ve arayüzün yeniden kullanılabildiğini doğrulayın.
- Bir indirmeyi iptal edin; kısmi dosya veya kilitli işlem kalıp kalmadığını kontrol edin.
- Aynı dosya adını üreten videoyu ikinci kez indirin; mevcut dosyanın üzerine sessizce yazılmamalı.

## Sorun kaydı şablonu

- Site ve video adresi:
- Tarayıcı ve sürümü:
- Tam video / klip:
- Seçilen kalite ve klip aralığı:
- Beklenen sonuç:
- Gerçek sonuç:
- Hata metni:
- Çıktı dosyasının adı:
- Ekran görüntüsü veya kısa ekran kaydı:
