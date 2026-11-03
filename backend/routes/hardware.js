import { Router } from "express";
import { extractConfigSections, getAquariumById } from "../config/aquarium-repository.js";
import { queryDatabase, runInTransaction } from "../config/database.js";
import { requireDeviceKey, requireDeviceOwnsAquarium } from "../middleware/auth.js";
import { getConfigVersion, waitForConfigChange } from "../utils/config-change-events.js";
import { offlineThresholdSeconds, recordTelemetryReceived } from "../utils/device-watchdog.js";
import { addAquariumNotification } from "../utils/notification-records.js";
import {
    detectTelemetryChanges,
    loadPreviousHistoryRecord,
    refreshNextRecordChanges,
    toTelemetrySnapshot,
} from "../utils/telemetry-changes.js";

// router hardware
const hardwareRouter = Router();
hardwareRouter.use(requireDeviceKey);
hardwareRouter.use("/:aquariumId", requireDeviceOwnsAquarium);

// not found
const AQUARIUM_NOT_FOUND_RESPONSE = { message: "Aquarium was not found." };

// hari lampu
const LIGHTING_USAGE_DAYS = 7;
// interval riwayat
const HISTORY_INTERVAL_SECONDS = 60;
// umur live
const LIVE_MEASURED_MAX_AGE_MS = 5 * 60_000;
// umur backlog
const BACKLOG_MEASURED_MAX_AGE_MS = 7 * 24 * 3_600_000;
// toleransi waktu
const MEASURED_FUTURE_TOLERANCE_MS = 5 * 60_000;
// maks backlog
const MAX_BACKLOG_READINGS = 50;
// umur boot
const BOOT_REPORT_MAX_AGE_MS = 24 * 3_600_000;
// slack riwayat
const HISTORY_SLACK_SECONDS = 5;

// alasan restart
const BOOT_REASON_MESSAGES = {
    "task watchdog": "The control program stopped responding and was restarted by the watchdog.",
    "interrupt watchdog": "The control program stopped responding and was restarted by the watchdog.",
    "other watchdog": "The control program stopped responding and was restarted by the watchdog.",
    "crash (panic)": "The firmware crashed and restarted.",
    "brownout (power dip)": "The power supply dipped below the safe level. Check the power adapter and wiring.",
    "network task stalled": "The network connection stopped responding and the device restarted itself.",
};

// status onoff
const isOnOffState = value => value === "ON" || value === "OFF";
// status pakan
const isFeederStatusValue = value => value === "Idle" || value === "Active";

// tanggal lokal
function formatLocalDay(date, timezone) {
    try {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(date);
    } catch {
        return date.toISOString().slice(0, 10);
    }
}

// suhu ekstrem
const isTempOutOfRange = (temp, minTemp, maxTemp) =>
    (Number.isFinite(minTemp) && temp < minTemp) || (Number.isFinite(maxTemp) && temp > maxTemp);

// waktu ukur
function parseDeviceTimestamp(value, now, maxAgeMs) {
    if (!Number.isInteger(value)) return null;
    const milliseconds = value * 1000;
    if (milliseconds > now.getTime() + MEASURED_FUTURE_TOLERANCE_MS) return null;
    if (milliseconds < now.getTime() - maxAgeMs) return null;
    return new Date(milliseconds);
}

// tambah lampu
function calculateLightingUsageDelta(deviceStateRow, now) {
    const previousLed = deviceStateRow.led_status;
    const elapsedSeconds = deviceStateRow.last_updated
        ? (now.getTime() - deviceStateRow.last_updated.getTime()) / 1000
        : 0;
    const maxGapSeconds = offlineThresholdSeconds(deviceStateRow.system_config?.pollFrequency);
    if (!isOnOffState(previousLed) || elapsedSeconds <= 0 || elapsedSeconds > maxGapSeconds) return null;
    return {
        day: formatLocalDay(now, deviceStateRow.system_config?.timezone),
        column: previousLed === "ON" ? "on_seconds" : "off_seconds",
        seconds: Math.round(elapsedSeconds * 10) / 10,
    };
}

// terima telemetry
hardwareRouter.post("/:aquariumId/telemetry", async (req, res) => {
    const { currentTemp, heaterStatus, ledStatus, feederStatus } = req.body;
    const event = typeof req.body.event === "string" ? req.body.event.trim().slice(0, 160) : "";
    // sensor gagal
    const sensorFault = (currentTemp === undefined || currentTemp === null) && event !== "";
    if (!sensorFault && (!Number.isFinite(currentTemp) || currentTemp < -10 || currentTemp > 60)) {
        return res.status(400).json({
            message:
                "currentTemp must be a finite Celsius value between -10 and 60 (omit it only to report a sensor fault with an event).",
        });
    }
    if (!isOnOffState(heaterStatus) || !isOnOffState(ledStatus) || !isFeederStatusValue(feederStatus)) {
        return res.status(400).json({ message: "Device statuses are invalid." });
    }

    const aquariumId = req.params.aquariumId;
    const now = new Date();
    const measuredAt = parseDeviceTimestamp(req.body.measuredAt, now, LIVE_MEASURED_MAX_AGE_MS);
    // laporan restart
    const bootReason =
        typeof req.body.bootReason === "string" && Object.hasOwn(BOOT_REASON_MESSAGES, req.body.bootReason)
            ? req.body.bootReason
            : null;
    const bootedAt = parseDeviceTimestamp(req.body.bootedAt, now, BOOT_REPORT_MAX_AGE_MS);

    // transaksi telemetry
    const pollFrequency = await runInTransaction(async client => {
        const { rows } = await client.query(
            `select a.temp_config, a.system_config,
                    ds.current_temp, ds.heater_status, ds.led_status, ds.feeder_status, ds.last_updated,
                    ds.offline_notified, ds.sensor_error_notified, ds.last_history_at
             from aquariums a join device_state ds on ds.aquarium_id = a.id
             where a.id = $1
             for update of ds`,
            [aquariumId],
        );
        const deviceStateRow = rows[0];
        if (!deviceStateRow) return null;

        const cameBackOnline = deviceStateRow.offline_notified;
        const sensorErrorNotified = deviceStateRow.sensor_error_notified;

        // simpan riwayat
        const { minTempThreshold, maxTempThreshold } = deviceStateRow.temp_config || {};
        const wasOutOfRange =
            Number.isFinite(deviceStateRow.current_temp) &&
            isTempOutOfRange(deviceStateRow.current_temp, minTempThreshold, maxTempThreshold);
        const crossedLimit =
            !sensorFault && isTempOutOfRange(currentTemp, minTempThreshold, maxTempThreshold) && !wasOutOfRange;
        const statusChanged =
            deviceStateRow.heater_status !== heaterStatus ||
            deviceStateRow.led_status !== ledStatus ||
            deviceStateRow.feeder_status !== feederStatus;
        const historyDue =
            !deviceStateRow.last_history_at ||
            (now.getTime() - deviceStateRow.last_history_at.getTime()) / 1000 >=
                HISTORY_INTERVAL_SECONDS - HISTORY_SLACK_SECONDS;
        const shouldSaveHistory = !sensorFault && (statusChanged || crossedLimit || historyDue);

        const lightingUsage = calculateLightingUsageDelta(deviceStateRow, now);

        await client.query(
            `update device_state set
                 current_temp = $2, heater_status = $3, led_status = $4, feeder_status = $5,
                 last_updated = now(), offline_notified = false, sensor_error_notified = $6,
                 last_history_at = case when $7 then now() else last_history_at end
             where aquarium_id = $1`,
            [
                aquariumId,
                sensorFault ? null : currentTemp,
                heaterStatus,
                ledStatus,
                feederStatus,
                sensorFault,
                shouldSaveHistory,
            ],
        );

        if (lightingUsage) {
            // kolom tetap
            await client.query(
                `insert into lighting_usage (aquarium_id, day, ${lightingUsage.column}) values ($1, $2, $3)
                 on conflict (aquarium_id, day) do update
                 set ${lightingUsage.column} = lighting_usage.${lightingUsage.column} + excluded.${lightingUsage.column}`,
                [aquariumId, lightingUsage.day, lightingUsage.seconds],
            );
            // retensi 7hari
            await client.query("delete from lighting_usage where aquarium_id = $1 and day < $2::date - $3::int", [
                aquariumId,
                lightingUsage.day,
                LIGHTING_USAGE_DAYS - 1,
            ]);
        }

        if (shouldSaveHistory) {
            // bandingkan sebelumnya
            const previousRecord = await loadPreviousHistoryRecord(
                (sqlText, params) => client.query(sqlText, params),
                aquariumId,
                measuredAt || now,
            );
            const snapshot = toTelemetrySnapshot(req.body, event);
            await client.query(
                `insert into telemetry_history (aquarium_id, recorded_at, temp, heater_state, led_state, feeder_state, event, changes)
                 values ($1, coalesce($2, now()), $3, $4, $5, $6, $7, $8)
                 on conflict (aquarium_id, recorded_at) do nothing`,
                [
                    aquariumId,
                    measuredAt,
                    currentTemp,
                    heaterStatus,
                    ledStatus,
                    feederStatus,
                    snapshot.event,
                    detectTelemetryChanges(previousRecord, snapshot),
                ],
            );
        }

        // notifikasi hardware
        const notifyAquarium = notification =>
            addAquariumNotification(client, { aquariumId, actorName: "Aquarium hardware", ...notification });

        if (bootReason) {
            await notifyAquarium({
                title: "Device Restarted",
                message: `${BOOT_REASON_MESSAGES[bootReason]} Heater and lamp were switched off during the restart and resumed with the last saved settings.`,
                type: "alert",
                dedupeKey: bootedAt ? `boot-${Math.floor(bootedAt.getTime() / 1000)}` : null,
            });
        }

        if (sensorFault) {
            if (!sensorErrorNotified) {
                await notifyAquarium({
                    title: "Sensor Error",
                    message: `The temperature sensor is not returning a valid reading (${event}). Check the sensor wiring.`,
                    type: "alert",
                });
            }
        } else if (crossedLimit) {
            const isBelowMin = currentTemp < minTempThreshold;
            await notifyAquarium({
                title: "Temperature Alert",
                message: `Water temperature is ${isBelowMin ? "below" : "above"} the configured threshold of ${isBelowMin ? minTempThreshold : maxTempThreshold}°C (${currentTemp}°C).`,
                type: "alert",
            });
        }

        if (cameBackOnline) {
            await notifyAquarium({
                title: "Device Back Online",
                message: "The aquarium hardware is sending data again.",
                type: "success",
            });
        }

        return deviceStateRow.system_config?.pollFrequency;
    });

    if (pollFrequency === null) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    recordTelemetryReceived(aquariumId, pollFrequency);
    return res.status(201).json({ status: "received", timestamp: now.toISOString() });
});

// telemetry antrean
hardwareRouter.post("/:aquariumId/telemetry/backlog", async (req, res) => {
    const { readings } = req.body;
    if (!Array.isArray(readings) || readings.length === 0 || readings.length > MAX_BACKLOG_READINGS) {
        return res.status(400).json({ message: `readings must be a list of 1 to ${MAX_BACKLOG_READINGS} items.` });
    }

    const aquarium = await getAquariumById(req.params.aquariumId);
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);

    const now = new Date();
    const validReadings = readings
        .map(reading => ({
            reading: reading || {},
            measuredAt: parseDeviceTimestamp(reading?.measuredAt, now, BACKLOG_MEASURED_MAX_AGE_MS),
        }))
        .filter(({ reading, measuredAt }) => {
            const { currentTemp, heaterStatus, ledStatus, feederStatus } = reading;
            return (
                measuredAt &&
                Number.isFinite(currentTemp) &&
                currentTemp >= -10 &&
                currentTemp <= 60 &&
                isOnOffState(heaterStatus) &&
                isOnOffState(ledStatus) &&
                isFeederStatusValue(feederStatus)
            );
        });

    if (validReadings.length > 0) {
        // urut waktu
        validReadings.sort((a, b) => a.measuredAt - b.measuredAt);
        const readingEvents = validReadings.map(({ reading }) =>
            typeof reading.event === "string" && reading.event.trim()
                ? reading.event.trim().slice(0, 160)
                : "Telemetry update",
        );
        // bandingkan sebelumnya
        let previousSnapshot = await loadPreviousHistoryRecord(queryDatabase, aquarium.id, validReadings[0].measuredAt);
        const readingChanges = validReadings.map(({ reading }, index) => {
            const snapshot = toTelemetrySnapshot(reading, readingEvents[index]);
            const changes = detectTelemetryChanges(previousSnapshot, snapshot);
            previousSnapshot = snapshot;
            return changes.join(",");
        });
        // insert massal
        await queryDatabase(
            `insert into telemetry_history (aquarium_id, recorded_at, temp, heater_state, led_state, feeder_state, event, changes)
             select $1, r.recorded_at, r.temp, r.heater_state, r.led_state, r.feeder_state, r.event, string_to_array(r.changes, ',')
             from unnest($2::timestamptz[], $3::numeric[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[])
                  as r(recorded_at, temp, heater_state, led_state, feeder_state, event, changes)
             on conflict (aquarium_id, recorded_at) do nothing`,
            [
                aquarium.id,
                validReadings.map(({ measuredAt }) => measuredAt),
                validReadings.map(({ reading }) => reading.currentTemp),
                validReadings.map(({ reading }) => reading.heaterStatus),
                validReadings.map(({ reading }) => reading.ledStatus),
                validReadings.map(({ reading }) => reading.feederStatus),
                readingEvents,
                readingChanges,
            ],
        );
        // data live lebih dulu
        await refreshNextRecordChanges(queryDatabase, aquarium.id, validReadings.at(-1).measuredAt);
    }
    return res.status(201).json({ accepted: validReadings.length, skipped: readings.length - validReadings.length });
});

// batas polling
const MAX_CONFIG_WAIT_SECONDS = 25;

// config perangkat
hardwareRouter.get("/:aquariumId/config", async (req, res) => {
    const { aquariumId } = req.params;
    const waitSeconds = Math.min(Math.max(Number(req.query.wait) || 0, 0), MAX_CONFIG_WAIT_SECONDS);
    const knownVersion = typeof req.query.v === "string" ? req.query.v : "";
    if (waitSeconds > 0 && knownVersion) {
        await waitForConfigChange(aquariumId, knownVersion, waitSeconds * 1000, res);
        if (res.destroyed) return undefined;
    }

    // versi sebelum
    const currentConfigVersion = getConfigVersion(aquariumId);
    const aquarium = await getAquariumById(aquariumId);
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    const { tempConfig, lightingConfig, feederConfig, systemConfig } = extractConfigSections(aquarium.row);
    return res.json({
        configVersion: currentConfigVersion,
        tempConfig,
        lightingConfig,
        feederConfig,
        systemConfig: { pollFrequency: systemConfig?.pollFrequency, timezone: systemConfig?.timezone },
    });
});

export default hardwareRouter;
