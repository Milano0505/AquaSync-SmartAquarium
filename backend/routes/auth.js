import { Router } from "express";
import { queryDatabase, runInTransaction } from "../config/database.js";
import { requireUserAuth } from "../middleware/auth.js";
import { addUserNotification } from "../utils/notification-records.js";
import { isValidProfilePhotoUrl } from "../utils/profile-photo-validation.js";

// router auth
const authRouter = Router();

// profil sesi
function toSessionProfile(row) {
    return {
        id: row.id,
        userId: row.id,
        fullName: row.full_name,
        email: row.email,
        photoUrl: row.photo_url ?? null,
        createdAt: row.created_at,
    };
}

// route sesi
authRouter.post("/session", requireUserAuth, async (req, res) => {
    const { userId, email } = req.authUser;
    if (!email) return res.status(400).json({ message: "The account has no email address." });

    const fullName =
        typeof req.body.fullName === "string" && req.body.fullName.trim()
            ? req.body.fullName.trim()
            : req.authUser.name || email.split("@")[0];
    const photoUrl = req.body.photoUrl ?? null;
    if (fullName.length > 120) return res.status(400).json({ message: "Full name must be at most 120 characters." });
    if (!isValidProfilePhotoUrl(photoUrl)) {
        return res
            .status(400)
            .json({ message: "Profile photo must be a small JPEG data URL, an HTTP(S) URL, or null." });
    }

    const profileRow = await runInTransaction(async client => {
        // pastikan profil
        await client.query(
            `insert into profiles (id, full_name, email) values ($1, $2, $3) on conflict (id) do nothing`,
            [userId, fullName.slice(0, 120), email],
        );
        const { rows } = await client.query(
            `update profiles
             set photo_url = coalesce($2, photo_url),
                 updated_at = case when $2 is not null then now() else updated_at end
             where id = $1
             returning *`,
            [userId, photoUrl],
        );
        return rows[0];
    });

    return res.json({ userId, userProfile: toSessionProfile(profileRow) });
});

// ganti password
authRouter.post("/password-changed", requireUserAuth, async (req, res) => {
    await addUserNotification(
        { query: queryDatabase },
        req.authUser.userId,
        "Password updated",
        "Your account password was changed.",
    );
    return res.json({ message: "Password change recorded." });
});

export default authRouter;
