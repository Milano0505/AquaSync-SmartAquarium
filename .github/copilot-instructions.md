# Instruksi untuk GitHub Copilot

Konteks lengkap proyek ini ada di [AGENTS.md](../AGENTS.md) di root repo. Baca file itu dulu sebelum menjawab atau mengubah kode.

@AGENTS.md

Ringkasan aturan terpenting:

* Frontend dan ESP32 tidak boleh menyentuh database. Semua akses data lewat backend.
* Keselamatan heater diputuskan di firmware ESP32, bukan di server.
* Jangan ubah nama endpoint, key JSON, kolom database, env var, atau namespace NVS tanpa alasan kuat.
* Kode dan pesan commit berbahasa Inggris. Komentar kode 1-2 kata bahasa Indonesia. Percakapan bahasa Indonesia.
* Jangan menjalankan `git commit` atau `git push` kecuali diminta.
