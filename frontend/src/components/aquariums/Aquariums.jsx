import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cancelJoinRequest, claimAquarium, getAquariumDirectory, requestToJoinAquarium } from "../../api/backendApi";
import { useAuth } from "../../context/AuthContext";
import RoleBadge from "../RoleBadge";
import { LoadingSpinner } from "../UiKit";
import { EmptyState, SmallButton, StatusMessages, useApiAction } from "./AquariumUiParts";
import NewAquariumForm from "./NewAquariumForm";

// people names
const formatNames = people => people.map(person => person.fullName).join(", ");

// all aquariums
export default function Aquariums() {
    const { openAquarium, refreshAquariums } = useAuth();
    const navigate = useNavigate();
    // state
    const [aquariums, setAquariums] = useState(null);
    const [loadError, setLoadError] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const { status, isBusy, runApiAction } = useApiAction();

    // load directory
    const loadDirectory = useCallback(
        () =>
            getAquariumDirectory()
                .then(result => {
                    setAquariums(result.aquariums);
                    setLoadError("");
                })
                .catch(error => setLoadError(error.message || "Could not load aquariums.")),
        [],
    );

    // initial load
    useEffect(() => {
        loadDirectory();
    }, [loadDirectory]);

    // view aquarium
    const handleView = item => {
        openAquarium({ id: item.id, name: item.name, role: item.myRole });
        navigate("/dashboard");
    };

    // run and reload
    const runAndReload = async (action, message, { refreshMine = false } = {}) => {
        if (!(await runApiAction(action, message))) return;
        if (refreshMine) await refreshAquariums();
        await loadDirectory();
    };

    return (
        <div className="space-y-4">
            <StatusMessages status={status} extraError={loadError} />
            {isCreating ? (
                <NewAquariumForm
                    onCreated={() => {
                        refreshAquariums();
                        loadDirectory();
                    }}
                    onCancel={() => setIsCreating(false)}
                />
            ) : (
                <div>
                    <SmallButton tone="primary" onClick={() => setIsCreating(true)}>
                        Create aquarium
                    </SmallButton>
                </div>
            )}

            {aquariums === null && !loadError ? (
                <LoadingSpinner />
            ) : aquariums?.length === 0 ? (
                <EmptyState>No aquariums yet. Create the first one.</EmptyState>
            ) : (
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {(aquariums || []).map(item => (
                        <li key={item.id} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-bold text-slate-800">{item.name}</div>
                                    <div className="truncate font-mono text-[11px] text-slate-400">{item.id}</div>
                                </div>
                                {item.myRole && <RoleBadge role={item.myRole} />}
                            </div>
                            <div className="text-xs text-slate-500">
                                <span className="font-semibold">Owner:</span> {item.owner?.fullName || "No owner"}
                            </div>
                            <div className="text-xs text-slate-500">
                                <span className="font-semibold">Members:</span>{" "}
                                {item.members.length > 0 ? formatNames(item.members) : "None"}
                            </div>
                            <div className="flex flex-wrap gap-2 pt-1">
                                <SmallButton onClick={() => handleView(item)}>View</SmallButton>
                                {!item.myRole && !item.owner && (
                                    <SmallButton
                                        tone="primary"
                                        disabled={isBusy}
                                        onClick={() =>
                                            runAndReload(() => claimAquarium(item.id), "You are now the owner.", {
                                                refreshMine: true,
                                            })
                                        }
                                    >
                                        Claim
                                    </SmallButton>
                                )}
                                {!item.myRole &&
                                    item.owner &&
                                    (item.joinRequestPending ? (
                                        <>
                                            <span className="self-center text-xs text-slate-400">Request sent</span>
                                            <SmallButton
                                                tone="danger"
                                                disabled={isBusy}
                                                onClick={() =>
                                                    runAndReload(() => cancelJoinRequest(item.id), "Request cancelled.")
                                                }
                                            >
                                                Cancel
                                            </SmallButton>
                                        </>
                                    ) : (
                                        <SmallButton
                                            tone="primary"
                                            disabled={isBusy}
                                            onClick={() =>
                                                runAndReload(
                                                    () => requestToJoinAquarium(item.id),
                                                    "Request sent. You will be notified when the owner approves it.",
                                                )
                                            }
                                        >
                                            Join
                                        </SmallButton>
                                    ))}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
