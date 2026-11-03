import { useCallback, useEffect, useState } from "react";
import { adminCreateDevice, adminGetDevices, adminRevokeDevice } from "../../api/backendApi";
import { LoadingSpinner } from "../UiKit";
import { EmptyState, INPUT_CLASS_NAME, SectionCard, SmallButton, StatusMessages, useApiAction } from "./AccessUiParts";

// devices section
export default function DevicesSection({ aquariumId, onDataChanged }) {
    // state
    const [devices, setDevices] = useState(null);
    const [deviceName, setDeviceName] = useState("");
    const [newDeviceKey, setNewDeviceKey] = useState("");
    const [isKeyCopied, setIsKeyCopied] = useState(false);
    const [loadError, setLoadError] = useState("");
    const { status, isBusy, runApiAction } = useApiAction();

    // load devices
    const loadDevices = useCallback(
        () =>
            adminGetDevices(aquariumId)
                .then(result => {
                    setDevices(result.devices);
                    setLoadError("");
                })
                .catch(error => setLoadError(error.message || "Could not load devices.")),
        [aquariumId],
    );

    // initial load
    useEffect(() => {
        setDevices(null);
        setNewDeviceKey("");
        loadDevices();
    }, [loadDevices]);

    // register device
    const handleRegisterDevice = async event => {
        event.preventDefault();
        const result = await runApiAction(() => adminCreateDevice(aquariumId, deviceName), "Device registered.");
        if (result) {
            setNewDeviceKey(result.deviceKey);
            setIsKeyCopied(false);
            setDeviceName("");
            await loadDevices();
            onDataChanged?.();
        }
    };

    // revoke device
    const handleRevokeDevice = async device => {
        if (!window.confirm(`Revoke ${device.name}? It will stop working until you register it again.`)) return;
        if (await runApiAction(() => adminRevokeDevice(device.id), "Device revoked.")) {
            await loadDevices();
            onDataChanged?.();
        }
    };

    // copy key
    const copyDeviceKey = async () => {
        try {
            await navigator.clipboard.writeText(newDeviceKey);
            setIsKeyCopied(true);
        } catch {
            setIsKeyCopied(false);
        }
    };

    return (
        <SectionCard
            title="Device"
        >
            <StatusMessages status={status} extraError={loadError} />

            {/* new key */}
            {newDeviceKey && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <div className="mb-1 font-semibold">Copy this key now. It will not be shown again.</div>
                    <code className="block break-all rounded bg-white px-2 py-1.5 text-xs">{newDeviceKey}</code>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <SmallButton onClick={copyDeviceKey}>{isKeyCopied ? "Copied" : "Copy key"}</SmallButton>
                        <span className="text-xs">Put it in device/include/secrets.h as DEVICE_KEY.</span>
                    </div>
                </div>
            )}

            {devices === null && !loadError ? (
                <LoadingSpinner />
            ) : devices?.length === 0 ? (
                <EmptyState>No device registered yet.</EmptyState>
            ) : (
                <ul className="divide-y divide-slate-100">
                    {(devices || []).map(device => (
                        <li key={device.id} className="flex items-center justify-between gap-3 py-2.5">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-slate-800">{device.name}</div>
                                <div className="truncate font-mono text-xs text-slate-400">{device.id}</div>
                            </div>
                            <SmallButton tone="danger" disabled={isBusy} onClick={() => handleRevokeDevice(device)}>
                                Revoke
                            </SmallButton>
                        </li>
                    ))}
                </ul>
            )}

            {devices?.length > 0 ? (
                <p className="text-xs text-slate-400">
                    This aquarium already has its device. To replace the ESP32, revoke this one first, then register the
                    new one and flash it with the new key.
                </p>
            ) : (
                <form onSubmit={handleRegisterDevice} className="flex flex-col gap-2 sm:flex-row">
                    <input
                        required
                        maxLength={80}
                        value={deviceName}
                        onChange={event => setDeviceName(event.target.value)}
                        placeholder="Device name"
                        className={INPUT_CLASS_NAME}
                    />
                    <SmallButton type="submit" tone="primary" disabled={isBusy}>
                        Register device
                    </SmallButton>
                </form>
            )}
        </SectionCard>
    );
}
