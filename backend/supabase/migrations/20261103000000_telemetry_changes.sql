-- Setiap catatan riwayat menyimpan nama hal yang berubah dibanding catatan sebelumnya pada akuarium yang sama.
-- Nilainya: heater, led, feeder (status berubah), temp (suhu berubah minimal 0,5 °C), system (teks event berubah).
-- Ambang 0,5 °C sama dengan TEMP_CHANGE_MIN_C di backend/utils/telemetry-changes.js.
-- Satu catatan bisa punya beberapa nilai sekaligus. Kolom ini tidak ditampilkan di UI, hanya dipakai filter Data History.
-- Catatan pertama sebuah akuarium tidak punya pembanding, jadi isinya kosong.
alter table public.telemetry_history
    add column changes text[] not null default '{}';

-- Isi data lama dengan aturan yang sama seperti backend (backend/utils/telemetry-changes.js)
update public.telemetry_history t
set changes = array_remove(
    array[
        case when abs(t.temp - p.prev_temp) >= 0.5                    then 'temp'   end,
        case when t.heater_state is distinct from p.prev_heater_state then 'heater' end,
        case when t.led_state    is distinct from p.prev_led_state    then 'led'    end,
        case when t.feeder_state is distinct from p.prev_feeder_state then 'feeder' end,
        case when t.event        is distinct from p.prev_event        then 'system' end
    ],
    null
)
from (
    select id,
           lag(id)           over previous_record as prev_id,
           lag(temp)         over previous_record as prev_temp,
           lag(heater_state) over previous_record as prev_heater_state,
           lag(led_state)    over previous_record as prev_led_state,
           lag(feeder_state) over previous_record as prev_feeder_state,
           lag(event)        over previous_record as prev_event
    from public.telemetry_history
    window previous_record as (partition by aquarium_id order by recorded_at)
) p
where p.id = t.id
  and p.prev_id is not null;
