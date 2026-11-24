import { useState } from "react";
import { deleteAquarium, leaveAquarium, renameAquarium } from "../../api/backendApi";
import RoleBadge from "../RoleBadge";
import { INPUT_CLASS_NAME, SectionCard, SmallButton, StatusMessages, useApiAction } from "./AquariumUiParts";

// aquarium summary
export default function AquariumSummary({ aquarium, onDataChanged }) {
    // state
    const [aquariumName, setAquariumName] = useState(aquarium.name);
    const { status, isBusy, runApiAction } = useApiAction();
    const isOwner = aquarium.role === "owner";

    // rename
    const handleRename = async event => {
        event.preventDefault();
        if (aquariumName.trim() === aquarium.name) return;
        if (await runApiAction(() => renameAquarium(aquarium.id, aquariumName.trim()), "Name saved.")) {
            onDataChanged?.();
        }
    };

    // delete
    const handleDelete = async () => {
        if (!window.confirm(`Delete ${aquarium.name}? Its members, device and history will be removed permanently.`)) {
            return;
        }
        if (await runApiAction(() => deleteAquarium(aquarium.id), "Aquarium deleted.")) onDataChanged?.();
    };

    // leave
    const handleLeave = async () => {
        if (!window.confirm(`Leave ${aquarium.name}? You will need the owner's approval to join again.`)) return;
        if (await runApiAction(() => leaveAquarium(aquarium.id), "You left the aquarium.")) onDataChanged?.();
    };

    return (
        <SectionCard
            title="Overview"
            description={`ID: ${aquarium.id} (use it as AQUARIUM_ID in secrets.h)`}
            headerAction={<RoleBadge role={aquarium.role} />}
        >
            <StatusMessages status={status} />
            {isOwner ? (
                <>
                    <form onSubmit={handleRename} className="flex flex-col gap-2 sm:flex-row">
                        <input
                            required
                            maxLength={80}
                            value={aquariumName}
                            onChange={event => setAquariumName(event.target.value)}
                            aria-label="Aquarium name"
                            className={INPUT_CLASS_NAME}
                        />
                        <SmallButton type="submit" tone="primary" disabled={isBusy}>
                            Rename
                        </SmallButton>
                    </form>
                    <div>
                        <SmallButton tone="danger" disabled={isBusy} onClick={handleDelete}>
                            Delete aquarium
                        </SmallButton>
                    </div>
                </>
            ) : (
                <>
                    <div className="text-sm font-semibold text-slate-800">{aquarium.name}</div>
                    <div>
                        <SmallButton tone="danger" disabled={isBusy} onClick={handleLeave}>
                            Leave aquarium
                        </SmallButton>
                    </div>
                </>
            )}
        </SectionCard>
    );
}
