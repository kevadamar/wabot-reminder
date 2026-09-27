# Parsing Task Bahasa Indonesia: Parser Deterministik, Gemini, atau SLM Lokal?

**Keputusan:** jangan menambahkan Small Language Model (SLM) self-hosted ke jalur production saat ini. Perbaiki gate routing, pertahankan parsing deterministik untuk ekspresi dengan confidence tinggi, dan kirim kandidat task yang ambigu ke Gemini menggunakan structured output berbasis schema. Pertahankan Antigravity hanya sebagai fallback ketika layanan utama gagal dan setelah kualitas serta latensinya diukur. SLM lokal yang telah di-fine-tune dapat dievaluasi kemudian jika privasi atau operasi offline menjadi kebutuhan wajib.

## Mengapa pesan saat ini tidak diproses

Masalah ini merupakan kegagalan routing, bukan bukti bahwa model besar yang digunakan tidak akurat. Pesan langsung ditolak sebelum mencapai Gemini atau Antigravity apabila tidak mengandung kata kerja yang terdaftar maupun keyword waktu yang cocok. Gate waktu saat ini hanya mengenali `jam` jika langsung diikuti angka. Karena itu, `jam set 5` tidak cocok. Kata `mandi`, `push up`, dan `siap siap` juga belum terdaftar dalam daftar kata kerja ([gate saat ini](../../src/services/nlp.ts#L20-L22), [early return](../../src/services/nlp.ts#L225-L250)). Penambahan `Hari ini` membuat pesan kedua lolos dan diteruskan ke model.

Parser lokal juga belum memiliki normalisasi untuk `set/setengah <jam>` dan meneruskan teks yang sudah dinormalisasi ke `chrono.en` ([normalizer](../../src/services/nlp.ts#L41-L113), [parser lokal](../../src/services/nlp.ts#L117-L127)). Chrono menyediakan beberapa locale, tetapi tidak menyediakan Bahasa Indonesia; Chrono mendukung reference instant dan timezone eksplisit ([konfigurasi Chrono](https://github.com/wanasit/chrono/blob/master/_autodocs/CONFIGURATION.md)). Normalisasi Bahasa Indonesia tetap menjadi tanggung jawab aplikasi.

## Fakta dan batasan yang sudah diverifikasi

- Target deployment yang disetujui adalah Bun pada **1 vCPU dan RAM 512 MB–1 GB** ([PRD](../PRD-to-do-bot-reminder.md#L10-L20)).
- Implementasi production sekarang menggunakan urutan **Gemini → Antigravity bridge → regex/Chrono lokal**, dengan timeout Gemini 3 detik dan bridge 25 detik ([implementasi](../../src/services/nlp.ts#L265-L320)). Model default yang dikonfigurasi adalah `gemini-3.8-flash` ([konfigurasi](../../src/config/index.ts#L1-L10)).
- Gemini mendukung structured output dengan subset JSON Schema. Google tetap mewajibkan validasi semantik pada aplikasi karena output yang sesuai schema belum tentu memiliki nilai yang benar ([panduan structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)).
- Gemini 3.5 Flash-Lite ditujukan untuk ekstraksi sederhana dengan volume tinggi, biaya rendah, dan latensi rendah. Gemini 3.8 Flash ditujukan untuk workflow yang lebih kompleks ([Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/latest-model)). Model mana yang lebih akurat untuk dataset Bahasa Indonesia milik bot ini harus dibuktikan melalui evaluasi lokal.
- `llama.cpp` dapat menjalankan model terkuantisasi pada CPU, menyediakan HTTP API, dan membatasi output menggunakan JSON Schema ([dokumentasi server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)). SLM lokal secara teknis dapat dijalankan sebagai service terpisah yang dipanggil dari Bun.
- FunctionGemma adalah model 270 juta parameter yang dirancang sebagai fondasi untuk function calling lokal dan perlu di-fine-tune untuk task spesifik. Model ini tidak ditujukan sebagai model dialog langsung ([model card](https://ai.google.dev/gemma/docs/functiongemma/model_card)).
- Pengujian resmi FunctionGemma pada perangkat menggunakan model int8 berukuran 288 MB dan mencatat sekitar 551 MB peak RSS. Angka tersebut bukan benchmark VPS, tetapi menunjukkan bahwa inference model saja dapat menghabiskan seluruh anggaran RAM deployment 512 MB ([model card yang sama](https://ai.google.dev/gemma/docs/functiongemma/model_card)).
- Perlakuan data Gemini bergantung pada service tier. Input dan output layanan gratis dapat digunakan untuk meningkatkan produk dan dapat ditinjau manusia. Prompt dan response paid service tidak digunakan untuk meningkatkan produk, walaupun logging terbatas tetap dapat berlaku ([Gemini API Terms](https://ai.google.dev/gemini-api/terms), [panduan zero data retention](https://ai.google.dev/gemini-api/docs/zdr)). Parser atau SLM lokal menjaga isi pesan tetap berada pada infrastruktur yang dikendalikan operator.

## Perbandingan opsi

Penilaian berikut merupakan rekomendasi dan inferensi untuk repository ini, bukan benchmark vendor.

| Opsi | Perkiraan akurasi | Latensi | Biaya | Operasional | Privasi | Risiko utama |
|---|---|---|---|---|---|---|
| Parser deterministik yang diperluas | Sangat tinggi untuk pola yang didukung, tetapi recall rendah untuk slang baru | Paling rendah dan stabil | Tanpa biaya model per request | Paling sederhana | Lokal | Slang baru, ekspresi ambigu, regex semakin kompleks |
| Gemini untuk semua pesan | Kandidat zero-shot terbaik, tetapi tetap perlu evaluasi | Bergantung jaringan dan model | Terpapar biaya token dan quota | Operasional aplikasi ringan | Pesan keluar dari host | Quota, timeout, layanan gagal, halusinasi semantik, false positive chat |
| **Hybrid deterministik + Gemini** | Perkiraan keseimbangan terbaik: aturan tepat untuk perhitungan waktu dan model untuk bahasa ambigu | Cepat untuk pola umum; jaringan hanya saat diperlukan | Lebih hemat daripada semua pesan ke AI | Sedang | Campuran | Aturan routing yang salah masih dapat melewatkan task |
| Antigravity CLI | Belum diketahui sebelum diukur karena model dan konfigurasi efektif berada di luar service | Berpotensi lama; aplikasi mengizinkan 25 detik | Bergantung layanan CLI host | Membutuhkan bridge dan proses host | Bergantung provider CLI | Bridge mati, timeout, model drift, output prose atau JSON tidak valid |
| SLM umum self-hosted | Akurasi zero-shot belum diketahui dan mungkin memerlukan fine-tuning | Bergantung CPU dan beban | Tanpa biaya API, tetapi memakai resource VPS | Paling kompleks | Lokal | OOM, contention, inference lambat, output salah, upgrade runtime/model |
| FunctionGemma 270M yang di-fine-tune | Layak untuk intent dan function extraction yang sempit; akurasi deadline Bahasa Indonesia belum terbukti | Harus diuji di VPS target | Biaya training dan compute lokal | Tinggi: dataset, tuning, kuantisasi, serving, monitoring | Lokal | Bias dataset, accuracy drift, RAM sempit, kebutuhan retraining |

## Arsitektur routing yang direkomendasikan

1. **Pertahankan command eksplisit secara deterministik.** `/todo` dan forwarded message tetap menjadi kandidat task pasti. Sapaan pendek tetap dianggap bukan task.
2. **Ganti rejection gate saat ini dengan candidate detector ber-recall tinggi.** Kenali kata kerja task dan bentuk waktu Indonesia seperti `jam set/setengah 5`, nama hari, tanggal, durasi relatif, dan format jam mandiri. Match yang lemah atau tidak dikenal harus menjadi `uncertain`, bukan langsung `isTask: false`.
3. **Parse ekspresi waktu yang pasti secara lokal terlebih dahulu.** Contohnya, normalisasikan `setengah 5 sore` menjadi 16:30 pada timezone pengguna. `set 5` adalah singkatan yang perlu aturan produk atau pertanyaan klarifikasi; jangan membuat deadline secara diam-diam jika masih ambigu.
4. **Kirim kandidat ambigu ke Gemini.** Gunakan prompt singkat yang ada bersama structured output pada level API untuk `isTask`, `taskTitle`, `deadline`, `needsDeadline`, serta field ambiguity atau reason. Sebelum menyimpan ke database, validasi tanggal, title, dan konversi UTC terhadap timezone pengguna.
5. **Gunakan Antigravity hanya ketika Gemini gagal**, jika hasil evaluasinya mencapai ambang kualitas yang sama dan latensi lebih panjang masih dapat diterima. Jika tidak, langsung gunakan parser lokal atau minta klarifikasi.
6. **Fail safe.** Jika semua jalur masih tidak yakin, pertahankan pesan sebagai kandidat task tanpa deadline atau minta konfirmasi. Jangan membuang pesan secara diam-diam.

Desain ini menyelesaikan kasus yang dilaporkan tanpa membayar latensi model untuk ekspresi yang sudah dapat diproses secara deterministik. Desain ini juga mencegah gate awal menyembunyikan input dari kedua provider AI.

## Keputusan model dan runtime

### Production sekarang

- Pertahankan Gemini sebagai ambiguity resolver.
- Gunakan JSON Schema pada level API dan lakukan validasi semantik dalam aplikasi.
- Evaluasikan `gemini-3.5-flash-lite` terhadap `gemini-3.8-flash` yang digunakan saat ini menggunakan dataset yang sama sebelum mengganti model.
- Pertahankan Chrono sebagai engine tanggal Bahasa Inggris di belakang layer normalisasi Bahasa Indonesia.
- Pertahankan Antigravity sebagai opsi resilience, bukan jalur utama, sampai model efektif, perlakuan data, quota, p95 latency, dan akurasi task-nya diketahui.

### Proof of concept SLM jika requirement berubah

Eksperimen SLM baru layak dimulai jika operasi offline, data locality, atau independensi dari API menjadi requirement wajib. Kandidat konkret paling defensible adalah **FunctionGemma 270M** yang di-fine-tune untuk menghasilkan schema sempit seperti `create_task` atau `not_task`, lalu dijalankan terpisah dari Bun menggunakan runtime dengan constrained output. Google memang merancang model tersebut untuk fine-tuning task-specific dan function calling lokal ([overview](https://ai.google.dev/gemma/docs/functiongemma), [panduan fine-tuning](https://ai.google.dev/gemma/docs/functiongemma/finetuning-with-functiongemma)).

Jangan menjalankan eksperimen tersebut bersama aplikasi production pada container 512 MB. Pengujian perangkat dari vendor mencatat sekitar 551 MB peak model RSS sebelum memperhitungkan Bun, Baileys, database client, dan overhead sistem operasi. Host 1 GB juga masih berpotensi sempit; penerimaan harus berdasarkan pengukuran pada VPS target di bawah beban bot yang sebenarnya.

## Rencana evaluasi sebelum menentukan implementasi

Buat gold dataset yang memiliki versi dan sudah dihapus identitas pribadinya. Mulai dengan sedikitnya **300 pesan** agar setiap kategori penting memiliki cukup contoh untuk diagnosis. Angka ini merupakan rekomendasi proyek, bukan jaminan statistik.

Kategori yang disarankan:

- task dengan tanggal dan jam eksplisit;
- waktu colloquial: `set/setengah`, `jam 5-an`, `abis maghrib`, `nanti`, singkatan, dan typo;
- task tanpa deadline;
- percakapan biasa yang mengandung kata waktu tetapi bukan task;
- kalimat task tanpa kata kerja yang dikenal;
- kasus timezone dan pergantian hari untuk WIB, WITA, dan WIT;
- tanggal lampau, tanggal mustahil, beberapa waktu dalam satu pesan, dan forwarded message;
- teks adversarial yang mengandung kurung kurawal, instruksi, atau quoted JSON.

Setiap record sebaiknya memuat input text, reference instant, timezone, expected intent, cleaned title, expected deadline atau interval yang masih dapat diterima, ambiguity label, dan apakah klarifikasi diperlukan. Pisahkan train dan test berdasarkan pola kalimat atau sumber percakapan, bukan pembagian acak terhadap contoh yang hampir sama, untuk mengurangi kebocoran data jika SLM di-fine-tune.

Ukur setiap kandidat secara end-to-end:

| Metrik | Definisi |
|---|---|
| Precision, recall, dan F1 task | Klasifikasi intent, dengan recall direct dan forwarded message dilaporkan terpisah |
| Akurasi deadline exact | UTC instant tepat setelah konversi timezone |
| Akurasi deadline dengan toleransi | Waktu berada dalam toleransi yang telah ditentukan untuk ekspresi fuzzy |
| Kecocokan title | Bagian waktu dihapus tanpa membuang isi task |
| Akurasi klarifikasi | Input ambigu meminta konfirmasi dan tidak mengarang waktu |
| Invalid output rate | Kegagalan parsing, schema, atau validasi semantik |
| Latensi end-to-end p50/p95 | Dari pesan diterima sampai hasil parsing tervalidasi |
| Availability dan fallback rate | Persentase yang membutuhkan tier berikutnya, termasuk timeout dan quota |
| Resource headroom | Peak RSS dan CPU ketika WhatsApp dan parser aktif bersamaan |

Kriteria rilis harus ditentukan sebelum bake-off. Proposal awal yang masuk akal: tidak ada regresi pada kasus deterministik saat ini, seluruh fixture timezone dan pergantian hari yang berbahaya harus lolos, serta task recall meningkat secara berarti tanpa kenaikan false positive chat yang tidak dapat diterima. Nilai threshold final harus ditentukan berdasarkan baseline production.

## Risiko dan pertanyaan terbuka

- Repository belum memiliki dataset atau confusion matrix production. Belum ada model yang dapat secara jujur disebut paling akurat untuk kasus ini.
- `set 5` mungkin berarti `setengah 5` bagi pengguna ini, tetapi produk perlu aturan eksplisit atau mekanisme klarifikasi sebelum menjadikannya aturan global.
- Model, data handling, quota, dan lifecycle Antigravity bridge belum ditentukan dalam repository.
- Model ID dan service terms dapat berubah. Pin versi model yang stabil, catat model efektif, dan jalankan ulang evaluation set sebelum upgrade.
- SLM yang di-fine-tune menambah lifecycle model: data berlabel, training environment, artifact dan license tracking, quantization, rollout, rollback, serta drift monitoring.

## Rekomendasi akhir

Implementasikan dan evaluasi perubahan routing **hybrid deterministik + Gemini** terlebih dahulu. Pendekatan ini langsung mengatasi false negative yang ditemukan, sesuai dengan deployment 1 vCPU/512 MB–1 GB, mempertahankan fallback offline, dan hanya memakai Gemini ketika ambiguitas bahasa membutuhkannya.

Jangan menambahkan SLM ke production sampai gold dataset menunjukkan gap terukur yang tidak dapat diselesaikan oleh parsing deterministik plus Gemini, atau sampai requirement local-only, privasi, atau offline membenarkan tambahan kompleksitas infrastrukturnya.
