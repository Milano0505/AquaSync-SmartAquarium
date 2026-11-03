import { queryDatabase, runInTransaction } from "../config/database.js";
import { addAquariumNotification } from "./notification-records.js";

// poll default
const DEFAULT_POLL_FREQUENCY_SECONDS = 5;
// minimal offline
const MIN_OFFLINE_THRESHOLD_SECONDS = 60;
// interval cek
const OFFLINE_CHECK_INTERVAL_MS = 30_000;

// batas offline
export function offlineThresholdSeconds(pollFrequency) {
    const pollSeconds = Number.isFinite(pollFrequency) ? pollFrequency : DEFAULT_POLL_FREQUENCY_SECONDS;
    return Math.max(MIN_OFFLINE_THRESHOLD_SECONDS, pollSeconds * 3);
}

// telemetry terakhir
const lastTelemetryByAquarium = new Map();

// catat telemetry
export function recordTelemetryReceived(aquariumId, pollFrequency) {
    lastTelemetryByAquarium.set(aquariumId, { lastSeenMs: Date.now(), pollFrequency, offlineNotified: false });
}

// muat awal
async function loadInitialTelemetryState() {
    const { rows } = await queryDatabase(
        `select ds.aquarium_id, ds.last_updated, ds.offline_notified, a.system_config
         from device_state ds join aquariums a on a.id = ds.aquarium_id
         where ds.last_updated is not null`,
    );
    rows.forEach(row => {
        lastTelemetryByAquarium.set(row.aquarium_id, {
            lastSeenMs: row.last_updated.getTime(),
            pollFrequency: row.system_config?.pollFrequency,
            offlineNotified: row.offline_notified,
        });
    });
}

// notifikasi offline
async function notifyDeviceOffline(aquariumId) {
    await runInTransaction(async client => {
        const { rows } = await client.query(
            `select ds.last_updated, ds.offline_notified, a.system_config
             from device_state ds join aquariums a on a.id = ds.aquarium_id
             where ds.aquarium_id = $1
             for update of ds`,
            [aquariumId],
        );
        const deviceStateRow = rows[0];
        if (!deviceStateRow?.last_updated || deviceStateRow.offline_notified) return;

        const thresholdSeconds = offlineThresholdSeconds(deviceStateRow.system_config?.pollFrequency);
        if ((Date.now() - deviceStateRow.last_updated.getTime()) / 1000 <= thresholdSeconds) return;

        await client.query("update device_state set offline_notified = true where aquarium_id = $1", [aquariumId]);
        await addAquariumNotification(client, {
            aquariumId,
            actorName: "Aquarium hardware",
            title: "Device Offline",
            message: `No data has been received from the aquarium hardware for more than ${Math.floor(thresholdSeconds / 60)} minutes. Check its power and Wi-Fi connection. Commands will run when it reconnects.`,
            type: "alert",
        });
    });
}

// cek offline
async function checkOfflineDevices() {
    for (const [aquariumId, telemetryState] of lastTelemetryByAquarium) {
        if (telemetryState.offlineNotified) continue;
        if ((Date.now() - telemetryState.lastSeenMs) / 1000 <= offlineThresholdSeconds(telemetryState.pollFrequency)) {
            continue;
        }

        await notifyDeviceOffline(aquariumId);
        if (lastTelemetryByAquarium.get(aquariumId) === telemetryState) telemetryState.offlineNotified = true;
    }
}

// mulai watchdog
export function startDeviceWatchdog() {
    loadInitialTelemetryState().catch(error => console.error("Unable to load the device status:", error.message));
    const offlineCheckTimer = setInterval(() => {
        checkOfflineDevices().catch(error => console.error("Device offline check failed:", error.message));
    }, OFFLINE_CHECK_INTERVAL_MS);
    offlineCheckTimer.unref();
}
