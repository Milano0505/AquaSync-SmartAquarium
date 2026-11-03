import { Router } from "express";
import { buildAquariumResponse, extractConfigSections, findAccessibleAquarium } from "../config/aquarium-repository.js";
import { queryDatabase, runInTransaction } from "../config/database.js";
import { requireUserAuth } from "../middleware/auth.js";
import { ASSIGNABLE_MEMBER_ROLES, hasMinimumRole, isUuid } from "../utils/access-roles.js";
import { publishConfigChange } from "../utils/config-change-events.js";
import { configFieldRules, validateTemperatureThresholds } from "../utils/config-validation.js";
import { badRequestError, forbiddenError } from "../utils/http-errors.js";
import { addAquariumNotification, VISIBLE_NOTIFICATION_CONDITION } from "../utils/notification-records.js";

// router akuarium
const aquariumRouter = Router();
aquariumRouter.use(requireUserAuth);

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

// daftar akuarium
aquariumRouter.get("/", async (req, res) => {
    const { rows } =
        req.authUser.role === "admin"
            ? await queryDatabase("select id, name, 'admin' as role from aquariums order by name")
            : await queryDatabase(
                  `select id, name, role from (
                       select a.id, a.name, m.role
                       from aquarium_members m join aquariums a on a.id = m.aquarium_id
                       where m.user_id = $1
                       union all
                       select a.id, a.name, 'viewer' as role
                       from aquariums a
                       where a.monitoring_public
                         and not exists (select 1 from aquarium_members x where x.user_id = $1)
                   ) access
                   order by name`,
                  [req.authUser.userId],
              );
    return res.json({ aquariums: rows });
});

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

// daftar member
aquariumRouter.get("/:aquariumId/members", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "owner");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);

    const { rows } = await queryDatabase(
        `select m.user_id as "userId", m.role, p.full_name as "fullName", p.email
         from aquarium_members m join profiles p on p.id = m.user_id
         where m.aquarium_id = $1 and ($2 or m.role = 'member')
         order by m.role desc, p.full_name`,
        [aquarium.id, hasMinimumRole(aquarium.role, "admin")],
    );
    return res.json({ members: rows });
});

// kandidat member
aquariumRouter.get("/:aquariumId/candidates", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "owner");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);

    const { rows } = await queryDatabase(
        `select p.id as "userId", p.full_name as "fullName", p.email
         from profiles p
         where p.role <> 'admin'
           and not exists (select 1 from aquarium_members m where m.aquarium_id = $1 and m.user_id = p.id)
         order by p.full_name, p.email`,
        [aquarium.id],
    );
    return res.json({ candidates: rows });
});

// simpan member
aquariumRouter.put("/:aquariumId/members", async (req, res) => {
    const aquarium = await findAccessibleAquarium(req.params.aquariumId, req.authUser, "owner");
    if (!aquarium) return res.status(404).json(AQUARIUM_NOT_FOUND_RESPONSE);

    const { role } = req.body;
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if ((!isUuid(req.body.userId) && !email) || !ASSIGNABLE_MEMBER_ROLES.includes(role)) {
        throw badRequestError('Provide a user (userId or email) and a role of "owner" or "member".');
    }

    const targetUsers = isUuid(req.body.userId)
        ? await queryDatabase("select id, role from profiles where id = $1", [req.body.userId])
        : await queryDatabase("select id, role from profiles where email = $1", [email]);
    if (!targetUsers.rows[0]) return res.status(404).json({ message: "User was not found." });
    const userId = targetUsers.rows[0].id;
    if (targetUsers.rows[0].role === "admin") throw badRequestError("Admins already have access to every aquarium.");

    const existingMembership = await queryDatabase(
        "select role from aquarium_members where aquarium_id = $1 and user_id = $2",
        [aquarium.id, userId],
    );
    if (!hasMinimumRole(aquarium.role, "admin") && (role === "owner" || existingMembership.rows[0]?.role === "owner")) {
        throw forbiddenError("Only an admin can assign or change an owner.");
    }

    await queryDatabase(
        `insert into aquarium_members (aquarium_id, user_id, role) values ($1, $2, $3)
         on conflict (aquarium_id, user_id) do update set role = excluded.role`,
        [aquarium.id, userId, role],
    );
    return res.json({ userId, role, message: "Member saved." });
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
    if (memberRole === "owner" && !hasMinimumRole(aquarium.role, "admin")) {
        throw forbiddenError("Only an admin can remove an owner.");
    }

    await queryDatabase("delete from aquarium_members where aquarium_id = $1 and user_id = $2", [aquarium.id, userId]);
    return res.json({ message: "Member removed." });
});

export default aquariumRouter;
