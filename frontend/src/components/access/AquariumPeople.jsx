import { useCallback, useEffect, useState } from "react";
import {
    getMemberCandidates,
    getAquariumMembers,
    removeAquariumMember,
    saveAquariumMember,
} from "../../api/backendApi";
import RoleBadge from "../RoleBadge";
import { LoadingSpinner } from "../UiKit";
import AddPersonPanel from "./AddPersonPanel";
import { EmptyState, PersonRow, SectionCard, SmallButton, StatusMessages, useApiAction } from "./AccessUiParts";

// aquarium people
export default function AquariumPeople({ aquariumId, isAdmin, onDataChanged }) {
    // state
    const [members, setMembers] = useState(null);
    const [candidates, setCandidates] = useState([]);
    const [loadError, setLoadError] = useState("");
    const { status, isBusy, runApiAction } = useApiAction();

    // load people
    const loadPeople = useCallback(async () => {
        try {
            const [memberResult, candidateResult] = await Promise.all([
                getAquariumMembers(aquariumId),
                getMemberCandidates(aquariumId),
            ]);
            setMembers(memberResult.members);
            setCandidates(candidateResult.candidates);
            setLoadError("");
        } catch (error) {
            setLoadError(error.message || "Could not load people.");
        }
    }, [aquariumId]);

    // initial load
    useEffect(() => {
        setMembers(null);
        loadPeople();
    }, [loadPeople]);

    // add person
    const handleAddPerson = async (userId, role) => {
        if (
            await runApiAction(
                () => saveAquariumMember(aquariumId, { userId, role }),
                role === "owner" ? "Owner added." : "Member added.",
            )
        ) {
            await loadPeople();
            onDataChanged?.();
        }
    };

    // remove person
    const handleRemovePerson = async person => {
        const label = person.fullName || person.email;
        if (!window.confirm(`Remove ${label} from this aquarium?`)) return;
        if (await runApiAction(() => removeAquariumMember(aquariumId, person.userId), `${label} was removed.`)) {
            await loadPeople();
            onDataChanged?.();
        }
    };

    if (members === null && !loadError) return <LoadingSpinner />;

    // role lists
    const owners = (members || []).filter(person => person.role === "owner");
    const memberRoleList = (members || []).filter(person => person.role === "member");

    // render list
    const renderPersonList = (personList, emptyText) =>
        personList.length === 0 ? (
            <EmptyState>{emptyText}</EmptyState>
        ) : (
            <ul className="divide-y divide-slate-100">
                {personList.map(person => (
                    <PersonRow key={person.userId} person={person}>
                        <RoleBadge role={person.role} />
                        <SmallButton tone="danger" disabled={isBusy} onClick={() => handleRemovePerson(person)}>
                            Remove
                        </SmallButton>
                    </PersonRow>
                ))}
            </ul>
        );

    return (
        <>
            <StatusMessages status={status} extraError={loadError} />

            {isAdmin && (
                <SectionCard
                    title="Owners"
                >
                    {renderPersonList(owners, "No owner yet.")}
                    <AddPersonPanel
                        label="Add owner"
                        candidates={candidates}
                        isBusy={isBusy}
                        onAddPerson={userId => handleAddPerson(userId, "owner")}
                    />
                </SectionCard>
            )}

            <SectionCard
                title="Members"
            >
                {renderPersonList(memberRoleList, "No members yet.")}
                <AddPersonPanel
                    label="Add member"
                    candidates={candidates}
                    isBusy={isBusy}
                    onAddPerson={userId => handleAddPerson(userId, "member")}
                />
            </SectionCard>
        </>
    );
}
