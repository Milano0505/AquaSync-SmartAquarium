# AGENTS.md: Smart Aquarium Control

Konteks proyek untuk agen AI (Claude Code, GitHub Copilot, Antigravity, dll). Baca ini dulu sebelum mengubah kode.
File ini **tidak masuk git** (ada di `.gitignore`). Pemilik: Milano. Percakapan memakai **bahasa Indonesia**.

## 1. Apa proyek ini

Sistem IoT akuarium, sekaligus tugas kuliah IoT/embedded.

* **ESP32** membaca suhu air (DS18B20), mengontrol relay heater dan lampu, membunyikan buzzer saat ada masalah.
* **Backend** Node.js/Express menyimpan semuanya di **Supabase PostgreSQL**.
* **Dashboard** React dipakai pengguna untuk memantau dan mengatur.

Status: fitur inti lengkap. **Belum pernah diuji end-to-end di perangkat keras dan browser** setelah migrasi ke Supabase.

## 2. Aturan yang tidak boleh dilanggar

1. **Semua akses data lewat backend.** Frontend dan ESP32 tidak boleh menyentuh database. Frontend hanya memakai Supabase Auth untuk login, lalu memanggil backend dengan JWT.
2. **Jangan menambah `GRANT` atau policy RLS.** RLS aktif tanpa policy, hak `anon` dan `authenticated` dicabut, Data API Supabase dimatikan. Jawaban `503 PGRST002` dari `/rest/v1` itu **normal**.
3. **Tidak ada push real-time.** Pemilik menolak SSE dan WebSocket. Dashboard memakai polling, ESP32 memakai *long polling*. Jangan menambah SSE/WebSocket kecuali diminta.
4. **Keselamatan heater diputuskan di ESP32**, bukan di server. Heater dipaksa mati jika sensor gagal atau suhu ≥ 36 °C, di mode apa pun. Jangan pindahkan keputusan ini ke backend.
5. **Kontrak yang dikunci** (firmware yang sudah ter-flash bergantung padanya): nama endpoint, key JSON, kolom database, nama env var, namespace NVS (`aquarium`/`config`), key localStorage. Jangan diubah sembarangan.
6. **Perubahan skema = file migrasi baru** (`npx supabase migration new <nama>`). Jangan edit migrasi lama.
7. **Rahasia jangan di-commit atau ditempel di mana pun:** `backend/.env`, `frontend/.env`, `device/include/secrets.h`, device key, password Wi-Fi/database, anon key.

## 3. Arsitektur

```text
 [ESP32] ── HTTP + header x-device-key ──► [Backend Express] ──SQL (pg, pooler)──► [Supabase PostgreSQL]
                                                  ▲
                                                  │ REST + Authorization: Bearer <JWT Supabase>
                                           [Frontend React] ──login──► [Supabase Auth]
```

| Komponen | Teknologi |
| --- | --- |
| Device | ESP32, PlatformIO + Arduino, DS18B20, 2 relay, buzzer. Satu file: `device/src/main.cpp` (±700 baris) |
| Backend | Node.js (ESM), Express 5, `pg`. Port bawaan **3000** kalau `PORT` kosong |
| Database | Supabase PostgreSQL, 9 tabel |
| Frontend | React 19, Vite, Tailwind 4, React Router 7, pnpm |

Tabel: `profiles`, `aquariums`, `aquarium_members`, `devices`, `device_state` (status realtime, 1 baris/akuarium), `telemetry_history`, `lighting_usage`, `notifications`, `notification_states`.

## 4. Peta repo

```text
backend/
  index.js                 titik masuk, mount /api/auth|users|admin|aquariums|hardware
  routes/                  auth, users, admin, aquariums, hardware
  middleware/auth.js       requireUserAuth, requireDeviceKey, requireDeviceOwnsAquarium
  config/                  database.js, aquarium-repository.js, default-aquarium.js
  utils/                   access-roles, config-change-events (long poll), config-validation,
                           device-watchdog, telemetry-changes, notification-records,
                           http-errors, profile-photo-validation, ttl-cache
  supabase/migrations/     5 file SQL (init, viewer_monitoring, one_device_per_aquarium,
                           telemetry_changes, function_search_path)
  tests/                   di-.gitignore, jalankan: npm test
frontend/src/
  pages/                   Dashboard, DataHistory, Notifications, Configuration, Access, Login, Register
  components/ context/ hooks/ utils/
  api/backendApi.js        semua panggilan ke backend
  supabaseAuth.js          klien Supabase Auth (login saja)
device/
  src/main.cpp             seluruh firmware
  include/secrets.example.h   template, salin jadi secrets.h
docs/code-reference.md     ±5.900 baris: tiap file, fungsi, dan query SQL dijelaskan
```

**Cara tercepat memahami kode:** buka `docs/code-reference.md` dan cari nama fungsinya (Ctrl+F). Nomor barisnya bisa bergeser kalau kode berubah. Delapan file lain di `docs/*/` sengaja **masih kosong** (placeholder), jangan dianggap hilang.

## 5. Cara kerja inti

### Siapa bertanya kepada siapa

| Aliran | Detail |
| --- | --- |
| Baca sensor | ESP32, tiap 5 detik (`TEMP_READ_INTERVAL_MS`), tanpa blocking |
| Config dari dashboard | ESP32 → backend, **long polling** `GET /config?wait=20&v=<versi>` (backend menahan sampai config berubah atau 20 detik) |
| Telemetri | ESP32 → backend tiap `pollFrequency` (1–60 detik, **default 30**), dan segera bila status heater, lampu, atau alarm berubah |
| Antrean offline | `POST /telemetry/backlog`, 20 data per request |
| Dashboard | Browser → backend tiap `pollFrequency`; tiap 2,5 detik (maks 90 detik) saat ada perintah perangkat yang menunggu |

`pollFrequency` (label UI: "Data Send Interval") **tidak** memengaruhi kecepatan reaksi heater.

### Firmware (`device/src/main.cpp`)

* `loop()` di **core 1**: sensor → heater → jadwal lampu → alarm. Didaftarkan ke Task Watchdog.
* `telemetryTask` dan `configLongPollTask` di **core 0**: HTTP bersifat blocking, jadi dipisah supaya heater tidak ikut tertahan.
* **Circular buffer** `backlogQueue` (120 data, hanya di RAM) menampung telemetri saat offline. Ada `backlogHeadIndex` dan `backlogSize`. Saat penuh, data tertua ditimpa. Batch dibebaskan hanya setelah backend menjawab.
* Heater otomatis: nyala di bawah `targetTemp − 0,5`, mati di atas `targetTemp + 0,5`.
* Saat boot, relay dimatikan dulu, lalu config terakhir dipulihkan dari flash (NVS).
* Pin: DS18B20 **GPIO 4**, relay heater **GPIO 18**, relay lampu **GPIO 19**, buzzer **GPIO 5**. Relay **aktif LOW**. Tidak ada RTC, waktu dari NTP.
* **Feeder belum ada di firmware.** Backend dan dashboard sudah punya jadwal dan *Feed Now*, tetapi firmware hanya mengirim `feederStatus: "Idle"` (stub).

### Autentikasi dan peran

* **Pengguna:** Supabase Auth → JWT → `Authorization: Bearer`. Backend memverifikasi dengan `getClaims()` (cache 30 detik).
* **Perangkat:** device key acak 32 byte di header `x-device-key`. Database hanya menyimpan **hash SHA-256**. Key hanya valid untuk akuarium miliknya. Key **hanya tampil sekali** saat perangkat didaftarkan.
* **Peran:** global `admin`/`user`, plus per akuarium `owner`/`member`. Pengguna tanpa keanggotaan = **viewer**. Urutan: `viewer` < `member` < `owner` < `admin`.

| Peran | Boleh |
| --- | --- |
| admin | Semuanya: buat akuarium, tunjuk owner, daftarkan/cabut perangkat, ubah peran, atur `monitoring_public` |
| owner | Seperti member, plus tambah/hapus **member** di akuariumnya |
| member | Ubah config dan jalankan Feed Now |
| viewer | Hanya melihat akuarium yang `monitoring_public = true` |

* Penegakan ada di satu fungsi: `findAccessibleAquarium(id, authUser, minimumRole)` di `backend/config/aquarium-repository.js`.
* Pengguna baru selalu viewer. **Satu akuarium = satu perangkat.** Halaman Access hanya untuk admin dan owner. `ADMIN_EMAILS` menentukan admin pertama.

### Perilaku telemetri di backend

* Suhu valid −10 sampai 60 °C. Telemetri tanpa `currentTemp` hanya diterima kalau ada `event` (mis. sensor error).
* `measuredAt` (epoch UTC dari NTP ESP32) dipakai sebagai cap waktu. Ditolak jika selisih > 5 menit (live) atau > 7 hari (antrean).
* Riwayat dihemat: `telemetry_history` ditulis saat status berubah, suhu keluar batas, atau ±60 detik sejak riwayat terakhir. Kolom tersembunyi `changes` mencatat apa yang berubah (`heater`, `led`, `feeder`, `temp`, `system`); `temp` dihitung hanya jika bergeser ≥ 0,5 °C. Logikanya di `backend/utils/telemetry-changes.js`.
* Notifikasi otomatis: Device Offline (tidak ada telemetri > `max(60 detik, 3 × pollFrequency)`, dicek tiap 30 detik), Back Online, Sensor Error, laporan restart abnormal (`bootReason`).

## 6. Menjalankan dan memverifikasi

```powershell
cd backend;  cp .env.example .env; npm install; npm run dev   # atau npm start
cd frontend; cp .env.example .env; pnpm install; pnpm dev      # http://localhost:5173
pio run -d device                                              # compile firmware
```

| Tujuan | Perintah |
| --- | --- |
| Tes backend (PGlite, tanpa Docker) | `cd backend && npm test` |
| Build frontend | `cd frontend && pnpm build` |
| Format | `npm run format` (backend), `pnpm format` (frontend) |
| Push migrasi | `cd backend && npx supabase db push --linked` |

* Env backend: `PORT`, `FRONTEND_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL` (**Session pooler**, port 5432), `DATABASE_SSL`, `DB_POOL_MAX`, `ADMIN_EMAILS`. Env frontend: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
* `PORT` backend, `VITE_API_URL`, dan `API_BASE_URL` firmware harus cocok.
* Firmware: salin `device/include/secrets.example.h` menjadi `secrets.h` (`WIFI_SSID` 2,4 GHz, `WIFI_PASSWORD`, `API_BASE_URL` berupa IP laptop bukan `localhost`, `AQUARIUM_ID`, `DEVICE_KEY`). Serial Monitor 115200.
* Setelah mengubah kode, jalankan tes dan build yang relevan sebelum menyatakan selesai.
* IntelliSense C/C++ error di `main.cpp` biasanya karena VS Code dibuka di root repo, bukan `device/`. Itu bukan bug kode.

## 7. Konvensi kerja

* **Bahasa:** kode, nama identifier, dan pesan commit **Inggris**. Komentar kode **1–2 kata, bahasa Indonesia** (contoh: `// aktif LOW`, `// cutoff heater`). Jangan menulis komentar panjang atau kalimat: pemilik ingin hasil pencarian yang bersih.
* **Penamaan:** deskriptif dan mudah dicari (`requireUserAuth`, `HEATER_HYSTERESIS_C`).
* **Format:** Prettier, indent **4 spasi**, lebar 120, `arrowParens: avoid`.
* **Commit:** Conventional Commits, ringkasan < 72 karakter, lalu daftar poin. Contoh: `feat: add viewer role, new Access page`. Repo memakai squash merge dengan nomor PR. Pemilik biasanya meminta **satu pesan commit yang bisa disalin**; **jangan menjalankan `git commit` atau `push` kecuali diminta.**
* **CRLF/LF:** banyak file bisa tampil "modified" hanya karena akhir baris. Stage per jalur, hindari `git add -A`.
* **Markdown:** bullet `*` dengan indent 4 (`.markdownlint.jsonc`: MD007 indent 4, MD013 mati). Dokumen untuk non-engineer (seperti `code-reference.md`) ditulis dalam bahasa awam, jaga gayanya.
* **Jangan menambah fitur atau abstraksi di luar permintaan.** Proyek ini sengaja sederhana.

## 8. Yang belum selesai

1. Uji end-to-end di perangkat keras dan browser (prioritas tertinggi).
2. Feeder di firmware (servo atau relay, jadwal, pelaporan status).
3. Tes otomatis API (peran, pembatasan akuarium, validasi telemetri, long polling).
4. Isi 8 file `docs/` yang kosong.
5. `code-reference.md` perlu digenerate ulang setelah perubahan besar.

**Risiko yang diketahui:** `API_BASE_URL` memakai `http://` (device key tidak terenkripsi, aman hanya untuk LAN). Cache di memori backend (token 30 detik, peran 5 menit, device key 5 menit) membuat data bisa basi jika ada lebih dari satu instance. Antrean offline hilang saat listrik mati. Flash firmware sudah ±74 %.

## 9. Bahan bacaan lebih dalam

* `README.md`: quick start dan tabel env var.
* `docs/code-reference.md`: penjelasan rinci tiap file, fungsi, dan query SQL.
* `temp/HANDOFF.md` dan `temp/data-flow-firmware.md` (lokal, tidak di git): riwayat 12 sesi, keputusan desain, troubleshooting, dan diagram circular buffer. HANDOFF dibuat 2 Nov 2026, jadi beberapa angka sudah usang (mis. ambang offline sekarang 60 detik dan migrasi ada 5). Kalau berbeda dengan kode, **kode yang benar**.
