import { useCallback, useEffect, useState } from "react";
import {
    getAquariumDevice,
    registerAquariumDevice,
    revokeAquariumDevice,
    rotateAquariumDeviceKey,
} from "../../api/backendApi";
import { LoadingSpinner } from "../UiKit";
import {
    DeviceKeyNotice,
    INPUT_CLASS_NAME,
    SectionCard,
    SmallButton,
    StatusMessages,
    useApiAction,
} from "./AquariumUiParts";

// device section
export default function DevicesSection({ aquariumId, isOwner }) {
    // state
    const [device, setDevice] = useState(undefined);
    const [deviceName, setDeviceName] = useState("");
    const [newDeviceKey, setNewDeviceKey] = useState("");
    const [loadError, setLoadError] = useState("");
    const { status, isBusy, runApiAction } = useApiAction();

    // load device
    const loadDevice = useCallback(
        () =>
            getAquariumDevice(aquariumId)
                .then(result => {
                    setDevice(result.device);
                    setLoadError("");
                })
                .catch(error => setLoadError(error.message || "Could not load the device.")),
        [aquariumId],
    );

    // initial load
    useEffect(() => {
        setDevice(undefined);
        setNewDeviceKey("");
        loadDevice();
    }, [loadDevice]);

    // register device
    const handleRegisterDevice = async event => {
        event.preventDefault();
        const result = await runApiAction(() => registerAquariumDevice(aquariumId, deviceName), "Device registered.");
        if (result) {
            setNewDeviceKey(result.deviceKey);
            setDeviceName("");
            await loadDevice();
        }
    };

    // rotate key
    const handleRotateKey = async () => {
        const warning = `Create a new key for ${device.name}? The current key stops working immediately, so you must flash the ESP32 with the new key.`;
        if (!window.confirm(warning)) return;
        const result = await runApiAction(() => rotateAquariumDeviceKey(aquariumId, device.id), "New key created.");
        if (result) setNewDeviceKey(result.deviceKey);
    };

    // revoke device
    const handleRevokeDevice = async () => {
        if (!window.confirm(`Revoke ${device.name}? It will stop working until you register a device again.`)) return;
        if (await runApiAction(() => revokeAquariumDevice(aquariumId, device.id), "Device revoked.")) {
            setNewDeviceKey("");
            await loadDevice();
        }
    };

    return (
        <SectionCard title="Device" description="Each aquarium has one ESP32 device.">
            <StatusMessages status={status} extraError={loadError} />
            <DeviceKeyNotice deviceKey={newDeviceKey} />

            {device === undefined && !loadError ? (
                <LoadingSpinner />
            ) : device ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-800">{device.name}</span>
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                                Registered
                            </span>
                        </div>
                        <div className="text-xs text-slate-400">
                            Registered {new Date(device.createdAt).toLocaleDateString()}
                        </div>
                    </div>
                    {isOwner && (
                        <div className="flex gap-2">
                            <SmallButton disabled={isBusy} onClick={handleRotateKey}>
                                New key
                            </SmallButton>
                            <SmallButton tone="danger" disabled={isBusy} onClick={handleRevokeDevice}>
                                Revoke
                            </SmallButton>
                        </div>
                    )}
                </div>
            ) : (
                <>
                    <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                        No device registered
                    </span>
                    {isOwner && (
                        <form onSubmit={handleRegisterDevice} className="flex flex-col gap-2 sm:flex-row">
                            <input
                                required
                                maxLength={80}
                                value={deviceName}
                                onChange={event => setDeviceName(event.target.value)}
                                placeholder="Device name, e.g. Living room ESP32"
                                aria-label="Device name"
                                className={INPUT_CLASS_NAME}
                            />
                            <SmallButton type="submit" tone="primary" disabled={isBusy}>
                                Register
                            </SmallButton>
                        </form>
                    )}
                </>
            )}
        </SectionCard>
    );
}
