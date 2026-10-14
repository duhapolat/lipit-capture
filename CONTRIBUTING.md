# Katkı rehberi

Katkın için teşekkürler. Lipit küçük ve odaklı kalmayı hedefler; önce [ürün vizyonu ve kapsam dışı listesine](docs/urun-vizyonu.md) göz at.

## Geliştirme ortamı

1. [Tauri Windows ön koşulları](https://v2.tauri.app/start/prerequisites/): Rust, Microsoft C++ Build Tools, WebView2.
2. `node scripts/prepare-binaries.mjs`: medya motorlarını sabit sürüm ve SHA-256 doğrulamasıyla indirir.
3. `npm install --prefix apps/desktop`
4. `npm run dev`

Arayüzü Tauri olmadan, örnek verilerle görmek için `npm --prefix apps/desktop run dev` çalıştır ve `http://localhost:1420/?design-preview` adresini aç.

## Değişiklik göndermeden önce

```
npm run check:beta
```

Bu komut güvenlik değişmezlerini, bağımlılık denetimini, Rust testlerini, sıkı Clippy taramasını, uzantı testlerini, ön yüz birim testlerini ve arayüz derlemesini çalıştırır. Aynı kontroller her push ve pull request'te CI'da da çalışır.

## Kurallar

- Kullanıcıya görünen metinler Türkçe olmalı ve hiçbir platform, kişi veya marka adı içermemeli.
- Yeni bir Rust komutu ön yüzden gelen her girdiyi doğrulamalı. Dosya yolları yalnızca Lipit'in kendi ürettiği kayıtlardan alınmalı.
- Medya motorları yalnızca `binary.rs` üzerinden ve argüman dizisiyle çalıştırılmalı.
- `env!("CARGO_MANIFEST_DIR")` yalnızca `#[cfg(debug_assertions)]` veya `#[cfg(test)]` altında kullanılabilir.
- Testler ve örnekler yalnızca açık lisanslı veya sahibi olduğun medyayı kullanmalı (bkz. `scripts/test-media-source.mjs`).
- Kullanıcıyı etkileyen her değişikliği `CHANGELOG.md` dosyasının `[Yayımlanmamış]` başlığına ekle.
- Mimariyi etkileyen kararları [docs/architecture.md](docs/architecture.md) içine yeni bir ADR olarak yaz.

## Güvenlik açıkları

Lütfen herkese açık issue açma; [SECURITY.md](SECURITY.md) dosyasındaki özel bildirim yolunu kullan.
