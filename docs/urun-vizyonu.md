# Ürün vizyonu, kapsam ve ölçütler

## Değer önerisi

> **Lipit, tarayıcıda izlediğin videonun tam o anını iki tıkla bilgisayarına MP4 klip olarak kaydeden; reklamsız, hesapsız ve tamamen yerel çalışan kişisel arşiv aracıdır.**

Lipit; kendi videoların, açık lisanslı içerikler ve hak sahibinin indirmene izin verdiği videolar içindir.

## Yapmadıklarımız (kapsam dışı)

- DRM veya benzeri koruma önlemlerini aşmak.
- Oynatma listesi, kanal veya toplu indirme.
- İçerik barındırmak, paylaşmak veya bir sunucuya yüklemek.
- Zaman çizelgeli tam video düzenleyici.
- Reklam, hesap, ücretli sürüm veya varsayılan olarak açık telemetri.

## Kullanıcı varsayımları (doğrulanacak)

| Persona | İhtiyaç | Lipit'te karşılığı | Doğrulama sorusu |
|---|---|---|---|
| Kendi içeriğini arşivleyen üretici | Kendi yayınlarından yüksek kaliteli kesit | Hassas kesim, kalite seçimi, dosya adı şablonu | Haftada kaç klip? Hangi kalite? |
| Kısa an paylaşan izleyici | Hızlı, küçük, kolay | Hızlı klip, sabit klasör | Hızlı klip ile ana pencere kullanım oranı |
| Araştırmacı / arşivci | Kaynak ve tarih bilgisiyle düzenli arşiv | Geçmiş, arama, kaynak + tarih şablonu | Geçmişte arama kullanılıyor mu? |

### Araştırma planı
1. 5–8 beta kullanıcısıyla 30 dakikalık görüşme yap. Soruları: hangi işi yaptılar, nerede zorlandılar, neyi beklediler.
2. Bir hafta boyunca yerel istatistik ekranının ekran görüntüsünü gönüllü olarak topla. Bunlar sayısal veridir; URL içermez.
3. GitHub Discussions'ta kısa bir anket aç.

## Başarı ölçütleri

| Ölçüt | Tanım | Hedef | Kaynak |
|---|---|---|---|
| Hızlı işlem güvenilirliği | Başlatılan hızlı işlemlerden işe dönüşenler | ≥ %95 | Ayarlar › Yerel istatistikler |
| İş başarı oranı | Tamamlanan / (tamamlanan + başarısız) | ≥ %90 | Yerel istatistikler |
| Kurulumdan ilk işe | Uzantı kurulumu dahil | ≤ 5 dk | Kullanıcı testi |
| Zamana-kadar-klip | Tarayıcıda tıklama → 30 sn klip hazır | ≤ 20 sn | Elle ölçüm |
| Genel hata payı | `NO_MEDIA_FOUND` payı | Azalan eğilim | Yerel istatistikler |

## Rakiplerden ayrışma (gözlem)

- Masaüstü indirme araçlarının çoğu bağlantı yapıştırarak çalışır. Lipit ise videonun **o anki zamanından** klip alır.
- Çevrim içi dönüştürücü sitelerde reklam, izleme ve kötü amaçlı yazılım riski vardır. Lipit yerel çalışır ve açık kaynaklıdır.
- Arayüz Türkçedir; yerel kullanıcı için daha kolaydır.

## Sürdürülebilirlik

Lipit ücretsiz ve açık kaynaklıdır. Ticari bir model hedeflenmiyor. Bakım yükü [CONTRIBUTING.md](../CONTRIBUTING.md) ile topluluğa açılır. Bağış kanalı ileride eklenebilir, ancak ücretli özellik eklenmez.
