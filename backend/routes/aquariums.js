import { Router } from "express";
import { randomBytes } from "node:crypto";
import { createDefaultAquariumConfig } from "../config/default-aquarium.js";
import { buildAquariumResponse, extractConfigSections, findAccessibleAquarium } from "../config/aquarium-repository.js";
import { queryDatabase, runInTransaction } from "../config/database.js";
import { hashDeviceKey, invalidateDeviceKeyCache, requireUserAuth } from "../middleware/auth.js";
import { isUuid, isValidAquariumId } from "../utils/access-roles.js";
import { publishConfigChange } from "../utils/config-change-events.js";
import { configFieldRules, validateTemperatureThresholds } from "../utils/config-validation.js";
import { badRequestError, conflictError } from "../utils/http-errors.js";
import {
    addAquariumNotification,
    addUserNotification,
    VISIBLE_NOTIFICATION_CONDITION,
} from "../utils/notification-records.js";

// router akuarium
const aquariumRouter = Router();
aquariumRouter.use(requireUserAuth);

// kode unique
const PG_UNIQUE_VIOLATION_CODE = "23505";

// not found
const AQUARIUM_NOT_FOUND_RESPONSE = { message: "Aquarium was not found." };

// label config
const CONFIG_FIELD_LABELS = {
    targetTemp: "target temperature",
    minTempThreshold: "minimum temperature threshold",
    maxTempThreshold: "maximum temperature threshold",
    pollFrequency: "sensor poll interval",
    manualControlState: "manual control state",
};

// judul notifikasi
const CONFIG_SECTION_NOTIFICATION_TITLES = {
    tempConfig: "Temperature settings updated",
    lightingConfig: "Lighting settings updated",
    feederConfig: "Feeder settings updated",
    systemConfig: "System settings updated",
};

// kolom jsonb
const CONFIG_SECTION_COLUMNS = {
    tempConfig: "temp_config",
    lightingConfig: "lighting_config",
    feederConfig: "feeder_config",
    systemConfig: "system_config",
};

// parse limit
function parseLimitParam(value, fallback, maximum = 500) {
    if (value === undefined || value === "") return fallback;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : null;
}

// parse tanggal
function parseDateParam(value) {
    if (value === undefined || value === "") return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

// nama aktor
async function loadActorName(client, userId) {
    const { rows } = await client.query("select full_name from profiles where id = $1", [userId]);
    return rows[0]?.full_name || "A user";
}

// path config
function resolveConfigFieldPath(section, field) {
    return section === "systemConfig" && field === "unit" ? "tempConfig.unit" : `${section}.${field}`;
}

// nilai path
function getValueAtPath(data, path) {
    return path.split(".").reduce((object, key) => object?.[key], data);
}

// deskripsi field
function describeConfigField(field) {
    return CONFIG_FIELD_LABELS[field] || field.replace(/[A-Z]/g, character => ` ${character.toLowerCase()}`);
}

// deskripsi nilai
function describeConfigValue(field, value, tempConfig) {
    if (field.toLowerCase().includes("temp") && typeof value === "number") {
        return tempConfig?.unit === "Fahrenheit" ? `${+((value * 9) / 5 + 32).toFixed(1)}°F` : `${value}°C`;
    }
    if (field === "pollFrequency") return `${value} seconds`;
    if (field === "schedule")
        return `${value.startTime} - ${value.endTime} (${value.isActive ? "active" : "inactive"})`;
    if (field === "schedules") {
        const activeTimes = value.filter(entry => entry.isActive).map(entry => entry.time);
        return activeTimes.length > 0 ? activeTimes.join(", ") : "no active feeding times";
    }
    return String(value);
}

// handler patch
function createConfigPatchHandler(section, successMessage) {
    const sectionRules = configFieldRules[section];

    return async (req, res) => {
        const rawConfigEntries = Object.entries(req.body);
        if (rawConfigEntries.length === 0) throw badRequestError("A configuration update is required.");
        if (rawConfigEntries.some(([field]) => !Object.hasOwn(sectionRules, field))) {
            throw badRequestError("The request contains unsupported configuration fields.");
        }
        const validatedEntries = rawConfigEntries.map(([field, value]) => [field, sectionRules[field](value)]);

        const patchOutcome = await runInTransaction(async client => {
            const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "member", {
                client,
                lock: true,
            });
            if (!aquarium) return null;

            const currentSections = extractConfigSections(aquarium.row);
            if (section === "tempConfig") {
                validateTemperatureThresholds({
                    ...currentSections.tempConfig,
                    ...Object.fromEntries(validatedEntries),
                });
            }

            const changedEntries = validatedEntries.filter(
                ([field, value]) =>
                    JSON.stringify(getValueAtPath(currentSections, resolveConfigFieldPath(section, field))) !==
                    JSON.stringify(value),
            );
            if (changedEntries.length === 0) return { unchanged: true };

            // patch kolom
            const columnPatches = {};
            changedEntries.forEach(([field, value]) => {
                const [targetSection, key] = resolveConfigFieldPath(section, field).split(".");
                (columnPatches[CONFIG_SECTION_COLUMNS[targetSection]] ||= {})[key] = value;
            });
            const columns = Object.keys(columnPatches);
            const assignments = columns.map((column, index) => `${column} = ${column} || $${index + 2}::jsonb`);
            await client.query(`update aquariums set ${assignments.join(", ")}, updated_at = now() where id = $1`, [
                aquarium.id,
                ...columns.map(column => JSON.stringify(columnPatches[column])),
            ]);

            const actorName = await loadActorName(client, req.authUser.userId);
            const changeSummary = changedEntries
                .map(
                    ([field, value]) =>
                        `${describeConfigField(field)} to ${describeConfigValue(field, value, columnPatches.temp_config ? { ...currentSections.tempConfig, ...columnPatches.temp_config } : currentSections.tempConfig)}`,
                )
                .join(" and ");
            await addAquariumNotification(client, {
                aquariumId: aquarium.id,
                actorId: req.authUser.userId,
                actorName,
                title: CONFIG_SECTION_NOTIFICATION_TITLES[section],
                message: `${actorName} changed ${changeSummary}.`,
            });
            return { aquariumId: aquarium.id };
        });

        if (patchOutcome === null) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
        if (patchOutcome.unchanged) {
            return res.json({ updatedAt: new Date().toISOString(), message: "No configuration changes detected." });
        }
        // dorong perangkat
        publishConfigChange(patchOutcome.aquariumId);
        return res.json({ updatedAt: new Date().toISOString(), message: successMessage });
    };
}

// escape CSV
function escapeCsvCell(value) {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
}

// query telemetry
async function queryTelemetryRecords(aquariumId, queryParams) {
    const limit = parseLimitParam(queryParams.limit, 40);
    if (limit === null) throw badRequestError("Limit must be a positive integer.");
    const startDate = parseDateParam(queryParams.startDate);
    const endDate = parseDateParam(queryParams.endDate);
    if ((queryParams.startDate && !startDate) || (queryParams.endDate && !endDate)) {
        throw badRequestError("Date filters must be valid dates.");
    }
    if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
        throw badRequestError("startDate must be before endDate.");
    }

    const { rows } = await queryDatabase(
        `select id, aquarium_id as "aquariumId", recorded_at as "timestamp", temp,
                heater_state as "heaterState", led_state as "ledState", feeder_state as "feederState", event, changes
         from telemetry_history
         where aquarium_id = $1
           and ($2::timestamptz is null or recorded_at >= $2)
           and ($3::timestamptz is null or recorded_at <= $3)
         order by recorded_at desc
         limit $4`,
        [aquariumId, startDate, endDate, limit],
    );
    return rows;
}

// daftar akuarium milik saya
aquariumRouter.get("/", async (req, res) => {
    const { rows } = await queryDatabase(
        `select a.id, a.name, m.role
         from aquarium_members m join aquariums a on a.id = m.aquarium_id
         where m.user_id = $1
         order by a.name`,
        [req.authUser.userId],
    );
    return res.json({ aquariums: rows });
});

// direktori akuarium
aquariumRouter.get("/directory", async (req, res) => {
    const { rows } = await queryDatabase(
        `select a.id, a.name, a.created_at as "createdAt",
                (select json_build_object('userId', p.id, 'fullName', p.full_name)
                 from aquarium_members m join profiles p on p.id = m.user_id
                 where m.aquarium_id = a.id and m.role = 'owner') as owner,
                coalesce(
                    (select json_agg(json_build_object('userId', p.id, 'fullName', p.full_name) order by p.full_name)
                     from aquarium_members m join profiles p on p.id = m.user_id
                     where m.aquarium_id = a.id and m.role = 'member'),
                    '[]'
                ) as members,
                (select m.role from aquarium_members m where m.aquarium_id = a.id and m.user_id = $1) as "myRole",
                exists (select 1 from aquarium_join_requests r where r.aquarium_id = a.id and r.user_id = $1) as "joinRequestPending"
         from aquariums a
         order by a.name`,
        [req.authUser.userId],
    );
    return res.json({ aquariums: rows });
});

// validasi nama
function parseTrimmedName(value, fieldLabel) {
    const name = typeof value === "string" ? value.trim() : "";
    if (!name || name.length > 80) throw badRequestError(`${fieldLabel} must be between 1 and 80 characters.`);
    return name;
}

// daftarkan perangkat
async function registerDevice(client, aquariumId, name, userId) {
    const deviceKey = randomBytes(32).toString("hex");
    try {
        const { rows } = await client.query(
            "insert into devices (aquarium_id, name, key_hash, created_by) values ($1, $2, $3, $4) returning id",
            [aquariumId, name, hashDeviceKey(deviceKey), userId],
        );
        return { id: rows[0].id, deviceKey };
    } catch (error) {
        if (error.code === PG_UNIQUE_VIOLATION_CODE) {
            throw conflictError("This aquarium already has a device. Revoke it before registering a replacement.");
        }
        throw error;
    }
}

// buat akuarium
aquariumRouter.post("/", async (req, res) => {
    const name = parseTrimmedName(req.body.name, "Aquarium name");
    const requestedAquariumId = typeof req.body.id === "string" ? req.body.id.trim() : "";
    if (requestedAquariumId && !isValidAquariumId(requestedAquariumId)) {
        throw badRequestError("Aquarium ID may only contain letters, numbers, - and _ (up to 64 characters).");
    }
    const hasDeviceName = typeof req.body.deviceName === "string" && req.body.deviceName.trim() !== "";
    const deviceName = hasDeviceName ? parseTrimmedName(req.body.deviceName, "Device name") : null;

    const aquariumId = requestedAquariumId || `aquarium-${randomBytes(4).toString("hex")}`;
    const defaultConfig = createDefaultAquariumConfig();
    let device = null;
    try {
        await runInTransaction(async client => {
            await client.query(
                `insert into aquariums (id, name, hardware_info, temp_config, lighting_config, feeder_config, system_config, created_by)
                 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    aquariumId,
                    name,
                    defaultConfig.hardwareInfo,
                    defaultConfig.tempConfig,
                    defaultConfig.lightingConfig,
                    defaultConfig.feederConfig,
                    defaultConfig.systemConfig,
                    req.authUser.userId,
                ],
            );
            await client.query("insert into aquarium_members (aquarium_id, user_id, role) values ($1, $2, 'owner')", [
                aquariumId,
                req.authUser.userId,
            ]);
            if (deviceName) device = await registerDevice(client, aquariumId, deviceName, req.authUser.userId);
        });
    } catch (error) {
        if (error.code === PG_UNIQUE_VIOLATION_CODE) throw conflictError("An aquarium with this ID already exists.");
        throw error;
    }
    if (device) invalidateDeviceKeyCache();
    return res.status(201).json({
        id: aquariumId,
        name,
        deviceId: device?.id ?? null,
        deviceKey: device?.deviceKey ?? null,
        message: device ? "Aquarium created. Copy the device key now; it cannot be shown again." : "Aquarium created.",
    });
});

// ganti nama
aquariumRouter.patch("/:aquariumId", async (req, res) => {
    const name = parseTrimmedName(req.body.name, "Aquarium name");
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "owner");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    await queryDatabase("update aquariums set name = $2, updated_at = now() where id = $1", [aquarium.id, name]);
    return res.json({ message: "Aquarium renamed." });
});

// hapus akuarium
aquariumRouter.delete("/:aquariumId", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "owner");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    await queryDatabase("delete from aquariums where id = $1", [aquarium.id]);
    invalidateDeviceKeyCache();
    return res.json({ message: "Aquarium deleted." });
});

// ambil alih
aquariumRouter.post("/:aquariumId/claim", async (req, res) => {
    const claimOutcome = await runInTransaction(async client => {
        if (!isValidAquariumId(req.params.aquariumId)) return null;
        const { rows } = await client.query("select id from aquariums where id = $1 for update", [
            req.params.aquariumId,
        ]);
        if (!rows[0]) return null;
        const { rowCount } = await client.query(
            "select 1 from aquarium_members where aquarium_id = $1 and role = 'owner'",
            [rows[0].id],
        );
        if (rowCount > 0) throw conflictError("This aquarium already has an owner.");
        await client.query(
            `insert into aquarium_members (aquarium_id, user_id, role) values ($1, $2, 'owner')
             on conflict (aquarium_id, user_id) do update set role = 'owner'`,
            [rows[0].id, req.authUser.userId],
        );
        await client.query("delete from aquarium_join_requests where aquarium_id = $1 and user_id = $2", [
            rows[0].id,
            req.authUser.userId,
        ]);
        return true;
    });
    if (!claimOutcome) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    return res.json({ message: "You are now the owner of this aquarium." });
});

// ajukan join
aquariumRouter.post("/:aquariumId/join-requests", async (req, res) => {
    const joinOutcome = await runInTransaction(async client => {
        const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "viewer", {
            client,
            lock: true,
        });
        if (!aquarium) return null;
        if (aquarium.role !== "viewer") throw conflictError("You are already part of this aquarium.");

        const { rowCount } = await client.query(
            `insert into aquarium_join_requests (aquarium_id, user_id) values ($1, $2)
             on conflict (aquarium_id, user_id) do nothing`,
            [aquarium.id, req.authUser.userId],
        );
        if (rowCount === 0) throw conflictError("Your join request is already pending.");

        const actorName = await loadActorName(client, req.authUser.userId);
        await addAquariumNotification(client, {
            aquariumId: aquarium.id,
            actorId: req.authUser.userId,
            actorName,
            title: "Join request",
            message: `${actorName} asked to join this aquarium.`,
        });
        return true;
    });
    if (!joinOutcome) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    return res.status(201).json({ message: "Join request sent." });
});

// batalkan join
aquariumRouter.delete("/:aquariumId/join-requests/mine", async (req, res) => {
    if (!isValidAquariumId(req.params.aquariumId)) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    const { rowCount } = await queryDatabase(
        "delete from aquarium_join_requests where aquarium_id = $1 and user_id = $2",
        [req.params.aquariumId, req.authUser.userId],
    );
    if (rowCount === 0) return res.status(404).json({ message: "No pending join request was found." });
    return res.json({ message: "Join request cancelled." });
});

// daftar join
aquariumRouter.get("/:aquariumId/join-requests", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "owner");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    const { rows } = await queryDatabase(
        `select r.id, r.user_id as "userId", p.full_name as "fullName", p.email, r.created_at as "createdAt"
         from aquarium_join_requests r join profiles p on p.id = r.user_id
         where r.aquarium_id = $1
         order by r.created_at`,
        [aquarium.id],
    );
    return res.json({ joinRequests: rows });
});

// putuskan join
function createJoinDecisionHandler(isApproved) {
    return async (req, res) => {
        const decisionOutcome = await runInTransaction(async client => {
            const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "owner", {
                client,
                lock: true,
            });
            if (!aquarium || !isUuid(req.params.requestId)) return null;

            const { rows } = await client.query(
                "delete from aquarium_join_requests where id = $1 and aquarium_id = $2 returning user_id",
                [req.params.requestId, aquarium.id],
            );
            if (!rows[0]) return null;

            if (isApproved) {
                await client.query(
                    `insert into aquarium_members (aquarium_id, user_id, role) values ($1, $2, 'member')
                     on conflict (aquarium_id, user_id) do nothing`,
                    [aquarium.id, rows[0].user_id],
                );
            }
            await addUserNotification(
                client,
                rows[0].user_id,
                isApproved ? "Join request approved" : "Join request declined",
                isApproved
                    ? `You are now a member of ${aquarium.row.name}.`
                    : `Your request to join ${aquarium.row.name} was declined.`,
            );
            return true;
        });
        if (!decisionOutcome) return res.status(404).json({ message: "Join request was not found." });
        return res.json({ message: isApproved ? "Join request approved." : "Join request declined." });
    };
}
aquariumRouter.post("/:aquariumId/join-requests/:requestId/approve", createJoinDecisionHandler(true));
aquariumRouter.post("/:aquariumId/join-requests/:requestId/reject", createJoinDecisionHandler(false));

// detail akuarium
aquariumRouter.get("/:aquariumId", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser);
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    return res.json(await buildAquariumResponse(aquarium));
});

// patch config
aquariumRouter.patch(
    "/:aquariumId/temperature-config",
    createConfigPatchHandler("tempConfig", "Temperature config updated."),
);
aquariumRouter.patch(
    "/:aquariumId/lighting-config",
    createConfigPatchHandler("lightingConfig", "Lighting config updated."),
);
aquariumRouter.patch("/:aquariumId/feeder-config", createConfigPatchHandler("feederConfig", "Feeder config updated."));
aquariumRouter.patch("/:aquariumId/system-config", createConfigPatchHandler("systemConfig", "System config updated."));

// beri pakan
aquariumRouter.post("/:aquariumId/feeder/trigger", async (req, res) => {
    const feedOutcome = await runInTransaction(async client => {
        const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "member", {
            client,
            lock: true,
        });
        if (!aquarium) return null;
        if (aquarium.row.feeder_config?.mode !== "MANUAL") return { notManual: true };

        // catat perintah
        await client.query("update aquariums set feeder_last_triggered_at = now() where id = $1", [aquarium.id]);
        const actorName = await loadActorName(client, req.authUser.userId);
        await addAquariumNotification(client, {
            aquariumId: aquarium.id,
            actorId: req.authUser.userId,
            actorName,
            title: "Feed Command Sent",
            message: `${actorName} sent a manual feed command.`,
        });
        return { aquariumId: aquarium.id };
    });

    if (feedOutcome === null) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    if (feedOutcome.notManual) {
        return res.status(409).json({ message: "Switch the feeder to manual mode before triggering it." });
    }
    publishConfigChange(feedOutcome.aquariumId);
    return res.json({ status: "triggered", message: "Feed command sent." });
});

// ekspor telemetry
aquariumRouter.get("/:aquariumId/telemetry/export", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "member");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    if (req.query.format && req.query.format !== "csv") throw badRequestError("Only CSV export is supported.");

    const telemetryRows = await queryTelemetryRecords(aquarium.id, { ...req.query, limit: req.query.limit || 500 });
    const csvFields = ["timestamp", "temp", "heaterState", "ledState", "feederState", "event"];
    const csvText = [csvFields, ...telemetryRows.map(record => csvFields.map(field => record[field]))]
        .map(row => row.map(escapeCsvCell).join(","))
        .join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
        "Content-Disposition",
        `attachment; filename="telemetry-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return res.send(csvText);
});

// riwayat telemetry
aquariumRouter.get("/:aquariumId/telemetry", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser);
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    const telemetryRows = await queryTelemetryRecords(aquarium.id, req.query);
    return res.json({ telemetryRecords: telemetryRows, total: telemetryRows.length });
});

// join status
const NOTIFICATION_STATE_JOIN = `
    from notifications n
    left join notification_states s on s.notification_id = n.id and s.user_id = $2`;

// daftar notifikasi
aquariumRouter.get("/:aquariumId/notifications", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser);
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);

    const limit = parseLimitParam(req.query.limit, 100);
    if (limit === null) throw badRequestError("Limit must be a positive integer.");
    const { readStatus } = req.query;
    if (readStatus && !["read", "unread"].includes(readStatus)) {
        throw badRequestError('readStatus must be "read" or "unread".');
    }

    const { rows } = await queryDatabase(
        `select n.id, case when n.scope = 'user' then 'user' else 'aquarium' end as scope,
                n.aquarium_id as "aquariumId", n.actor_name as "actorName", n.title, n.message, n.type,
                n.created_at as "timestamp", (s.read_at is not null) as "isRead"
         ${NOTIFICATION_STATE_JOIN}
         where ${VISIBLE_NOTIFICATION_CONDITION}
           and ($3::boolean is null or (s.read_at is not null) = $3)
         order by n.created_at desc
         limit $4`,
        [aquarium.id, req.authUser.userId, readStatus ? readStatus === "read" : null, limit],
    );
    return res.json({ notificationRecords: rows });
});

// semua dibaca
aquariumRouter.patch("/:aquariumId/notifications/read-all", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "member");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);

    await queryDatabase(
        `insert into notification_states (notification_id, user_id, read_at)
         select n.id, $2, now()
         ${NOTIFICATION_STATE_JOIN}
         where ${VISIBLE_NOTIFICATION_CONDITION} and s.read_at is null
         on conflict (notification_id, user_id) do update set read_at = now()`,
        [aquarium.id, req.authUser.userId],
    );
    return res.json({ message: "All notifications marked as read." });
});

// cek notifikasi
async function isNotificationVisibleToUser(aquariumId, userId, notificationId) {
    if (!isUuid(notificationId)) return false;
    const { rowCount } = await queryDatabase(
        `select 1 ${NOTIFICATION_STATE_JOIN} where n.id = $3 and ${VISIBLE_NOTIFICATION_CONDITION}`,
        [aquariumId, userId, notificationId],
    );
    return rowCount > 0;
}

// tandai dibaca
aquariumRouter.patch("/:aquariumId/notifications/:notificationId/read", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "member");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    if (!(await isNotificationVisibleToUser(aquarium.id, req.authUser.userId, req.params.notificationId))) {
        return res.status(404).json({ message: "Notification was not found." });
    }

    await queryDatabase(
        `insert into notification_states (notification_id, user_id, read_at) values ($1, $2, now())
         on conflict (notification_id, user_id) do update set read_at = coalesce(notification_states.read_at, now())`,
        [req.params.notificationId, req.authUser.userId],
    );
    return res.json({ message: "Notification marked as read." });
});

// hapus notifikasi
aquariumRouter.delete("/:aquariumId/notifications/:notificationId", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "member");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    if (!(await isNotificationVisibleToUser(aquarium.id, req.authUser.userId, req.params.notificationId))) {
        return res.status(404).json({ message: "Notification was not found." });
    }

    await queryDatabase(
        `insert into notification_states (notification_id, user_id, dismissed_at) values ($1, $2, now())
         on conflict (notification_id, user_id) do update set dismissed_at = now()`,
        [req.params.notificationId, req.authUser.userId],
    );
    return res.json({ message: "Notification deleted." });
});

// daftar anggota
aquariumRouter.get("/:aquariumId/members", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "member");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);

    const { rows } = await queryDatabase(
        `select m.user_id as "userId", m.role, p.full_name as "fullName", p.email
         from aquarium_members m join profiles p on p.id = m.user_id
         where m.aquarium_id = $1
         order by m.role desc, p.full_name`,
        [aquarium.id],
    );
    return res.json({ members: rows });
});

// keluar akuarium
aquariumRouter.delete("/:aquariumId/members/me", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "member");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    if (aquarium.role === "owner") {
        throw badRequestError("The owner cannot leave the aquarium. Delete the aquarium instead.");
    }
    await queryDatabase("delete from aquarium_members where aquarium_id = $1 and user_id = $2", [
        aquarium.id,
        req.authUser.userId,
    ]);
    return res.json({ message: "You left the aquarium." });
});

// hapus member
aquariumRouter.delete("/:aquariumId/members/:userId", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "owner");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);

    const { userId } = req.params;
    const notMemberResponse = { message: "This user is not a member of the aquarium." };
    if (!isUuid(userId)) return res.status(404).json(notMemberResponse);

    const existingMembership = await queryDatabase(
        "select role from aquarium_members where aquarium_id = $1 and user_id = $2",
        [aquarium.id, userId],
    );
    const memberRole = existingMembership.rows[0]?.role;
    if (!memberRole) return res.status(404).json(notMemberResponse);
    if (memberRole === "owner") throw badRequestError("The owner cannot be removed.");

    await queryDatabase("delete from aquarium_members where aquarium_id = $1 and user_id = $2", [aquarium.id, userId]);
    return res.json({ message: "Member removed." });
});

// status perangkat
aquariumRouter.get("/:aquariumId/device", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "member");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    const { rows } = await queryDatabase(
        `select id, name, created_at as "createdAt" from devices where aquarium_id = $1`,
        [aquarium.id],
    );
    return res.json({ device: rows[0] ?? null });
});

// daftar perangkat
aquariumRouter.post("/:aquariumId/devices", async (req, res) => {
    const name = parseTrimmedName(req.body.name, "Device name");
    const device = await runInTransaction(async client => {
        const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "owner", {
            client,
            lock: true,
        });
        if (!aquarium) return null;
        return registerDevice(client, aquarium.id, name, req.authUser.userId);
    });
    if (!device) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    invalidateDeviceKeyCache();
    return res.status(201).json({
        id: device.id,
        deviceKey: device.deviceKey,
        message: "Device registered. Copy the key now; it cannot be shown again.",
    });
});

// ganti kunci
aquariumRouter.post("/:aquariumId/devices/:deviceId/rotate-key", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "owner");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    if (!isUuid(req.params.deviceId)) return res.status(404).json({ message: "Device was not found." });

    const deviceKey = randomBytes(32).toString("hex");
    const { rowCount } = await queryDatabase("update devices set key_hash = $3 where id = $1 and aquarium_id = $2", [
        req.params.deviceId,
        aquarium.id,
        hashDeviceKey(deviceKey),
    ]);
    if (rowCount === 0) return res.status(404).json({ message: "Device was not found." });
    invalidateDeviceKeyCache();
    return res.json({ deviceKey, message: "New key created. The old key no longer works. Copy it now." });
});

// cabut perangkat
aquariumRouter.delete("/:aquariumId/devices/:deviceId", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "owner");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);
    if (!isUuid(req.params.deviceId)) return res.status(404).json({ message: "Device was not found." });

    const { rowCount } = await queryDatabase("delete from devices where id = $1 and aquarium_id = $2", [
        req.params.deviceId,
        aquarium.id,
    ]);
    if (rowCount === 0) return res.status(404).json({ message: "Device was not found." });
    invalidateDeviceKeyCache();
    return res.json({ message: "Device revoked." });
});

export default aquariumRouter;
