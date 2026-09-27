# Windows x64 sidecar araçları

`scripts/prepare-binaries.mjs` şu paketleri indirir ve hash doğrular:

| Araç | Sürüm | Kaynak |
| --- | --- | --- |
| yt-dlp | 2026.08.19 | [yt-dlp sürümleri](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19) |
| FFmpeg / FFprobe | 9.0.2 essentials | [gyan.dev Windows yapıları](https://www.gyan.dev/ffmpeg/builds/) |
| Deno | 2.9.7 | [Deno sürümleri](https://github.com/denoland/deno/releases/tag/v2.9.7) |

FFmpeg essentials yapısı GPL lisanslıdır. Uygulama dağıtılmadan önce FFmpeg ve yt-dlp lisans bildirimleri ile kaynak sunma yükümlülükleri ayrıca tamamlanmalıdır. Bu dosyalar çalışma alanında bulunur, ancak `.gitignore` içinde tutulur; depodan yeniden üretmek için hazırlama betiğini kullanın.

Tauri `externalBin` dosyaları `apps/desktop/src-tauri/binaries/` içinde hedef Rust triple ile adlandırılır. Geliştirme sırasında yt-dlp'nin FFmpeg ve Deno'yu bulabilmesi için aynı klasöre düz isimli kopyalar da yazılır. Uygulamanın kendisi yalnızca isimleri sabitlenmiş bu sidecar programlarını Rust katmanından argüman dizileriyle çalıştırır.
