# Sürüm, geri alma ve olay müdahale süreci

## Sürüm çıkarma

1. `CHANGELOG.md` dosyasındaki `[Yayımlanmamış]` başlığını `[X.Y.Z-beta.N] - YYYY-AA-GG` olarak adlandır.
2. Sürüm numarasını kök `package.json` dosyasında güncelle. Aynı numarayı `apps/desktop/package.json`, `apps/extension/package.json`, `tauri.conf.json` ve `Cargo.toml` dosyalarına da yaz (`npm run check:security` uyuşmazlığı yakalar).
3. Lipit kapalıyken `npm run check:release` çalıştır. Bu komut çevrim dışı kontrolleri, derlemeyi, köprüyü, hızlı pencereyi, gerçek çözümlemeyi ve klip hattını sırayla dener.
4. `docs/0.8-test-plan.md` ve `docs/phase-6-test-plan.md` içindeki elle yapılan testleri uygula.
5. `vX.Y.Z-beta.N` etiketini gönder. `windows-release.yml` derler, denetler, paketler ve yayın notlarını CHANGELOG'dan üreterek ön sürüm olarak yayımlar.
6. Kod imzalama etkinleştiğinde, SignPath onayı bu adımdan önce yapılır (bkz. [code-signing-policy.md](code-signing-policy.md)).

## Geri alma (bozuk sürüm)

Bir sürümde ciddi bir hata bulunursa (veri kaybı, çökme, güvenlik açığı):

1. GitHub'da ilgili sürümü **taslağa çevir** veya sil; böylece güncelleme denetimi onu artık "yeni sürüm" olarak göstermez.
2. Önceki sağlam sürümün bağlantısını, sorunun kısa açıklamasıyla birlikte bir sabitlenmiş issue'da paylaş.
3. Düzeltmeyi yeni bir yama sürümü olarak çıkar. Aynı etiketi yeniden kullanma.
4. yt-dlp güncellemesi kaynaklı bir sorunda kullanıcıya şunu söyle: `%LOCALAPPDATA%\com.lipit.capture\engines\yt-dlp.exe` silinirse uygulama paketlenmiş sürüme döner.

## Olay müdahalesi (güvenlik)

| Senaryo | İlk adım | Sonra |
|---|---|---|
| Lipit'te güvenlik açığı bildirimi | SECURITY.md'deki özel bildirim kanalından al, 72 saat içinde yanıtla | Düzelt, sürüm çıkar, bildirene teşekkür et ve CHANGELOG'da "Güvenlik" başlığıyla duyur |
| Paketlenen motorda (yt-dlp, FFmpeg, Deno) açık | Üst projenin duyurusunu doğrula | `prepare-binaries.mjs` sürüm ve özetlerini güncelle, yama sürümü çıkar |
| Sahte veya değiştirilmiş kurulum dosyası dolaşımda | README ve sürüm sayfasında yalnızca resmi indirme adresini ve SHA-256 değerlerini vurgula | İmzalı sürüme geçişi hızlandır |
| Uzantı özel anahtarının sızması | Anahtarı geçersiz say; uzantı kimliği değişeceği için yeni kimlikle sürüm çıkar ve native host `allowed_origins` değerini güncelle | Kullanıcılara yeniden kurulum talimatı ver |
| Hak sahibi bildirimi | Talebi incele; Lipit içerik barındırmadığı için ilgili içerik hizmetine yönlendir | Gerekirse hukuki danışmanlık al |

## Destek

- Hata bildirimi için GitHub issue şablonları kullanılır. Kullanıcıdan Ayarlar › "Tanılamayı kopyala" çıktısı ve gerekirse maskeli günlük dosyası (Ayarlar › "Günlük klasörünü aç") istenir.
- Sık sorulan sorular [SSS.md](SSS.md) dosyasındadır.
