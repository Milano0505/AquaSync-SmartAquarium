import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import AquariumSummary from "./AquariumSummary";
import { EmptyState, INPUT_CLASS_NAME } from "./AquariumUiParts";
import DevicesSection from "./DevicesSection";
import PeopleSection from "./PeopleSection";

// my aquariums
export default function MyAquariums() {
    const { aquariums, activeAquariumId, refreshAquariums } = useAuth();
    // state
    const [selectedAquariumId, setSelectedAquariumId] = useState(activeAquariumId);

    if (aquariums.length === 0) {
        return (
            <EmptyState>
                You do not own or belong to an aquarium yet. Create one or ask to join in All Aquariums.
            </EmptyState>
        );
    }
    const selected = aquariums.find(item => item.id === selectedAquariumId) || aquariums[0];

    return (
        <div className="space-y-4">
            {aquariums.length > 1 && (
                <select
                    value={selected.id}
                    onChange={event => setSelectedAquariumId(event.target.value)}
                    className={`${INPUT_CLASS_NAME} sm:max-w-xs`}
                    aria-label="Select aquarium"
                >
                    {aquariums.map(item => (
                        <option key={item.id} value={item.id}>
                            {item.name}
                        </option>
                    ))}
                </select>
            )}
            <AquariumSummary key={`summary-${selected.id}`} aquarium={selected} onDataChanged={refreshAquariums} />
            <DevicesSection
                key={`device-${selected.id}`}
                aquariumId={selected.id}
                isOwner={selected.role === "owner"}
            />
            <PeopleSection key={`people-${selected.id}`} aquariumId={selected.id} isOwner={selected.role === "owner"} />
        </div>
    );
}
