import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    getAquariumDetail,
    getNotifications,
    getTelemetryRecords,
    toTemperatureChartData,
    triggerFeeder,
    updateFeederConfig,
    updateLightingConfig,
    updateTemperatureConfig,
} from "../api/backendApi";
import TemperatureAreaChart from "../components/TemperatureAreaChart";
import { PlusIcon, TrashIcon } from "../components/Icons";
import {
    Card,
    ErrorAlert,
    InfoField,
    LiveClock,
    ModeSelector,
    PageHeader,
    RangeSlider,
    LoadingSpinner,
    StatusBadge,
    ToggleSwitch,
} from "../components/UiKit";
import { useAuth } from "../context/AuthContext";
import {
    formatTemperature,
    formatTemperatureValue,
    formatRelativeTime,
    getTemperatureUnitSymbol,
} from "../utils/displayFormatters";

// tabs
const DASHBOARD_TABS = [
    { id: "overview", label: "Overview" },
    { id: "temperature", label: "Temperature" },
    { id: "lighting", label: "Lighting" },
    { id: "feeder", label: "Feeder" },
];

// notification colors
const NOTIFICATION_COLORS = {
    alert: { dot: "bg-red-500", bg: "bg-red-50", text: "text-red-700" },
    info: { dot: "bg-blue-500", bg: "bg-blue-50", text: "text-blue-700" },
    success: { dot: "bg-green-500", bg: "bg-green-50", text: "text-green-700" },
};

// empty state
const EMPTY_REALTIME_STATE = {
    currentTemp: null,
    heaterStatus: "OFF",
    ledStatus: "OFF",
    feederStatus: "Idle",
    lastUpdated: null,
};
// default target
const DEFAULT_TARGET_TEMP = 24;
// refresh interval
const DASHBOARD_REFRESH_SECONDS = 10;
// fast refresh
const DASHBOARD_FAST_REFRESH_SECONDS = 2.5;
// fast refresh limit
const DASHBOARD_FAST_REFRESH_MAX_SECONDS = 90;

// hour options
const SCHEDULE_HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
// minute options
const SCHEDULE_MINUTES = ["00", "15", "30", "45"];

// day minutes
function toMinutesOfDay(time) {
    const [clock, period] = time.split(" ");
    const [hour, minute] = clock.split(":").map(Number);
    return ((hour % 12) + (period === "PM" ? 12 : 0)) * 60 + minute;
}

// schedule duration
function calculateScheduleDurationHours(startTime, endTime) {
    return Math.round((((toMinutesOfDay(endTime) - toMinutesOfDay(startTime) + 1440) % 1440) / 60) * 100) / 100;
}

// format hours
const formatHours = hours => (Number.isFinite(hours) ? `${hours} hrs` : "--");
// mode label
const formatModeLabel = mode => (mode === "MANUAL" ? "Manual" : "Automatic");
// timestamp ms
const toTimestampMs = value => (value ? new Date(value).getTime() : NaN);

// device online
function checkDeviceOnline(lastUpdated, pollFrequency) {
    const last = toTimestampMs(lastUpdated);
    if (!Number.isFinite(last)) return false;
    return Date.now() - last <= Math.max(60, 3 * (pollFrequency || 5)) * 1000;
}

// feed pending
function isFeedPending(lastTriggeredAt, lastUpdated) {
    const triggered = toTimestampMs(lastTriggeredAt);
    if (!Number.isFinite(triggered)) return false;
    const updated = toTimestampMs(lastUpdated);
    return !Number.isFinite(updated) || triggered > updated;
}

// awaiting device
function isAwaitingDevice(aquarium) {
    const { tempConfig, lightingConfig, feederConfig, realtimeState } = aquarium;
    const lastUpdated = realtimeState?.lastUpdated;
    if (!checkDeviceOnline(lastUpdated, aquarium.systemConfig?.pollFrequency)) return false;
    return (
        isFeedPending(feederConfig?.lastTriggeredAt, lastUpdated) ||
        (tempConfig?.mode === "MANUAL" && tempConfig.manualControlState !== realtimeState?.heaterStatus) ||
        (lightingConfig?.mode === "MANUAL" && lightingConfig.manualControlState !== realtimeState?.ledStatus)
    );
}

// time select
function TimeSelect({ label, value, onChange }) {
    const [clock, period] = value.split(" ");
    const [hour, minute] = clock.split(":");
    const minuteOptions = SCHEDULE_MINUTES.includes(minute) ? SCHEDULE_MINUTES : [...SCHEDULE_MINUTES, minute].sort();
    const selectClass =
        "flex-1 min-w-0 py-2 text-center text-sm font-semibold text-slate-800 border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400";
    const selects = [
        ["hour", hour, SCHEDULE_HOURS, next => `${next}:${minute} ${period}`],
        ["minute", minute, minuteOptions, next => `${hour}:${next} ${period}`],
        ["period", period, ["AM", "PM"], next => `${hour}:${minute} ${next}`],
    ];
    return (
        <div>
            <div className="text-xs text-slate-400 mb-1">{label}</div>
            <div className="flex items-center gap-1">
                {selects.map(([part, current, options, build]) => (
                    <select
                        key={part}
                        aria-label={`${label} ${part}`}
                        value={current}
                        onChange={event => onChange(build(event.target.value))}
                        className={selectClass}
                    >
                        {options.map(option => (
                            <option key={option} value={option}>
                                {option}
                            </option>
                        ))}
                    </select>
                ))}
            </div>
        </div>
    );
}

// add modal
function AddFeedingTimeModal({ onAddSchedule, onClose }) {
    const [hour, setHour] = useState("08");
    const [minute, setMinute] = useState("00");
    const [period, setPeriod] = useState("AM");
    const overlayRef = useRef();
    const bigSelectClass =
        "flex-1 py-4 text-center text-2xl font-bold text-slate-800 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400";

    // add schedule
    const handleAddSchedule = () => {
        onAddSchedule(`${hour}:${minute} ${period}`);
        onClose();
    };

    return (
        <div
            ref={overlayRef}
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={event => event.target === overlayRef.current && onClose()}
        >
            <div className="w-full max-w-sm bg-white rounded-t-3xl md:rounded-2xl shadow-2xl px-6 pt-6 pb-8 md:mx-4">
                <div className="flex items-center justify-between mb-5">
                    <div>
                        <h3 className="text-base font-bold text-slate-800">Add Feeding Time</h3>
                        <p className="text-xs text-slate-400">Set a daily schedule trigger</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors text-lg font-bold"
                    >
                        ×
                    </button>
                </div>

                <div className="flex items-center justify-center gap-2 mb-6">
                    <select value={hour} onChange={event => setHour(event.target.value)} className={bigSelectClass}>
                        {SCHEDULE_HOURS.map(hourOption => (
                            <option key={hourOption} value={hourOption}>
                                {hourOption}
                            </option>
                        ))}
                    </select>
                    <span className="text-2xl font-bold text-slate-400">:</span>
                    <select value={minute} onChange={event => setMinute(event.target.value)} className={bigSelectClass}>
                        {SCHEDULE_MINUTES.map(minuteOption => (
                            <option key={minuteOption} value={minuteOption}>
                                {minuteOption}
                            </option>
                        ))}
                    </select>
                    <div className="flex flex-col gap-1">
                        {["AM", "PM"].map(periodOption => (
                            <button
                                key={periodOption}
                                onClick={() => setPeriod(periodOption)}
                                className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
                                    period === periodOption
                                        ? "bg-blue-500 text-white"
                                        : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                }`}
                            >
                                {periodOption}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="text-center mb-5">
                    <span className="text-3xl font-bold text-blue-600">
                        {hour}:{minute} {period}
                    </span>
                    <p className="text-xs text-slate-400 mt-1">Feeder will activate daily at this time</p>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleAddSchedule}
                        className="flex-1 py-3 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors"
                    >
                        Add Schedule
                    </button>
                </div>
            </div>
        </div>
    );
}

// device badge
function DeviceOnlineBadge({ isOnline, lastUpdated }) {
    return (
        <span
            title={`Last update: ${formatRelativeTime(lastUpdated)}`}
            className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                isOnline ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"
            }`}
        >
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-green-500" : "bg-slate-400"}`} />
            {isOnline ? "Device online" : lastUpdated ? "Device offline" : "No device data"}
        </span>
    );
}

// manual control
function ManualControlPanel({
    state,
    control,
    isManual,
    isBusy,
    isPending,
    isOnline,
    onTurnOn,
    onTurnOff,
    turnOnLabel = "Turn On",
}) {
    const disabled = !isManual || isBusy;
    // button style
    const buttonClass = primary =>
        `py-3 rounded-xl text-sm font-semibold transition-colors ${
            disabled
                ? "bg-slate-100 text-slate-300 cursor-not-allowed"
                : primary
                  ? "bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 active:bg-slate-100"
        }`;
    return (
        <div>
            <div className="grid grid-cols-2 gap-2 mb-3">
                <InfoField label="Current State" value={state} />
                <InfoField label="Control" value={control} />
            </div>
            {!isManual && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                    Switch to Manual mode to control this device manually.
                </p>
            )}
            {isManual && isPending && (
                <p
                    className={`text-xs rounded-lg px-3 py-2 mb-3 border ${
                        isOnline
                            ? "text-blue-600 bg-blue-50 border-blue-200"
                            : "text-amber-600 bg-amber-50 border-amber-200"
                    }`}
                >
                    {isOnline
                        ? "⏳ Waiting for the device to apply this command…"
                        : "⚠️ Device is offline. The command will run when it reconnects."}
                </p>
            )}
            <div className={`grid gap-2 ${onTurnOff ? "grid-cols-2" : "grid-cols-1"}`}>
                <button onClick={onTurnOn} disabled={disabled} className={buttonClass(true)}>
                    {turnOnLabel}
                </button>
                {onTurnOff && (
                    <button onClick={onTurnOff} disabled={disabled} className={buttonClass(false)}>
                        Turn Off
                    </button>
                )}
            </div>
        </div>
    );
}

// overview tab
function OverviewTab({ aquarium, realtimeState, chartData, recentTelemetry, recentNotifications }) {
    const navigate = useNavigate();
    const { unit } = aquarium.tempConfig;
    const hasTemp = realtimeState.currentTemp !== null && realtimeState.currentTemp !== undefined;
    const chartTemps = chartData.map(point => point.temp);

    return (
        <div className="space-y-4">
            <Card>
                <p className="text-xs font-semibold text-slate-500 mb-1">Real-time water temperature</p>
                <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-5xl font-bold text-blue-600">
                        {formatTemperatureValue(realtimeState.currentTemp, unit)}
                    </span>
                    {hasTemp && (
                        <span className="text-xl text-blue-400 font-semibold">{getTemperatureUnitSymbol(unit)}</span>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <InfoField
                        label="Target temperature"
                        value={formatTemperature(aquarium.tempConfig.targetTemp, unit)}
                    />
                    <InfoField label="Last update" value={formatRelativeTime(realtimeState.lastUpdated)} />
                </div>
            </Card>

            <Card>
                <p className="text-sm font-semibold text-slate-700 mb-3">System Status</p>
                <div className="space-y-2.5">
                    {[
                        ["Heater", "🌡️", realtimeState.heaterStatus],
                        ["Aquarium LED", "💡", realtimeState.ledStatus],
                        ["Auto Feeder", "🐟", realtimeState.feederStatus],
                    ].map(([label, icon, status]) => (
                        <div
                            key={label}
                            className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0"
                        >
                            <div className="flex items-center gap-2 text-sm text-slate-700">
                                <span>{icon}</span>
                                {label}
                            </div>
                            <StatusBadge status={status} />
                        </div>
                    ))}
                </div>
            </Card>

            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
                    <div>
                        <p className="text-xs font-semibold text-slate-500">Temperature Monitor · Last 12 readings</p>
                        <span className="text-3xl font-bold text-blue-600">
                            {formatTemperatureValue(realtimeState.currentTemp, unit)}{" "}
                            {hasTemp && (
                                <span className="text-base text-blue-400">{getTemperatureUnitSymbol(unit)}</span>
                            )}
                        </span>
                    </div>
                    {chartData.length > 0 && (
                        <div className="grid grid-cols-3 gap-3 text-center">
                            {[
                                ["High", Math.max(...chartTemps)],
                                ["Low", Math.min(...chartTemps)],
                                ["Avg", chartTemps.reduce((sum, temp) => sum + temp, 0) / chartTemps.length],
                            ].map(([label, value]) => (
                                <div key={label}>
                                    <div className="text-xs font-bold text-blue-500">
                                        {formatTemperature(+value.toFixed(1), unit)}
                                    </div>
                                    <div className="text-[10px] text-slate-400">{label}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <TemperatureAreaChart data={chartData} height={220} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold text-slate-700">Recent Data</p>
                        <button
                            onClick={() => navigate("/history")}
                            className="text-xs text-blue-500 font-semibold hover:underline"
                        >
                            View all
                        </button>
                    </div>
                    <div className="space-y-2">
                        {recentTelemetry.length === 0 && <p className="text-xs text-slate-400">No Data</p>}
                        {recentTelemetry.map(record => (
                            <div
                                key={record.id}
                                className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0"
                            >
                                <div className="min-w-0">
                                    <div className="text-xs font-semibold text-slate-700 truncate">{record.event}</div>
                                    <div className="text-[10px] text-slate-400">
                                        {formatRelativeTime(record.timestamp)}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                    <span className="text-sm font-bold text-blue-600">
                                        {formatTemperature(record.temp, unit)}
                                    </span>
                                    <StatusBadge status={record.heaterState} />
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card>
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold text-slate-700">Recent Alerts</p>
                        <button
                            onClick={() => navigate("/notifications")}
                            className="text-xs text-blue-500 font-semibold hover:underline"
                        >
                            View all
                        </button>
                    </div>
                    <div className="space-y-2">
                        {recentNotifications.length === 0 && <p className="text-xs text-slate-400">No Data</p>}
                        {recentNotifications.map(notification => {
                            const colors = NOTIFICATION_COLORS[notification.type] || NOTIFICATION_COLORS.info;
                            return (
                                <div
                                    key={notification.id}
                                    className="flex items-start gap-2 py-2 border-b border-slate-50 last:border-0"
                                >
                                    <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${colors.dot}`} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1 flex-wrap">
                                            <span className="text-xs font-semibold text-slate-700 truncate">
                                                {notification.title}
                                            </span>
                                            {!notification.isRead && (
                                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                                            )}
                                        </div>
                                        <div className="text-[10px] text-slate-400">
                                            {formatRelativeTime(notification.timestamp)}
                                        </div>
                                    </div>
                                    <span
                                        className={`flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text}`}
                                    >
                                        {notification.type}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </Card>
            </div>
        </div>
    );
}

// temperature tab
function TemperatureTab({ aquarium, realtimeState, isDeviceOnline, saveAquariumSection, isSaving }) {
    const { tempConfig, hardwareInfo } = aquarium;
    const isManual = tempConfig.mode === "MANUAL";
    // draft state
    const [targetDraft, setTargetDraft] = useState(null);
    const targetTemp = targetDraft ?? tempConfig.targetTemp;
    // save config
    const saveTemperatureConfig = patch => saveAquariumSection("tempConfig", patch, updateTemperatureConfig);
    // save target
    const saveTargetTemp = async () => {
        if (await saveTemperatureConfig({ targetTemp })) setTargetDraft(null);
    };

    return (
        <div className="space-y-4">
            <Card>
                <p className="text-xs font-semibold text-slate-500 mb-1">Live Water Temperature</p>
                <div className="text-4xl font-bold text-blue-600 mb-3">
                    {formatTemperature(realtimeState.currentTemp, tempConfig.unit)}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <InfoField label="Last Update" value={formatRelativeTime(realtimeState.lastUpdated)} />
                    <InfoField label="Sensor" value={hardwareInfo?.tempSensor} />
                </div>
            </Card>

            <Card>
                <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-slate-500">Heater Status</p>
                    <StatusBadge status={realtimeState.heaterStatus} />
                </div>
                <div
                    className={`text-3xl font-bold mb-3 ${
                        realtimeState.heaterStatus === "ON" ? "text-green-500" : "text-slate-300"
                    }`}
                >
                    {realtimeState.heaterStatus}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <InfoField label="Mode" value={formatModeLabel(tempConfig.mode)} />
                    <InfoField label="Last Update" value={formatRelativeTime(realtimeState.lastUpdated)} />
                </div>
            </Card>

            <Card>
                <p className="text-sm font-semibold text-slate-700 mb-3">Target Temperature</p>
                <RangeSlider
                    label="Target"
                    valueLabel={formatTemperature(targetTemp, tempConfig.unit)}
                    value={targetTemp}
                    min={18}
                    max={30}
                    step={0.5}
                    minLabel={formatTemperature(18, tempConfig.unit)}
                    maxLabel={formatTemperature(30, tempConfig.unit)}
                    disabled={!Number.isFinite(targetTemp)}
                    onChange={setTargetDraft}
                />
                <div className="flex gap-2 mt-4">
                    <button
                        onClick={saveTargetTemp}
                        disabled={!Number.isFinite(targetTemp) || targetTemp === tempConfig.targetTemp || isSaving}
                        className="flex-1 py-3 bg-blue-500 text-white text-sm font-semibold rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-60"
                    >
                        Save
                    </button>
                    <button
                        onClick={() => setTargetDraft(DEFAULT_TARGET_TEMP)}
                        className="px-5 py-3 bg-slate-100 text-slate-600 text-sm font-semibold rounded-xl hover:bg-slate-200 transition-colors"
                    >
                        Reset
                    </button>
                </div>
            </Card>

            <Card>
                <p className="text-sm font-semibold text-slate-700 mb-3">Heater Mode</p>
                <ModeSelector
                    mode={tempConfig.mode.toLowerCase()}
                    onModeChange={mode => saveTemperatureConfig({ mode: mode.toUpperCase() })}
                />
            </Card>

            <Card>
                <p className="text-sm font-semibold text-slate-700 mb-3">Manual Control</p>
                <ManualControlPanel
                    state={realtimeState.heaterStatus === "ON" ? "Running" : "Idle"}
                    control={formatModeLabel(tempConfig.mode)}
                    isManual={isManual}
                    isBusy={isSaving}
                    isPending={tempConfig.manualControlState !== realtimeState.heaterStatus}
                    isOnline={isDeviceOnline}
                    onTurnOn={() => saveTemperatureConfig({ manualControlState: "ON" })}
                    onTurnOff={() => saveTemperatureConfig({ manualControlState: "OFF" })}
                />
            </Card>
        </div>
    );
}

// schedule card
function LightingScheduleCard({ schedule, disabled, onSave }) {
    // draft state
    const [scheduleDraft, setScheduleDraft] = useState({
        startTime: schedule.startTime || "08:00 AM",
        endTime: schedule.endTime || "10:00 PM",
        isActive: Boolean(schedule.isActive),
    });
    const isSameTime = scheduleDraft.startTime === scheduleDraft.endTime;
    const hasChanges =
        scheduleDraft.startTime !== schedule.startTime ||
        scheduleDraft.endTime !== schedule.endTime ||
        scheduleDraft.isActive !== Boolean(schedule.isActive);

    return (
        <Card>
            <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-slate-700">Schedule</p>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500">
                        {scheduleDraft.isActive ? "Active" : "Inactive"}
                    </span>
                    <ToggleSwitch
                        checked={scheduleDraft.isActive}
                        label="Lighting schedule active"
                        onChange={isActive => setScheduleDraft(current => ({ ...current, isActive }))}
                    />
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <TimeSelect
                    label="Start Time"
                    value={scheduleDraft.startTime}
                    onChange={startTime => setScheduleDraft(current => ({ ...current, startTime }))}
                />
                <TimeSelect
                    label="End Time"
                    value={scheduleDraft.endTime}
                    onChange={endTime => setScheduleDraft(current => ({ ...current, endTime }))}
                />
            </div>
            <p className={`text-xs mb-3 ${isSameTime ? "text-red-500" : "text-slate-400"}`}>
                {isSameTime
                    ? "Start and end time must differ."
                    : `The LED stays on for ${calculateScheduleDurationHours(scheduleDraft.startTime, scheduleDraft.endTime)} hrs in Automatic mode.`}
            </p>
            <button
                onClick={() =>
                    onSave({
                        ...scheduleDraft,
                        durationHours: calculateScheduleDurationHours(scheduleDraft.startTime, scheduleDraft.endTime),
                    })
                }
                disabled={disabled || isSameTime || !hasChanges}
                className="w-full py-3 bg-blue-500 text-white text-sm font-semibold rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
                Save Schedule
            </button>
        </Card>
    );
}

// lighting tab
function LightingTab({ aquarium, realtimeState, isDeviceOnline, saveAquariumSection, isSaving }) {
    const { lightingConfig } = aquarium;
    const { schedule } = lightingConfig;
    // save config
    const saveLightingConfig = patch => saveAquariumSection("lightingConfig", patch, updateLightingConfig);

    return (
        <div className="space-y-4">
            <Card>
                <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-slate-500">Lighting Status</p>
                    <StatusBadge status={realtimeState.ledStatus} />
                </div>
                <div
                    className={`flex items-center gap-2 text-2xl font-bold mb-3 ${
                        realtimeState.ledStatus === "ON" ? "text-blue-500" : "text-slate-300"
                    }`}
                >
                    ☀️ {realtimeState.ledStatus}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <InfoField label="Avg. Hours ON" value={formatHours(lightingConfig.avgHoursOn)} />
                    <InfoField label="Avg. Hours OFF" value={formatHours(lightingConfig.avgHoursOff)} />
                </div>
            </Card>

            <LightingScheduleCard
                key={`${schedule.startTime}-${schedule.endTime}-${schedule.isActive}`}
                schedule={schedule}
                disabled={isSaving}
                onSave={nextSchedule => saveLightingConfig({ schedule: nextSchedule })}
            />

            <Card>
                <p className="text-sm font-semibold text-slate-700 mb-3">Schedule Summary</p>
                <div className="grid grid-cols-3 gap-2 mb-2">
                    <InfoField label="Start" value={schedule.startTime} />
                    <InfoField label="End" value={schedule.endTime} />
                    <InfoField label="Duration" value={formatHours(schedule.durationHours)} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <InfoField label="Mode" value={formatModeLabel(lightingConfig.mode)} />
                    <InfoField label="State" value={realtimeState.ledStatus} />
                    <InfoField label="Schedule" value={schedule.isActive ? "Active" : "Off"} />
                </div>
            </Card>

            <Card>
                <p className="text-sm font-semibold text-slate-700 mb-3">LED Mode</p>
                <ModeSelector
                    mode={lightingConfig.mode.toLowerCase()}
                    onModeChange={mode => saveLightingConfig({ mode: mode.toUpperCase() })}
                />
            </Card>

            <Card>
                <p className="text-sm font-semibold text-slate-700 mb-3">Manual Control</p>
                <ManualControlPanel
                    state={realtimeState.ledStatus === "ON" ? "Running" : "Idle"}
                    control={formatModeLabel(lightingConfig.mode)}
                    isManual={lightingConfig.mode === "MANUAL"}
                    isBusy={isSaving}
                    isPending={lightingConfig.manualControlState !== realtimeState.ledStatus}
                    isOnline={isDeviceOnline}
                    onTurnOn={() => saveLightingConfig({ manualControlState: "ON" })}
                    onTurnOff={() => saveLightingConfig({ manualControlState: "OFF" })}
                />
            </Card>
        </div>
    );
}

// feeder tab
function FeederTab({ aquarium, realtimeState, isDeviceOnline, saveAquariumSection, isSaving, onFeedNow }) {
    const { feederConfig } = aquarium;
    const feedPending = isFeedPending(feederConfig.lastTriggeredAt, realtimeState.lastUpdated);
    const [isAddTimeModalOpen, setIsAddTimeModalOpen] = useState(false);
    // save schedules
    const saveFeedingSchedules = schedules => saveAquariumSection("feederConfig", { schedules }, updateFeederConfig);

    return (
        <div className="space-y-4">
            {isAddTimeModalOpen && (
                <AddFeedingTimeModal
                    onAddSchedule={time => saveFeedingSchedules([...feederConfig.schedules, { time, isActive: true }])}
                    onClose={() => setIsAddTimeModalOpen(false)}
                />
            )}

            <Card>
                <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-slate-700">Feeder Status</p>
                    <StatusBadge status={realtimeState.feederStatus} />
                </div>
                <div
                    className={`text-2xl font-bold mb-1 ${
                        realtimeState.feederStatus === "Active" ? "text-green-500" : "text-slate-300"
                    }`}
                >
                    🐟 {realtimeState.feederStatus}
                </div>
            </Card>

            <Card>
                <p className="text-sm font-semibold text-slate-700 mb-3">Feeder Mode</p>
                <ModeSelector
                    mode={feederConfig.mode.toLowerCase()}
                    onModeChange={mode =>
                        saveAquariumSection("feederConfig", { mode: mode.toUpperCase() }, updateFeederConfig)
                    }
                />
            </Card>

            <Card>
                <p className="text-sm font-semibold text-slate-700 mb-3">Manual Control</p>
                <ManualControlPanel
                    state={realtimeState.feederStatus}
                    control={formatModeLabel(feederConfig.mode)}
                    isManual={feederConfig.mode === "MANUAL"}
                    isBusy={isSaving || feedPending}
                    isPending={feedPending}
                    isOnline={isDeviceOnline}
                    turnOnLabel="Feed Now"
                    onTurnOn={onFeedNow}
                />
            </Card>

            <Card>
                <p className="text-sm font-semibold text-slate-700 mb-3">Feeding Schedule</p>
                <div className="space-y-3">
                    {feederConfig.schedules.map((feedingSchedule, index) => (
                        <div
                            key={feedingSchedule.time}
                            className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0"
                        >
                            <span className="text-sm text-slate-700 font-medium">{feedingSchedule.time}</span>
                            <div className="flex items-center gap-3">
                                <ToggleSwitch
                                    checked={feedingSchedule.isActive}
                                    label={`Feeding at ${feedingSchedule.time}`}
                                    onChange={() =>
                                        saveFeedingSchedules(
                                            feederConfig.schedules.map((item, i) =>
                                                i === index ? { ...item, isActive: !item.isActive } : item,
                                            ),
                                        )
                                    }
                                />
                                <button
                                    onClick={() =>
                                        saveFeedingSchedules(feederConfig.schedules.filter((_, i) => i !== index))
                                    }
                                    aria-label={`Delete feeding time ${feedingSchedule.time}`}
                                    className="text-slate-300 hover:text-red-400 transition-colors p-1"
                                >
                                    <TrashIcon />
                                </button>
                            </div>
                        </div>
                    ))}
                    <button
                        onClick={() => setIsAddTimeModalOpen(true)}
                        className="flex items-center gap-2 text-blue-500 text-sm font-semibold hover:text-blue-600 transition-colors pt-1"
                    >
                        <PlusIcon /> Add feeding time
                    </button>
                </div>
            </Card>
        </div>
    );
}

// dashboard page
export default function DashboardPage({ onSuccessNotice }) {
    const { tab: tabIdFromRoute = "overview" } = useParams();
    const navigate = useNavigate();
    const { user, activeAquariumId, canControlAquarium, isViewer } = useAuth();

    // state
    const [aquarium, setAquarium] = useState(null);
    const [chartData, setChartData] = useState([]);
    const [recentTelemetry, setRecentTelemetry] = useState([]);
    const [recentNotifications, setRecentNotifications] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [actionError, setActionError] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const isMounted = useRef(true);

    // mount flag
    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    // refresh data
    const refreshDashboardData = useCallback(async () => {
        const [aquariumData, telemetry, notifications] = await Promise.all([
            getAquariumDetail(activeAquariumId),
            getTelemetryRecords(activeAquariumId, { limit: 12 }),
            getNotifications(activeAquariumId, { limit: 5 }),
        ]);
        if (!isMounted.current) return;
        setAquarium(aquariumData);
        setChartData(toTemperatureChartData(telemetry.telemetryRecords));
        setRecentTelemetry(telemetry.telemetryRecords.slice(0, 5));
        setRecentNotifications(notifications.notificationRecords.slice(0, 5));
    }, [activeAquariumId]);

    // initial load
    useEffect(() => {
        refreshDashboardData()
            .catch(error => isMounted.current && setLoadError(error.message || "Could not load the dashboard."))
            .finally(() => isMounted.current && setIsLoading(false));
    }, [refreshDashboardData]);

    const pollFrequency = aquarium?.systemConfig?.pollFrequency;
    const isLoaded = Boolean(aquarium);
    const awaitingDevice = isLoaded && isAwaitingDevice(aquarium);
    const [isFastRefreshActive, setIsFastRefreshActive] = useState(false);
    // fast refresh window
    useEffect(() => {
        setIsFastRefreshActive(awaitingDevice);
        if (!awaitingDevice) return undefined;
        const timeoutId = window.setTimeout(
            () => setIsFastRefreshActive(false),
            DASHBOARD_FAST_REFRESH_MAX_SECONDS * 1000,
        );
        return () => window.clearTimeout(timeoutId);
    }, [awaitingDevice]);
    const refreshSeconds = isFastRefreshActive ? DASHBOARD_FAST_REFRESH_SECONDS : DASHBOARD_REFRESH_SECONDS;
    // auto refresh
    useEffect(() => {
        if (!isLoaded) return undefined;
        const intervalId = window.setInterval(() => {
            if (document.visibilityState !== "visible") return;
            refreshDashboardData().catch(error => console.warn("Unable to refresh the dashboard.", error));
        }, refreshSeconds * 1000);
        return () => window.clearInterval(intervalId);
    }, [isLoaded, refreshSeconds, refreshDashboardData]);

    // run action
    const runDashboardAction = async (action, successMessage, failureMessage) => {
        setActionError("");
        setIsSaving(true);
        try {
            await action();
            onSuccessNotice?.(successMessage);
            await refreshDashboardData().catch(error => console.warn("Unable to refresh the dashboard.", error));
            return true;
        } catch (error) {
            setActionError(error.message || failureMessage);
            return false;
        } finally {
            setIsSaving(false);
        }
    };

    // save section
    const saveAquariumSection = (section, patch, apiCall) =>
        runDashboardAction(
            async () => {
                await apiCall(activeAquariumId, patch);
                setAquarium(current => ({ ...current, [section]: { ...current[section], ...patch } }));
            },
            "Aquarium configuration updated successfully.",
            "Could not update the aquarium setting.",
        );

    // feed now
    const handleFeedNow = () =>
        runDashboardAction(
            () => triggerFeeder(activeAquariumId),
            "Feed command sent to the device.",
            "Could not trigger the feeder.",
        );

    if (isLoading || loadError || !aquarium) {
        return (
            <div className="px-4 py-6">
                <PageHeader title="Dashboard" subtitle={user?.fullName && `Welcome, ${user.fullName}`} />
                {isLoading ? (
                    <LoadingSpinner />
                ) : loadError ? (
                    <ErrorAlert message={loadError} />
                ) : (
                    <Card className="text-center text-slate-500">No Data</Card>
                )}
            </div>
        );
    }

    // derived state
    const realtimeState = { ...EMPTY_REALTIME_STATE, ...aquarium.realtimeState };
    const isDeviceOnline = checkDeviceOnline(realtimeState.lastUpdated, pollFrequency);
    const activeTab = DASHBOARD_TABS.some(item => item.id === tabIdFromRoute) ? tabIdFromRoute : "overview";
    const controlTabProps = { aquarium, realtimeState, isDeviceOnline, saveAquariumSection, isSaving };

    return (
        <div className="px-4 py-5">
            <div className="text-xs text-slate-400 mb-0.5">Welcome, {user?.fullName}</div>
            <ErrorAlert message={actionError} />
            {isViewer && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    You have view-only access. Ask an admin to give you a role to change settings.
                </div>
            )}
            <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-bold text-slate-800">
                        {DASHBOARD_TABS.find(item => item.id === activeTab).label}
                    </h1>
                    <DeviceOnlineBadge isOnline={isDeviceOnline} lastUpdated={realtimeState.lastUpdated} />
                </div>
                <LiveClock timezone={aquarium.systemConfig.timezone} />
            </div>

            <div className="flex gap-1 overflow-x-auto pb-1 mb-5 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
                {DASHBOARD_TABS.map(item => (
                    <button
                        key={item.id}
                        onClick={() =>
                            navigate(item.id === "overview" ? "/dashboard" : `/dashboard/${item.id}`, { replace: true })
                        }
                        className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-semibold transition-all ${
                            activeTab === item.id
                                ? "bg-blue-500 text-white shadow-sm"
                                : "bg-white border border-slate-200 text-slate-600 hover:border-blue-300"
                        }`}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {activeTab === "overview" && (
                <OverviewTab
                    aquarium={aquarium}
                    realtimeState={realtimeState}
                    chartData={chartData}
                    recentTelemetry={recentTelemetry}
                    recentNotifications={recentNotifications}
                />
            )}
            {/* disable controls */}
            <fieldset disabled={!canControlAquarium} className="m-0 min-w-0 border-0 p-0">
                {activeTab === "temperature" && <TemperatureTab {...controlTabProps} />}
                {activeTab === "lighting" && <LightingTab {...controlTabProps} />}
                {activeTab === "feeder" && <FeederTab {...controlTabProps} onFeedNow={handleFeedNow} />}
            </fieldset>
        </div>
    );
}
