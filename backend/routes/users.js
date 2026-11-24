import { Router } from "express";
import { queryDatabase, runInTransaction } from "../config/database.js";
import { requireUserAuth } from "../middleware/auth.js";
import { isUuid } from "../utils/access-roles.js";
import { addUserNotification } from "../utils/notification-records.js";
import { isValidProfilePhotoUrl } from "../utils/profile-photo-validation.js";

// router user
const userRouter = Router();
userRouter.use(requireUserAuth);

// profil user
function toUserProfileResponse(row) {
    return {
        id: row.id,
        userId: row.id,
        fullName: row.full_name,
        email: row.email,
        photoUrl: row.photo_url ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// cek profil
function isOwnProfileRequest(req) {
    return req.params.userId === req.authUser.userId;
}

// baca profil
userRouter.get("/:userId", async (req, res) => {
    if (!isOwnProfileRequest(req)) {
        return res.status(403).json({ message: "You cannot access this user profile." });
    }
    if (!isUuid(req.params.userId)) return res.status(404).json({ message: "User profile was not found." });

    const { rows } = await queryDatabase("select * from profiles where id = $1", [req.params.userId]);
    if (!rows[0]) return res.status(404).json({ message: "User profile was not found." });
    return res.json(toUserProfileResponse(rows[0]));
});

// ubah profil
userRouter.put("/:userId", async (req, res) => {
    if (!isOwnProfileRequest(req)) return res.status(403).json({ message: "You cannot update this user profile." });

    const profileUpdates = {};
    if (req.body.fullName !== undefined) {
        const fullName = typeof req.body.fullName === "string" ? req.body.fullName.trim() : "";
        if (!fullName || fullName.length > 120) {
            return res.status(400).json({ message: "Full name must be between 1 and 120 characters." });
        }
        profileUpdates.full_name = fullName;
    }
    if (req.body.photoUrl !== undefined) {
        if (!isValidProfilePhotoUrl(req.body.photoUrl)) {
            return res
                .status(400)
                .json({ message: "Profile photo must be a small JPEG data URL, an HTTP(S) URL, or null." });
        }
        profileUpdates.photo_url = req.body.photoUrl;
    }
    if (Object.keys(profileUpdates).length === 0) {
        return res.status(400).json({ message: "No supported profile fields were provided." });
    }

    const profileChanged = await runInTransaction(async client => {
        const { rows } = await client.query("select full_name, photo_url from profiles where id = $1 for update", [
            req.authUser.userId,
        ]);
        const currentProfile = rows[0];
        if (!currentProfile) return null;
        if (Object.keys(profileUpdates).every(column => profileUpdates[column] === currentProfile[column])) {
            return false;
        }

        // kolom tetap
        const columns = Object.keys(profileUpdates);
        const assignments = columns.map((column, index) => `${column} = $${index + 2}`).join(", ");
        await client.query(`update profiles set ${assignments}, updated_at = now() where id = $1`, [
            req.authUser.userId,
            ...columns.map(column => profileUpdates[column]),
        ]);
        await addUserNotification(
            client,
            req.authUser.userId,
            "Profile updated",
            "Your profile information was updated.",
        );
        return true;
    });

    if (profileChanged === null) return res.status(404).json({ message: "User profile was not found." });
    return res.json({
        updatedAt: new Date().toISOString(),
        message: profileChanged ? "Profile updated successfully." : "No profile changes detected.",
    });
});

export default userRouter;
