import { supabaseAuth } from "../supabaseAuth";

// base url
const API_BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");

// access token
async function getAccessToken() {
    const { data } = await supabaseAuth.getSession();
    return data.session?.access_token ?? null;
}

// auth lock
let authInProgress = false;
// cek auth
export const isAuthInProgress = () => authInProgress;

// auth task
async function runWithAuthInProgress(task) {
    authInProgress = true;
    try {
        return await task();
    } finally {
        authInProgress = false;
    }
}

// aquarium path
function buildAquariumPath(aquariumId) {
    if (!aquariumId) throw new Error("No aquarium is selected.");
    return `/api/aquariums/${encodeURIComponent(aquariumId)}`;
}

// query string
function buildQueryString(parameters) {
    const query = new URLSearchParams();
    Object.entries(parameters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
    });
    const serialized = query.toString();
    return serialized ? `?${serialized}` : "";
}

// raw request
async function requestRaw(path, options = {}) {
    const token = await getAccessToken();
    let response;
    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...options.headers,
            },
        });
    } catch {
        throw new Error("Unable to connect to the API. Check that the backend is running.");
    }

    const isJson = (response.headers.get("content-type") || "").includes("application/json");
    const body = isJson ? await response.json().catch(() => null) : await response.text();

    if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new Event("sa:unauthorized"));
        const error = new Error(body?.message || response.statusText || "Request failed.");
        error.status = response.status;
        throw error;
    }

    return { response, body };
}

// request body
async function requestBody(path, options = {}) {
    const { body } = await requestRaw(path, options);
    return body;
}

// send json
const sendJson = (method, path, payload) =>
    requestBody(path, { method, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });

// get fallback
async function getOrFallbackOn404(path, fallback) {
    try {
        return await requestBody(path);
    } catch (error) {
        if (error.status === 404) return fallback;
        throw error;
    }
}

// auth errors
const AUTH_ERROR_MESSAGES = [
    [/invalid login credentials/i, "Invalid email or password."],
    [/already registered|already been registered/i, "An account with this email already exists."],
    [/password.*(at least|should be|weak)/i, "Password must be at least 6 characters."],
    [/valid email|invalid.*email/i, "Enter a valid email address."],
    [/rate limit|too many/i, "Too many attempts. Please try again later."],
    [/email not confirmed/i, "Confirm your email first. Check your inbox for the confirmation link."],
    [/failed to fetch|network/i, "Unable to reach Supabase. Check your connection."],
];

// auth error
function toAuthError(error) {
    const match = AUTH_ERROR_MESSAGES.find(([pattern]) => pattern.test(error.message || ""));
    return new Error(match ? match[1] : error.message || "Authentication failed.");
}

// sync session
export const syncBackendSession = (payload = {}) => sendJson("POST", "/api/auth/session", payload);

// login
export const loginWithEmail = (email, password) =>
    runWithAuthInProgress(async () => {
        const { error } = await supabaseAuth.signInWithPassword({ email, password });
        if (error) throw toAuthError(error);
        return syncBackendSession();
    });

// register
export const registerAccount = ({ fullName, email, password, photoUrl }) =>
    runWithAuthInProgress(async () => {
        const { data, error } = await supabaseAuth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } },
        });
        if (error) throw toAuthError(error);
        if (!data.session) return { userProfile: null, needsConfirmation: true };
        return syncBackendSession({ fullName, photoUrl });
    });

// change password
export async function changePassword({ currentPassword, newPassword }) {
    const { data } = await supabaseAuth.getUser();
    const email = data.user?.email;
    if (!email) throw new Error("You are not signed in.");

    const { error: verifyError } = await supabaseAuth.signInWithPassword({ email, password: currentPassword });
    if (verifyError) throw new Error("Current password is incorrect.");

    const { error } = await supabaseAuth.updateUser({ password: newPassword });
    if (error) throw toAuthError(error);
    await sendJson("POST", "/api/auth/password-changed");
    return { message: "Password updated successfully." };
}

// logout
export const logoutAccount = async () => {
    await supabaseAuth.signOut();
};

// user profile
export const getUserProfile = userId => requestBody(`/api/users/${encodeURIComponent(userId)}`);

// update profile
export const updateUserProfile = (userId, { fullName, photoUrl }) =>
    sendJson("PUT", `/api/users/${encodeURIComponent(userId)}`, { fullName, photoUrl });

// aquarium list
export const getAquariumList = () => requestBody("/api/aquariums");

// aquarium detail
export const getAquariumDetail = async aquariumId => getOrFallbackOn404(buildAquariumPath(aquariumId), null);

// temperature config
export const updateTemperatureConfig = async (aquariumId, payload) =>
    sendJson("PATCH", `${buildAquariumPath(aquariumId)}/temperature-config`, payload);

// lighting config
export const updateLightingConfig = async (aquariumId, payload) =>
    sendJson("PATCH", `${buildAquariumPath(aquariumId)}/lighting-config`, payload);

// feeder config
export const updateFeederConfig = async (aquariumId, payload) =>
    sendJson("PATCH", `${buildAquariumPath(aquariumId)}/feeder-config`, payload);

// system config
export const updateSystemConfig = async (aquariumId, payload) =>
    sendJson("PATCH", `${buildAquariumPath(aquariumId)}/system-config`, payload);

// feeder trigger
export const triggerFeeder = async aquariumId => sendJson("POST", `${buildAquariumPath(aquariumId)}/feeder/trigger`);

// telemetry records
export const getTelemetryRecords = async (aquariumId, { startDate, endDate, limit = 40 } = {}) =>
    getOrFallbackOn404(`${buildAquariumPath(aquariumId)}/telemetry${buildQueryString({ startDate, endDate, limit })}`, {
        telemetryRecords: [],
        total: 0,
    });

// telemetry export
export async function exportTelemetryCsv(aquariumId, { startDate, endDate, format = "csv" } = {}) {
    const { response, body } = await requestRaw(
        `${buildAquariumPath(aquariumId)}/telemetry/export${buildQueryString({ startDate, endDate, format })}`,
    );
    const disposition = response.headers.get("content-disposition") || "";
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "telemetry.csv";
    return { csv: body, filename };
}

// chart data
export function toTemperatureChartData(telemetryRecords) {
    return telemetryRecords
        .filter(record => Number.isFinite(new Date(record.timestamp).getTime()))
        .reverse()
        .map(record => ({
            time: new Date(record.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
            }),
            temp: record.temp,
        }));
}

// notifications
export const getNotifications = async (aquariumId, { limit, readStatus } = {}) =>
    getOrFallbackOn404(`${buildAquariumPath(aquariumId)}/notifications${buildQueryString({ limit, readStatus })}`, {
        notificationRecords: [],
    });

// mark read
export const markNotificationRead = async (aquariumId, notificationId) =>
    sendJson("PATCH", `${buildAquariumPath(aquariumId)}/notifications/${encodeURIComponent(notificationId)}/read`);

// read all
export const markAllNotificationsRead = async aquariumId =>
    sendJson("PATCH", `${buildAquariumPath(aquariumId)}/notifications/read-all`);

// delete notification
export const deleteNotification = async (aquariumId, notificationId) =>
    sendJson("DELETE", `${buildAquariumPath(aquariumId)}/notifications/${encodeURIComponent(notificationId)}`);

// members
export const getAquariumMembers = async aquariumId => requestBody(`${buildAquariumPath(aquariumId)}/members`);

// remove member
export const removeAquariumMember = async (aquariumId, userId) =>
    sendJson("DELETE", `${buildAquariumPath(aquariumId)}/members/${encodeURIComponent(userId)}`);

// leave aquarium
export const leaveAquarium = async aquariumId => sendJson("DELETE", `${buildAquariumPath(aquariumId)}/members/me`);

// aquarium directory
export const getAquariumDirectory = () => requestBody("/api/aquariums/directory");

// create aquarium
export const createAquarium = ({ name, id, deviceName }) =>
    sendJson("POST", "/api/aquariums", { name, id, deviceName });

// rename aquarium
export const renameAquarium = async (aquariumId, name) => sendJson("PATCH", buildAquariumPath(aquariumId), { name });

// delete aquarium
export const deleteAquarium = async aquariumId => sendJson("DELETE", buildAquariumPath(aquariumId));

// claim aquarium
export const claimAquarium = async aquariumId => sendJson("POST", `${buildAquariumPath(aquariumId)}/claim`);

// request join
export const requestToJoinAquarium = async aquariumId =>
    sendJson("POST", `${buildAquariumPath(aquariumId)}/join-requests`);

// cancel join
export const cancelJoinRequest = async aquariumId =>
    sendJson("DELETE", `${buildAquariumPath(aquariumId)}/join-requests/mine`);

// join requests
export const getJoinRequests = async aquariumId => requestBody(`${buildAquariumPath(aquariumId)}/join-requests`);

// approve join
export const approveJoinRequest = async (aquariumId, requestId) =>
    sendJson("POST", `${buildAquariumPath(aquariumId)}/join-requests/${encodeURIComponent(requestId)}/approve`);

// reject join
export const rejectJoinRequest = async (aquariumId, requestId) =>
    sendJson("POST", `${buildAquariumPath(aquariumId)}/join-requests/${encodeURIComponent(requestId)}/reject`);

// device status
export const getAquariumDevice = async aquariumId => requestBody(`${buildAquariumPath(aquariumId)}/device`);

// register device
export const registerAquariumDevice = async (aquariumId, name) =>
    sendJson("POST", `${buildAquariumPath(aquariumId)}/devices`, { name });

// rotate key
export const rotateAquariumDeviceKey = async (aquariumId, deviceId) =>
    sendJson("POST", `${buildAquariumPath(aquariumId)}/devices/${encodeURIComponent(deviceId)}/rotate-key`);

// revoke device
export const revokeAquariumDevice = async (aquariumId, deviceId) =>
    sendJson("DELETE", `${buildAquariumPath(aquariumId)}/devices/${encodeURIComponent(deviceId)}`);
