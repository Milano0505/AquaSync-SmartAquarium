# Smart Aquarium AquaSync

Sistem monitoring dan kontrol akuarium.

## System Architecture

* **Device:** ESP32 dengan sensor suhu DS18B20 dan relay heater/lampu. Berkomunikasi lewat HTTP: config diambil dengan long polling, telemetri dikirim lewat POST.
* **Backend:** Node.js / Express. Mengelola logika bisnis, autentikasi, role, dan akses database.
* **Database:** Supabase PostgreSQL. Menyimpan akun, akuarium, config, dan histori telemetri.
* **Frontend:** React + Vite + Tailwind CSS. Dashboard telemetri dan kontrol akuarium, login lewat Supabase Auth.

## Quick Start & Installation

### Prasyarat

* Node.js 22 dan pnpm (frontend)
* Proyek Supabase (atau Supabase CLI untuk database lokal)
* PlatformIO atau Arduino IDE (firmware)

### Langkah Setup

1. **Clone repository**

    ```bash
    git clone <url-repository>
    cd WebDashboard-SmartAquarium
    ```

2. **Backend & database**

    ```bash
    cd backend
    cp .env.example .env
    npm install
    npm run dev
    ```

    Migrasi database ada di `backend/supabase/migrations`.

3. **Frontend**

    ```bash
    cd frontend
    cp .env.example .env
    pnpm install
    pnpm dev
    ```

4. **Flash device**

    * Buka folder `device` di PlatformIO.
    * Salin `device/include/secrets.example.h` menjadi `secrets.h`, lalu isi Wi-Fi, URL backend, ID akuarium, dan device key.
    * Upload firmware ke ESP32.

## Detail Dokumentasi

* [Arsitektur & Alur Data](docs/architecture/system-overview.md)
* [Alur Data Telemetri & Kontrol](docs/architecture/data-flow.md)
* [Spesifikasi Hardware & Pinout](docs/device/hardware-spec.md)
* [Setup Firmware](docs/device/firmware-setup.md)
* [API Reference](docs/backend/api-reference.md)
* [Skema Database](docs/backend/database-schema.md)
* [Panduan UI/UX](docs/frontend/ui-ux-guide.md)
* [Deployment Frontend](docs/frontend/deployment.md)
* [Code Reference](docs/code-reference.md)

## Environment Variables

| Variable | Description | Component | Example |
| --- | --- | --- | --- |
| `PORT` | Port server Backend | Backend | `5000` |
| `FRONTEND_ORIGIN` | Origin frontend yang diizinkan (CORS) | Backend | `http://localhost:5173` |
| `SUPABASE_URL` | URL proyek Supabase | Backend | `https://PROJECT_REF.supabase.co` |
| `SUPABASE_ANON_KEY` | Anon/publishable key Supabase | Backend | - |
| `DATABASE_URL` | Connection string PostgreSQL (session pooler) | Backend | `postgresql://postgres.PROJECT_REF:[YOUR-PASSWORD]@aws-0-REGION.pooler.supabase.com:5432/postgres` |
| `DATABASE_SSL` | Aktifkan SSL database (`false` untuk database lokal) | Backend | `true` |
| `DB_POOL_MAX` | Jumlah maksimal koneksi pool | Backend | `5` |
| `ADMIN_EMAILS` | Email (pisahkan koma) yang otomatis menjadi admin | Backend | `admin@example.com` |
| `VITE_API_URL` | URL Backend API | Frontend | `http://localhost:5000` |
| `VITE_SUPABASE_URL` | URL proyek Supabase | Frontend | `https://PROJECT_REF.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Anon/publishable key Supabase | Frontend | - |

Konfigurasi device ada di `device/include/secrets.h` (`WIFI_SSID`, `WIFI_PASSWORD`, `API_BASE_URL`, `AQUARIUM_ID`, `DEVICE_KEY`).
