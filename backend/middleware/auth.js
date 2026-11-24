import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { queryDatabase } from "../config/database.js";
import { createTtlCache } from "../utils/ttl-cache.js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set (contoh di backend/.env.example).");
}

// klien token
const supabaseTokenVerifier = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// cache auth
const verifiedTokenCache = createTtlCache({ ttlMs: 30_000, maxEntries: 200 });
const deviceKeyCache = createTtlCache({ ttlMs: 300_000 });

// hash kunci
export const hashDeviceKey = deviceKey => createHash("sha256").update(deviceKey).digest("hex");

// invalidasi kunci
export const invalidateDeviceKeyCache = () => deviceKeyCache.clear();

// verifikasi token
async function verifyAccessToken(accessToken) {
    const cachedClaims = verifiedTokenCache.get(accessToken);
    if (cachedClaims) return cachedClaims;

    const { data, error } = await supabaseTokenVerifier.auth.getClaims(accessToken);
    const claims = data?.claims;
    if (error || !claims?.sub) return null;
    verifiedTokenCache.set(accessToken, claims);
    return claims;
}

// middleware user
export async function requireUserAuth(req, res, next) {
    const [scheme, accessToken] = (req.get("authorization") || "").split(" ");
    if (scheme !== "Bearer" || !accessToken) {
        return res.status(401).json({ message: "Authentication is required." });
    }

    const claims = await verifyAccessToken(accessToken).catch(() => null);
    if (!claims) return res.status(401).json({ message: "The session token is invalid or expired." });

    req.authUser = {
        userId: claims.sub,
        email: claims.email ? claims.email.toLowerCase() : null,
        name: claims.user_metadata?.full_name || null,
    };
    return next();
}

// middleware kunci
export async function requireDeviceKey(req, res, next) {
    const deviceKey = req.get("x-device-key") || "";
    if (!deviceKey) return res.status(401).json({ message: "A valid device key is required." });

    const keyHash = hashDeviceKey(deviceKey);
    let authDevice = deviceKeyCache.get(keyHash);
    if (authDevice === undefined) {
        const { rows } = await queryDatabase("select id, aquarium_id from devices where key_hash = $1", [keyHash]);
        authDevice = rows[0] ? { deviceId: rows[0].id, aquariumId: rows[0].aquarium_id } : null;
        deviceKeyCache.set(keyHash, authDevice);
    }
    if (!authDevice) return res.status(401).json({ message: "A valid device key is required." });

    req.authDevice = authDevice;
    return next();
}

// middleware akuarium
export function requireDeviceOwnsAquarium(req, res, next) {
    if (req.params.aquariumId !== req.authDevice.aquariumId) {
        return res.status(403).json({ message: "This device key does not belong to this aquarium." });
    }
    return next();
}
