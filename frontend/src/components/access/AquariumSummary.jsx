import { useState } from "react";
import { adminUpdateAquarium } from "../../api/backendApi";
import { ToggleSwitch } from "../UiKit";
import { INPUT_CLASS_NAME, SectionCard, SmallButton, StatusMessages, useApiAction } from "./AccessUiParts";

// aquarium summary
export default function AquariumSummary({ aquarium, onDataChanged }) {
    // state
    const [aquariumName, setAquariumName] = useState(aquarium.name);
    const { status, isBusy, runApiAction } = useApiAction();

    // save name
    const saveAquariumName = async event => {
        event.preventDefault();
        if (aquariumName.trim() === aquarium.name) return;
        if (await runApiAction(() => adminUpdateAquarium(aquarium.id, { name: aquariumName.trim() }), "Name saved."))
            onDataChanged?.();
    };

    // toggle public
    const togglePublicMonitoring = async checked => {
        const message = checked ? "Viewers can now see this aquarium." : "Monitoring is now hidden from viewers.";
        if (await runApiAction(() => adminUpdateAquarium(aquarium.id, { monitoringPublic: checked }), message))
            onDataChanged?.();
    };

    return (
        <SectionCard title="Overview" description={`ID: ${aquarium.id}`}>
            <StatusMessages status={status} />
            <form onSubmit={saveAquariumName} className="flex flex-col gap-2 sm:flex-row">
                <input
                    required
                    maxLength={80}
                    value={aquariumName}
                    onChange={event => setAquariumName(event.target.value)}
                    className={INPUT_CLASS_NAME}
                    aria-label="Aquarium name"
                />
                <SmallButton type="submit" tone="primary" disabled={isBusy || aquariumName.trim() === aquarium.name}>
                    Save name
                </SmallButton>
            </form>
            <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
                <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800">Public monitoring for viewers</div>
                    <div className="text-xs text-slate-400">
                        Users without a role can see this aquarium on the dashboard.
                    </div>
                </div>
                <ToggleSwitch
                    checked={Boolean(aquarium.monitoringPublic)}
                    onChange={togglePublicMonitoring}
                    disabled={isBusy}
                    label="Public monitoring for viewers"
                />
            </div>
        </SectionCard>
    );
}
