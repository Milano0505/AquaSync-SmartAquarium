import cors from "cors";
import "dotenv/config";
import express from "express";
import { queryDatabase } from "./config/database.js";
import aquariumRoutes from "./routes/aquariums.js";
import authRoutes from "./routes/auth.js";
import hardwareRoutes from "./routes/hardware.js";
import userRoutes from "./routes/users.js";
import { startDeviceWatchdog } from "./utils/device-watchdog.js";

// konfigurasi server
const app = express();
const port = Number(process.env.PORT) || 3000;
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

// middleware cors
app.use(
    cors({
        origin(origin, callback) {
            if (!origin || process.env.NODE_ENV !== "production" || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error("This origin is not allowed by the API CORS policy."));
        },
    }),
);
app.use(express.json({ limit: "1mb" }));
// body default
app.use((req, res, next) => {
    req.body ||= {};
    next();
});

// route API
app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/aquariums", aquariumRoutes);
app.use("/api/hardware", hardwareRoutes);

// handler 404
app.use((req, res) => res.status(404).json({ message: "API endpoint was not found." }));

// handler error
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error("API request failed:", error.message);
    return res.status(status).json({
        message: status >= 500 ? "An unexpected server error occurred." : error.message,
    });
});

// jalankan server
app.listen(port, () => {
    console.log(`Smart Aquarium API listening on port ${port}`);
    // cek db
    queryDatabase("select 1")
        .then(() => console.log("Database connected"))
        .catch(error => console.error("Database connection failed:", error.message));
    startDeviceWatchdog();
});
