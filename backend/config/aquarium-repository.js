import { queryDatabase } from "./database.js";
import { forbiddenError } from "../utils/http-errors.js";
import { hasMinimumRole, isValidAquariumId } from "../utils/access-roles.js";

// kolom akuarium
const AQUARIUM_SELECT_COLUMNS = `
    a.*,
    ds.current_temp, ds.heater_status, ds.led_status, ds.feeder_status, ds.last_updated,
    ds.offline_notified, ds.sensor_error_notified, ds.last_history_at`;

// tanpa akses
export async function getAquariumById(aquariumId, dbClient = { query: queryDatabase }) {
    if (!isValidAquariumId(aquariumId)) return null;
    const { rows } = await dbClient.query(
        `select ${AQUARIUM_SELECT_COLUMNS}
         from aquariums a left join device_state ds on ds.aquarium_id = a.id
         where a.id = $1`,
        [aquariumId],
    );
    return rows[0] ? { id: rows[0].id, row: rows[0] } : null;
}

// dengan akses
export async function findAccessibleAquarium(
    aquariumId,
    authUser,
    minimumRole = "viewer",
    { client: dbClient = { query: queryDatabase }, lock = false } = {},
) {
    if (!isValidAquariumId(aquariumId)) return null;
    const { rows } = await dbClient.query(
        `select ${AQUARIUM_SELECT_COLUMNS}, m.role as member_role
         from aquariums a
         left join device_state ds on ds.aquarium_id = a.id
         left join aquarium_members m on m.aquarium_id = a.id and m.user_id = $2
         where a.id = $1
         ${lock ? "for update of a" : ""}`,
        [aquariumId, authUser.userId],
    );
    const row = rows[0];
    if (!row) return null;

    // bukan anggota = viewer
    const role = row.member_role ?? "viewer";
    if (!hasMinimumRole(role, minimumRole)) throw forbiddenError(`This action requires the ${minimumRole} role.`);
    return { id: row.id, row, role };
}

// jam lampu
export async function getLightingAverageHours(aquariumId, dbClient = { query: queryDatabase }) {
    const { rows } = await dbClient.query(
        `select coalesce(sum(on_seconds), 0) as on_seconds, coalesce(sum(off_seconds), 0) as off_seconds
         from (select on_seconds, off_seconds from lighting_usage where aquarium_id = $1 order by day desc limit 7) recent`,
        [aquariumId],
    );
    const { on_seconds: onSeconds, off_seconds: offSeconds } = rows[0];
    if (onSeconds + offSeconds <= 0) return { avgHoursOn: null, avgHoursOff: null };
    const avgHoursOn = Math.round(((24 * onSeconds) / (onSeconds + offSeconds)) * 10) / 10;
    return { avgHoursOn, avgHoursOff: Math.round((24 - avgHoursOn) * 10) / 10 };
}

// bagian config
export function extractConfigSections(row) {
    return {
        tempConfig: row.temp_config,
        lightingConfig: row.lighting_config,
        feederConfig: { ...row.feeder_config, lastTriggeredAt: row.feeder_last_triggered_at },
        systemConfig: row.system_config,
    };
}

// respons akuarium
export async function buildAquariumResponse(aquarium) {
    const { row, role } = aquarium;
    const configSections = extractConfigSections(row);
    const lightingAverages = await getLightingAverageHours(row.id);
    return {
        id: row.id,
        name: row.name,
        role,
        hardwareInfo: row.hardware_info,
        realtimeState: {
            currentTemp: row.current_temp,
            heaterStatus: row.heater_status,
            ledStatus: row.led_status,
            feederStatus: row.feeder_status,
            lastUpdated: row.last_updated,
        },
        tempConfig: configSections.tempConfig,
        lightingConfig: { ...configSections.lightingConfig, ...lightingAverages },
        feederConfig: configSections.feederConfig,
        systemConfig: {
            pollFrequency: configSections.systemConfig?.pollFrequency,
            timezone: configSections.systemConfig?.timezone,
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
