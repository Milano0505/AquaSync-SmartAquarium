// urutan peran
const ROLE_RANK = { viewer: 1, member: 2, owner: 3 };

// peran minimum
export const hasMinimumRole = (role, minimumRole) => (ROLE_RANK[role] || 0) >= ROLE_RANK[minimumRole];

// validasi id
export const isValidAquariumId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);

// validasi uuid
export const isUuid = value =>
    typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
