// event bawaan
export const DEFAULT_TELEMETRY_EVENT = "Telemetry update";

// ambang suhu
export const TEMP_CHANGE_MIN_C = 0.5;

// bulatkan suhu
const roundToTenth = value => Math.sign(value) * (Math.round(Math.abs(value) * 10) / 10);

// snapshot telemetry
export function toTelemetrySnapshot({ currentTemp, heaterStatus, ledStatus, feederStatus }, event) {
    return {
        // sama seperti kolom numeric(4, 1)
        temp: roundToTenth(currentTemp),
        heaterState: heaterStatus,
        ledState: ledStatus,
        feederState: feederStatus,
        event: event || DEFAULT_TELEMETRY_EVENT,
    };
}

// deteksi perubahan
export function detectTelemetryChanges(previous, current) {
    if (!previous) return [];
    return [
        roundToTenth(Math.abs(current.temp - Number(previous.temp))) >= TEMP_CHANGE_MIN_C && "temp",
        previous.heaterState !== current.heaterState && "heater",
        previous.ledState !== current.ledState && "led",
        previous.feederState !== current.feederState && "feeder",
        previous.event !== current.event && "system",
    ].filter(Boolean);
}

// hitung ulang berikutnya
export async function refreshNextRecordChanges(runQuery, aquariumId, after) {
    const { rows } = await runQuery(
        `select id, recorded_at as "recordedAt", temp, heater_state as "heaterState", led_state as "ledState",
                feeder_state as "feederState", event
         from telemetry_history
         where aquarium_id = $1 and recorded_at > $2
         order by recorded_at asc
         limit 1`,
        [aquariumId, after],
    );
    const nextRecord = rows[0];
    if (!nextRecord) return;
    const previousRecord = await loadPreviousHistoryRecord(runQuery, aquariumId, nextRecord.recordedAt);
    await runQuery("update telemetry_history set changes = $2 where id = $1", [
        nextRecord.id,
        detectTelemetryChanges(previousRecord, nextRecord),
    ]);
}

// catatan sebelumnya
export async function loadPreviousHistoryRecord(runQuery, aquariumId, before) {
    const { rows } = await runQuery(
        `select temp, heater_state as "heaterState", led_state as "ledState", feeder_state as "feederState", event
         from telemetry_history
         where aquarium_id = $1 and recorded_at < $2
         order by recorded_at desc
         limit 1`,
        [aquariumId, before],
    );
    return rows[0] || null;
}
