import { useState } from "react";
import { createAquarium } from "../../api/backendApi";
import {
    DeviceKeyNotice,
    INPUT_CLASS_NAME,
    SectionCard,
    SmallButton,
    StatusMessages,
    useApiAction,
} from "./AquariumUiParts";

// new aquarium form
export default function NewAquariumForm({ onCreated, onCancel }) {
    // state
    const [name, setName] = useState("");
    const [aquariumId, setAquariumId] = useState("");
    const [deviceName, setDeviceName] = useState("");
    const [created, setCreated] = useState(null);
    const { status, isBusy, runApiAction } = useApiAction();

    // create aquarium
    const handleSubmit = async event => {
        event.preventDefault();
        const result = await runApiAction(
            () => createAquarium({ name, id: aquariumId.trim(), deviceName: deviceName.trim() }),
            "Aquarium created.",
        );
        if (result) {
            setCreated(result);
            onCreated?.(result);
        }
    };

    if (created) {
        return (
            <SectionCard title="Aquarium created" description={`${created.name} (ID: ${created.id})`}>
                <DeviceKeyNotice deviceKey={created.deviceKey} />
                <SmallButton onClick={onCancel}>Done</SmallButton>
            </SectionCard>
        );
    }

    return (
        <SectionCard title="Create aquarium" description="You become the owner of the new aquarium.">
            <StatusMessages status={status} />
            <form onSubmit={handleSubmit} className="space-y-2">
                <input
                    required
                    maxLength={80}
                    value={name}
                    onChange={event => setName(event.target.value)}
                    placeholder="Aquarium name"
                    aria-label="Aquarium name"
                    className={INPUT_CLASS_NAME}
                />
                <input
                    maxLength={64}
                    pattern="[A-Za-z0-9_\-]*"
                    value={aquariumId}
                    onChange={event => setAquariumId(event.target.value)}
                    placeholder="Aquarium ID (optional, letters, numbers, - and _)"
                    aria-label="Aquarium ID"
                    className={INPUT_CLASS_NAME}
                />
                <input
                    maxLength={80}
                    value={deviceName}
                    onChange={event => setDeviceName(event.target.value)}
                    placeholder="Device name (optional, registers the ESP32 now)"
                    aria-label="Device name"
                    className={INPUT_CLASS_NAME}
                />
                <div className="flex gap-2">
                    <SmallButton type="submit" tone="primary" disabled={isBusy}>
                        Create
                    </SmallButton>
                    <SmallButton onClick={onCancel}>Cancel</SmallButton>
                </div>
            </form>
        </SectionCard>
    );
}
