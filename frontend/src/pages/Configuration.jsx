import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    changePassword,
    getAquariumDetail,
    updateSystemConfig,
    updateTemperatureConfig,
    updateUserProfile,
} from "../api/backendApi";
import { CameraIcon, EyeIcon, EyeOffIcon, LockIcon, LogoutIcon, MailIcon, UserIcon } from "../components/Icons";
import {
    Card,
    ErrorAlert,
    InputField,
    PageHeader,
    PrimaryButton,
    RangeSlider,
    LoadingSpinner,
    SuccessAlert,
    ToggleSwitch,
} from "../components/UiKit";
import RoleBadge from "../components/RoleBadge";
import { useAuth } from "../context/AuthContext";
import { formatTemperature, getInitials } from "../utils/displayFormatters";
import { createProfilePhotoDataUrl } from "../utils/profilePhoto";

// tabs
const CONFIG_TABS = [
    { id: "profile", label: "👤 Profile" },
    { id: "system", label: "⚙️ System" },
    { id: "alerts", label: "🔔 Alerts" },
    { id: "about", label: "ℹ️ About" },
];

// timezones
const TIMEZONE_GROUPS = [
    {
        group: "Southeast Asia",
        zones: [
            ["Asia/Manila", "Asia/Manila — Philippines (GMT+8)"],
            ["Asia/Jakarta", "Asia/Jakarta — WIB Indonesia (GMT+7)"],
            ["Asia/Makassar", "Asia/Makassar — WITA Indonesia (GMT+8)"],
            ["Asia/Jayapura", "Asia/Jayapura — WIT Indonesia (GMT+9)"],
            ["Asia/Singapore", "Asia/Singapore (GMT+8)"],
            ["Asia/Bangkok", "Asia/Bangkok — Thailand (GMT+7)"],
            ["Asia/Kuala_Lumpur", "Asia/Kuala_Lumpur — Malaysia (GMT+8)"],
            ["Asia/Ho_Chi_Minh", "Asia/Ho_Chi_Minh — Vietnam (GMT+7)"],
        ],
    },
    {
        group: "East Asia",
        zones: [
            ["Asia/Tokyo", "Asia/Tokyo — Japan (GMT+9)"],
            ["Asia/Shanghai", "Asia/Shanghai — China (GMT+8)"],
            ["Asia/Seoul", "Asia/Seoul — Korea (GMT+9)"],
        ],
    },
    {
        group: "South Asia",
        zones: [
            ["Asia/Kolkata", "Asia/Kolkata — India (GMT+5:30)"],
            ["Asia/Dhaka", "Asia/Dhaka — Bangladesh (GMT+6)"],
        ],
    },
    {
        group: "Middle East",
        zones: [
            ["Asia/Dubai", "Asia/Dubai — UAE (GMT+4)"],
            ["Asia/Riyadh", "Asia/Riyadh — Saudi Arabia (GMT+3)"],
        ],
    },
    {
        group: "Europe",
        zones: [
            ["Europe/London", "Europe/London (GMT+0/+1)"],
            ["Europe/Paris", "Europe/Paris — CET (GMT+1/+2)"],
            ["Europe/Berlin", "Europe/Berlin — CET (GMT+1/+2)"],
        ],
    },
    {
        group: "Americas",
        zones: [
            ["America/New_York", "America/New_York — EST (GMT-5/-4)"],
            ["America/Chicago", "America/Chicago — CST (GMT-6/-5)"],
            ["America/Los_Angeles", "America/Los_Angeles — PST (GMT-8/-7)"],
            ["America/Sao_Paulo", "America/Sao_Paulo — BRT (GMT-3)"],
        ],
    },
    {
        group: "Pacific / Other",
        zones: [
            ["UTC", "UTC (GMT+0)"],
            ["Pacific/Auckland", "Pacific/Auckland — NZST (GMT+12/+13)"],
            ["Australia/Sydney", "Australia/Sydney — AEST (GMT+10/+11)"],
        ],
    },
];

// features
const ABOUT_FEATURES = [
    ["🌡️", "Temperature monitoring"],
    ["🔥", "Heater control"],
    ["💡", "Lighting control"],
    ["🐟", "Feeding control"],
];

// tech stack
const TECH_STACK = [
    ["Frontend", "React 19 + Tailwind CSS 4"],
    ["Build Tool", "Vite 8"],
    ["Routing", "React Router 7"],
    ["Backend", "Node.js + Express 5"],
    ["Database", "Supabase PostgreSQL"],
    ["Authentication", "Supabase Auth"],
    ["Device API", "HTTP REST API"],
];

// info rows
function InfoRows({ rows }) {
    return rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-4 py-3">
            <span className="text-xs text-slate-500">{label}</span>
            <span className="text-xs font-semibold text-slate-700 text-right">{value}</span>
        </div>
    ));
}

// profile tab
function ProfileTab() {
    const { user, setUser, signOut } = useAuth();
    const navigate = useNavigate();
    const photoFileInputRef = useRef();

    // profile state
    const [fullName, setFullName] = useState(user?.fullName || "");
    const [photoUrl, setPhotoUrl] = useState(user?.photoUrl || null);
    const [profileStatus, setProfileStatus] = useState({ error: "", saved: "" });
    const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [passwordStatus, setPasswordStatus] = useState({ error: "", saved: "" });
    const [isSaving, setIsSaving] = useState(false);

    // save photo
    const savePhoto = async file => {
        setProfileStatus({ error: "", saved: "" });
        setIsSaving(true);
        try {
            const nextPhotoUrl = file ? await createProfilePhotoDataUrl(file) : null;
            await updateUserProfile(user.id, { photoUrl: nextPhotoUrl });
            setUser({ ...user, photoUrl: nextPhotoUrl });
            setPhotoUrl(nextPhotoUrl);
            setProfileStatus({ error: "", saved: nextPhotoUrl ? "Profile photo updated." : "Profile photo removed." });
            window.dispatchEvent(new Event("sa:notifications-changed"));
        } catch (error) {
            setProfileStatus({ error: error.message || "Could not save the profile photo.", saved: "" });
        } finally {
            setIsSaving(false);
        }
    };

    // photo selected
    const handlePhotoSelected = event => {
        const file = event.target.files[0];
        event.target.value = "";
        if (file) savePhoto(file);
    };

    // save profile
    const handleSaveProfile = async () => {
        setProfileStatus({ error: "", saved: "" });
        setIsSaving(true);
        try {
            await updateUserProfile(user.id, { fullName });
            setUser({ ...user, fullName });
            setProfileStatus({ error: "", saved: "Profile updated successfully." });
            window.dispatchEvent(new Event("sa:notifications-changed"));
        } catch (error) {
            setProfileStatus({ error: error.message || "Could not save profile.", saved: "" });
        } finally {
            setIsSaving(false);
        }
    };

    // change password
    const handleChangePassword = async () => {
        const setPasswordError = error => setPasswordStatus({ error, saved: "" });
        if (!passwords.current || !passwords.next) return setPasswordError("Please fill in all fields.");
        if (passwords.next !== passwords.confirm) return setPasswordError("New passwords do not match.");
        if (passwords.next.length < 6) return setPasswordError("Password must be at least 6 characters.");

        setPasswordStatus({ error: "", saved: "" });
        setIsSaving(true);
        try {
            await changePassword({ currentPassword: passwords.current, newPassword: passwords.next });
            setPasswords({ current: "", next: "", confirm: "" });
            setPasswordStatus({ error: "", saved: "Password updated successfully." });
            window.dispatchEvent(new Event("sa:notifications-changed"));
        } catch (error) {
            setPasswordError(error.message || "Could not change password.");
        } finally {
            setIsSaving(false);
        }
    };

    // sign out
    const handleSignOut = async () => {
        try {
            await signOut();
        } catch (error) {
            console.warn("Sign out completed with a storage error.", error);
        } finally {
            navigate("/login", { replace: true });
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <div className="space-y-4">
                <Card className="flex flex-col items-center py-6">
                    <button onClick={() => photoFileInputRef.current?.click()} className="relative group mb-3">
                        <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-blue-200">
                            {photoUrl ? (
                                <img src={photoUrl} alt="avatar" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-blue-500 flex items-center justify-center text-white text-2xl font-bold">
                                    {getInitials(fullName)}
                                </div>
                            )}
                        </div>
                        <div className="absolute inset-0 rounded-full bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <CameraIcon />
                        </div>
                    </button>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            disabled={isSaving}
                            className="text-xs text-blue-500 font-semibold disabled:opacity-50"
                            onClick={() => photoFileInputRef.current?.click()}
                        >
                            {isSaving ? "Saving…" : "Change Photo"}
                        </button>
                        {photoUrl && (
                            <button
                                type="button"
                                disabled={isSaving}
                                className="text-xs text-slate-400 font-semibold hover:text-red-500 disabled:opacity-50"
                                onClick={() => savePhoto(null)}
                            >
                                Remove
                            </button>
                        )}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">JPG, PNG, or WebP up to 10 MB.</p>

                    <input
                        ref={photoFileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoSelected}
                        className="hidden"
                    />
                </Card>

                <Card className="space-y-4">
                    <p className="text-sm font-bold text-slate-700">Change Password</p>
                    <SuccessAlert message={passwordStatus.saved} />
                    <ErrorAlert message={passwordStatus.error} />
                    {[
                        ["current", "Current Password"],
                        ["next", "New Password"],
                        ["confirm", "Confirm New Password"],
                    ].map(([key, label]) => (
                        <InputField
                            key={key}
                            label={label}
                            type={isPasswordVisible ? "text" : "password"}
                            value={passwords[key]}
                            onChange={event => setPasswords(current => ({ ...current, [key]: event.target.value }))}
                            placeholder="••••••••"
                            icon={LockIcon}
                            right={
                                key === "current" && (
                                    <button
                                        type="button"
                                        onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                                        className="text-slate-400 p-1"
                                    >
                                        {isPasswordVisible ? <EyeOffIcon /> : <EyeIcon />}
                                    </button>
                                )
                            }
                        />
                    ))}
                    <PrimaryButton
                        onClick={handleChangePassword}
                        disabled={isSaving}
                        className="bg-slate-800 hover:bg-slate-900"
                    >
                        Update Password
                    </PrimaryButton>
                </Card>
            </div>

            <div className="space-y-4">
                <SuccessAlert message={profileStatus.saved} />
                <ErrorAlert message={profileStatus.error} />
                <Card className="space-y-4">
                    <InputField
                        label="Full Name"
                        value={fullName}
                        onChange={event => setFullName(event.target.value)}
                        icon={UserIcon}
                    />
                    <InputField
                        label="Email Address"
                        type="email"
                        value={user?.email || ""}
                        icon={MailIcon}
                        readOnly
                        hint="Email is used to sign in and cannot be changed."
                    />
                    <PrimaryButton onClick={handleSaveProfile} disabled={isSaving}>
                        {isSaving ? "Saving…" : "Save Profile"}
                    </PrimaryButton>
                </Card>

                <button
                    onClick={handleSignOut}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-red-50 text-red-600 border border-red-200 font-semibold rounded-xl hover:bg-red-100 transition-colors text-sm"
                >
                    <LogoutIcon /> Sign Out
                </button>
            </div>
        </div>
    );
}

// system tab
function SystemTab({ aquarium, updateAquariumSection, isSaving, onSaveSettings }) {
    const { tempConfig, systemConfig } = aquarium;
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <Card className="space-y-4">
                <p className="text-sm font-bold text-slate-700">Temperature Unit</p>
                <div className="flex gap-2">
                    {["Celsius", "Fahrenheit"].map(unit => (
                        <button
                            key={unit}
                            onClick={() => updateAquariumSection("tempConfig", { unit })}
                            className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-colors ${
                                tempConfig.unit === unit
                                    ? "bg-blue-500 text-white"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                        >
                            {unit === "Celsius" ? "°C Celsius" : "°F Fahrenheit"}
                        </button>
                    ))}
                </div>

                <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Timezone</label>
                    <select
                        value={systemConfig.timezone}
                        onChange={event => updateAquariumSection("systemConfig", { timezone: event.target.value })}
                        className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    >
                        {TIMEZONE_GROUPS.map(({ group, zones }) => (
                            <optgroup key={group} label={group}>
                                {zones.map(([value, label]) => (
                                    <option key={value} value={value}>
                                        {label}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                </div>
            </Card>

            <Card className="space-y-4">
                <div>
                    <p className="text-sm font-bold text-slate-700">Data Send Interval</p>
                </div>
                <RangeSlider
                    label="Send interval"
                    valueLabel={`${systemConfig.pollFrequency}s`}
                    value={systemConfig.pollFrequency}
                    min={1}
                    max={60}
                    minLabel="1s"
                    maxLabel="60s"
                    onChange={pollFrequency => updateAquariumSection("systemConfig", { pollFrequency })}
                />
                <PrimaryButton onClick={onSaveSettings} disabled={isSaving}>
                    {isSaving ? "Saving…" : "Save System Settings"}
                </PrimaryButton>
            </Card>
        </div>
    );
}

// notification hint
function getBrowserNotificationHint({ isSupported, permission, isEnabled }) {
    if (!isSupported) return "Notifications are not supported by this browser.";
    if (permission === "denied") return "Permission is blocked in browser settings.";
    return isEnabled ? "Enabled while the dashboard is open." : "Notifications are off.";
}

// alerts tab
function AlertsTab({
    aquarium,
    updateAquariumSection,
    isSaving,
    onSaveSettings,
    browserNotifications,
    onToggleBrowserNotifications,
}) {
    const { tempConfig } = aquarium;
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <Card className="space-y-5">
                <div>
                    <p className="text-sm font-bold text-slate-700">Temperature Thresholds</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                        An alert is created when the water temperature leaves this range. These limits do not set the
                        heater target or control the heater.
                    </p>
                </div>
                <RangeSlider
                    label="Min Temperature"
                    valueLabel={formatTemperature(tempConfig.minTempThreshold, tempConfig.unit)}
                    value={tempConfig.minTempThreshold}
                    min={10}
                    max={25}
                    minLabel={formatTemperature(10, tempConfig.unit)}
                    maxLabel={formatTemperature(25, tempConfig.unit)}
                    onChange={minTempThreshold => updateAquariumSection("tempConfig", { minTempThreshold })}
                />
                <RangeSlider
                    label="Max Temperature"
                    valueLabel={formatTemperature(tempConfig.maxTempThreshold, tempConfig.unit)}
                    value={tempConfig.maxTempThreshold}
                    min={22}
                    max={35}
                    color="#ef4444"
                    minLabel={formatTemperature(22, tempConfig.unit)}
                    maxLabel={formatTemperature(35, tempConfig.unit)}
                    onChange={maxTempThreshold => updateAquariumSection("tempConfig", { maxTempThreshold })}
                />
                <PrimaryButton onClick={onSaveSettings} disabled={isSaving}>
                    {isSaving ? "Saving…" : "Save Temperature Thresholds"}
                </PrimaryButton>
            </Card>

            <Card className="space-y-4">
                <p className="text-sm font-bold text-slate-700">Notification Channels</p>
                <div className="flex items-center justify-between gap-4 py-3">
                    <div>
                        <div className="text-sm font-semibold text-slate-700">Browser Notifications</div>
                    </div>
                    <ToggleSwitch
                        checked={browserNotifications.isEnabled}
                        disabled={!browserNotifications.isSupported}
                        label="Browser Notifications"
                        onChange={onToggleBrowserNotifications}
                    />
                </div>
                <p className="text-xs text-slate-400">{getBrowserNotificationHint(browserNotifications)}</p>
            </Card>
        </div>
    );
}

// about tab
function AboutTab() {
    const { aquariums, isAdmin } = useAuth();
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            {/* aquarium list */}
            <Card className="space-y-3 md:col-span-2">
                <p className="text-sm font-bold text-slate-700">{isAdmin ? "All aquariums" : "Your aquariums"}</p>
                {aquariums.length === 0 ? (
                    <p className="text-sm text-slate-400">
                        {isAdmin ? "No aquariums yet. Create one in Access." : "You have no aquarium yet."}
                    </p>
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {aquariums.map(item => (
                            <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-slate-800">{item.name}</div>
                                    <div className="truncate font-mono text-xs text-slate-400">{item.id}</div>
                                </div>
                                <RoleBadge role={item.role} />
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            <Card className="space-y-4">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-500 flex items-center justify-center text-white text-xl flex-shrink-0">
                        🐟
                    </div>
                    <div>
                        <div className="font-bold text-slate-800">Smart Aquarium</div>
                        <div className="text-xs text-slate-400">Version 1.0.0 · Web Dashboard</div>
                    </div>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                    Web dashboard to monitor and control an ESP32-based smart aquarium.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-1 gap-2 border-t border-slate-100 pt-4">
                    {ABOUT_FEATURES.map(([icon, title]) => (
                        <div key={title} className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                            <span>{icon}</span>
                            {title}
                        </div>
                    ))}
                </div>
            </Card>

            <Card className="divide-y divide-slate-50">
                <p className="text-sm font-bold text-slate-700 pb-3">Technology Stack</p>
                <InfoRows rows={TECH_STACK} />
            </Card>
        </div>
    );
}

// configuration page
export default function ConfigurationPage({ browserNotifications }) {
    const { activeAquariumId, canControlAquarium, isViewer } = useAuth();
    // state
    const [activeTab, setActiveTab] = useState("profile");
    const [aquarium, setAquarium] = useState(null);
    const [isLoading, setIsLoading] = useState(Boolean(activeAquariumId));
    const [loadError, setLoadError] = useState("");
    const [isSettingsSaving, setIsSettingsSaving] = useState(false);
    const [settingsStatus, setSettingsStatus] = useState({ error: "", saved: "" });

    // fetch aquarium
    useEffect(() => {
        if (!activeAquariumId) return undefined;
        let isMounted = true;
        getAquariumDetail(activeAquariumId)
            .then(aquariumDetail => isMounted && setAquarium(aquariumDetail))
            .catch(error => isMounted && setLoadError(error.message || "Could not load configuration."))
            .finally(() => isMounted && setIsLoading(false));
        return () => {
            isMounted = false;
        };
    }, [activeAquariumId]);

    // local update
    const updateAquariumSection = (section, patch) =>
        setAquarium(current => ({ ...current, [section]: { ...current[section], ...patch } }));

    // save settings
    const saveSettings = async (save, successMessage, failureMessage) => {
        setSettingsStatus({ error: "", saved: "" });
        setIsSettingsSaving(true);
        try {
            await save();
            setSettingsStatus({ error: "", saved: successMessage });
            window.dispatchEvent(new Event("sa:notifications-changed"));
        } catch (error) {
            setSettingsStatus({ error: error.message || failureMessage, saved: "" });
        } finally {
            setIsSettingsSaving(false);
        }
    };

    // save system
    const handleSaveSystemSettings = () =>
        saveSettings(
            () =>
                updateSystemConfig(activeAquariumId, {
                    unit: aquarium.tempConfig.unit,
                    pollFrequency: aquarium.systemConfig.pollFrequency,
                    timezone: aquarium.systemConfig.timezone,
                }),
            "System settings saved successfully.",
            "Could not save system settings.",
        );

    // save thresholds
    const handleSaveTemperatureThresholds = () =>
        saveSettings(
            () =>
                updateTemperatureConfig(activeAquariumId, {
                    minTempThreshold: aquarium.tempConfig.minTempThreshold,
                    maxTempThreshold: aquarium.tempConfig.maxTempThreshold,
                }),
            "Alert settings saved successfully.",
            "Could not save alert settings.",
        );

    // toggle notifications
    const handleToggleBrowserNotifications = async shouldEnable => {
        setSettingsStatus({ error: "", saved: "" });
        try {
            const permission = await browserNotifications.setBrowserNotificationsEnabled(shouldEnable);
            if (permission === "unsupported") {
                setSettingsStatus({ error: "This browser does not support browser notifications.", saved: "" });
            } else if (permission === "denied") {
                setSettingsStatus({
                    error: "Notifications are blocked for this site. Allow them in your browser settings.",
                    saved: "",
                });
            } else {
                setSettingsStatus({
                    error: "",
                    saved: shouldEnable ? "Browser notifications enabled." : "Browser notifications disabled.",
                });
            }
        } catch (error) {
            setSettingsStatus({ error: error.message || "Could not update browser notifications.", saved: "" });
        }
    };

    // aquarium tab
    const renderAquariumSettingsTab = () => {
        if (!activeAquariumId) {
            return <p className="py-8 text-center text-sm text-slate-400">No aquarium is selected.</p>;
        }
        if (isLoading) return <LoadingSpinner />;
        if (loadError) return <ErrorAlert message={loadError} />;
        if (!aquarium) return <p className="py-8 text-center text-sm text-slate-400">No Data</p>;

        return (
            <>
                {isViewer && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                        You have view-only access. Ask an admin to give you a role to change settings.
                    </div>
                )}
                {/* disable controls */}
                <fieldset disabled={!canControlAquarium} className="m-0 min-w-0 border-0 p-0">
                    {activeTab === "system" && (
                        <SystemTab
                            aquarium={aquarium}
                            updateAquariumSection={updateAquariumSection}
                            isSaving={isSettingsSaving}
                            onSaveSettings={handleSaveSystemSettings}
                        />
                    )}
                    {activeTab === "alerts" && (
                        <AlertsTab
                            aquarium={aquarium}
                            updateAquariumSection={updateAquariumSection}
                            isSaving={isSettingsSaving}
                            onSaveSettings={handleSaveTemperatureThresholds}
                            browserNotifications={browserNotifications}
                            onToggleBrowserNotifications={handleToggleBrowserNotifications}
                        />
                    )}
                </fieldset>
            </>
        );
    };

    return (
        <div className="px-4 py-5">
            <PageHeader title="Configuration" timezone={aquarium?.systemConfig?.timezone} />
            {(settingsStatus.error || settingsStatus.saved) && (
                <div className="mb-4 space-y-2" aria-live="polite">
                    <ErrorAlert message={settingsStatus.error} />
                    <SuccessAlert message={settingsStatus.saved} />
                </div>
            )}

            <div className="flex gap-2 overflow-x-auto pb-1 mb-5" style={{ scrollbarWidth: "none" }}>
                {CONFIG_TABS.map(item => (
                    <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-semibold transition-all ${
                            activeTab === item.id
                                ? "bg-blue-500 text-white shadow-sm"
                                : "bg-white border border-slate-200 text-slate-600"
                        }`}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {activeTab === "profile" && <ProfileTab />}
            {(activeTab === "system" || activeTab === "alerts") && renderAquariumSettingsTab()}
            {activeTab === "about" && <AboutTab />}
        </div>
    );
}
