import { useCallback, useEffect, useState } from "react";
import { adminGetAquariums } from "../../api/backendApi";
import { useAuth } from "../../context/AuthContext";
import { ErrorAlert, LoadingSpinner } from "../UiKit";
import { EmptyState, SmallButton } from "./AccessUiParts";
import AquariumPeople from "./AquariumPeople";
import AquariumSummary from "./AquariumSummary";
import DevicesSection from "./DevicesSection";
import NewAquariumForm from "./NewAquariumForm";
import UsersTab from "./UsersTab";

// admin tabs
const ADMIN_ACCESS_TABS = [
    { id: "aquariums", label: "Aquariums" },
    { id: "users", label: "Users" },
];

// aquarium list
function AquariumList({ aquariums, selectedAquariumId, onSelectAquarium }) {
    return (
        <ul className="space-y-2">
            {aquariums.map(item => {
                const isSelected = item.id === selectedAquariumId;
                return (
                    <li key={item.id}>
                        <button
                            type="button"
                            onClick={() => onSelectAquarium(item.id)}
                            aria-current={isSelected}
                            className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                                isSelected
                                    ? "border-blue-400 bg-blue-50"
                                    : "border-slate-200 bg-white hover:border-blue-200"
                            }`}
                        >
                            <div className="truncate text-sm font-semibold text-slate-800">{item.name}</div>
                            <div className="truncate font-mono text-[11px] text-slate-400">{item.id}</div>
                            <div className="mt-1 truncate text-xs text-slate-500">
                                {item.owners.length > 0
                                    ? `Owner: ${item.owners.map(owner => owner.fullName || owner.email).join(", ")}`
                                    : "No owner yet"}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-400">
                                {item.memberCount} {item.memberCount === 1 ? "person" : "people"} · {item.deviceCount}{" "}
                                {item.deviceCount === 1 ? "device" : "devices"}
                            </div>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

// admin access
export default function AdminAccess() {
    const { refreshAquariums } = useAuth();
    // state
    const [activeTab, setActiveTab] = useState("aquariums");
    const [aquariums, setAquariums] = useState(null);
    const [selectedAquariumId, setSelectedAquariumId] = useState(null);
    const [isCreating, setIsCreating] = useState(false);
    const [loadError, setLoadError] = useState("");

    // load aquariums
    const loadAdminAquariums = useCallback(
        () =>
            adminGetAquariums()
                .then(result => {
                    setAquariums(result.aquariums);
                    setLoadError("");
                    setSelectedAquariumId(current =>
                        result.aquariums.some(item => item.id === current)
                            ? current
                            : (result.aquariums[0]?.id ?? null),
                    );
                })
                .catch(error => setLoadError(error.message || "Could not load aquariums.")),
        [],
    );

    // initial load
    useEffect(() => {
        loadAdminAquariums();
    }, [loadAdminAquariums]);

    // data changed
    const handleAquariumDataChanged = useCallback(() => {
        loadAdminAquariums();
        refreshAquariums().catch(() => {});
    }, [loadAdminAquariums, refreshAquariums]);

    // aquarium created
    const handleAquariumCreated = async newAquariumId => {
        setIsCreating(false);
        await loadAdminAquariums();
        setSelectedAquariumId(newAquariumId);
        refreshAquariums().catch(() => {});
    };

    // selection
    const selectedAquarium = aquariums?.find(item => item.id === selectedAquariumId) ?? null;
    const hasNoAquariums = aquariums !== null && aquariums.length === 0;

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                {ADMIN_ACCESS_TABS.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => setActiveTab(item.id)}
                        className={`rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                            activeTab === item.id
                                ? "bg-blue-500 text-white shadow-sm"
                                : "border border-slate-200 bg-white text-slate-600"
                        }`}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {/* users tab */}
            {activeTab === "users" && <UsersTab />}

            {/* aquariums tab */}
            {activeTab === "aquariums" && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="text-sm font-bold text-slate-800">Aquariums</h2>
                            {!isCreating && !hasNoAquariums && (
                                <SmallButton tone="primary" onClick={() => setIsCreating(true)}>
                                    + New aquarium
                                </SmallButton>
                            )}
                        </div>

                        {(isCreating || hasNoAquariums) && (
                            <NewAquariumForm
                                onAquariumCreated={handleAquariumCreated}
                                onCancel={hasNoAquariums ? undefined : () => setIsCreating(false)}
                            />
                        )}

                        <ErrorAlert message={loadError} />
                        {aquariums === null && !loadError ? (
                            <LoadingSpinner />
                        ) : hasNoAquariums ? (
                            <EmptyState>No aquariums yet. Create the first one.</EmptyState>
                        ) : (
                            aquariums && (
                                <AquariumList
                                    aquariums={aquariums}
                                    selectedAquariumId={selectedAquariumId}
                                    onSelectAquarium={setSelectedAquariumId}
                                />
                            )
                        )}
                    </div>

                    <div className="min-w-0 space-y-4">
                        {selectedAquarium ? (
                            <>
                                <AquariumSummary
                                    key={selectedAquarium.id}
                                    aquarium={selectedAquarium}
                                    onDataChanged={handleAquariumDataChanged}
                                />
                                <AquariumPeople
                                    key={`people-${selectedAquarium.id}`}
                                    aquariumId={selectedAquarium.id}
                                    isAdmin
                                    onDataChanged={handleAquariumDataChanged}
                                />
                                <DevicesSection
                                    key={`devices-${selectedAquarium.id}`}
                                    aquariumId={selectedAquarium.id}
                                    onDataChanged={handleAquariumDataChanged}
                                />
                            </>
                        ) : (
                            aquariums !== null &&
                            !hasNoAquariums && <EmptyState>Select an aquarium to manage it.</EmptyState>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
