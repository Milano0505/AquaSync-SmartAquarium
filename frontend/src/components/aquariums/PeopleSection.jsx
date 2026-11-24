import { useCallback, useEffect, useState } from "react";
import {
    approveJoinRequest,
    getAquariumMembers,
    getJoinRequests,
    rejectJoinRequest,
    removeAquariumMember,
} from "../../api/backendApi";
import RoleBadge from "../RoleBadge";
import { LoadingSpinner } from "../UiKit";
import { EmptyState, PersonRow, SectionCard, SmallButton, StatusMessages, useApiAction } from "./AquariumUiParts";

// people section
export default function PeopleSection({ aquariumId, isOwner }) {
    // state
    const [members, setMembers] = useState(null);
    const [joinRequests, setJoinRequests] = useState([]);
    const [loadError, setLoadError] = useState("");
    const { status, isBusy, runApiAction } = useApiAction();

    // load people
    const loadPeople = useCallback(
        () =>
            Promise.all([getAquariumMembers(aquariumId), isOwner ? getJoinRequests(aquariumId) : null])
                .then(([memberResult, requestResult]) => {
                    setMembers(memberResult.members);
                    setJoinRequests(requestResult?.joinRequests ?? []);
                    setLoadError("");
                })
                .catch(error => setLoadError(error.message || "Could not load people.")),
        [aquariumId, isOwner],
    );

    // initial load
    useEffect(() => {
        setMembers(null);
        loadPeople();
    }, [loadPeople]);

    // decide request
    const handleDecision = async (joinRequest, isApproved) => {
        const action = isApproved ? approveJoinRequest : rejectJoinRequest;
        const message = isApproved ? `${joinRequest.fullName} is now a member.` : "Request declined.";
        if (await runApiAction(() => action(aquariumId, joinRequest.id), message)) await loadPeople();
    };

    // remove member
    const handleRemove = async member => {
        if (!window.confirm(`Remove ${member.fullName || member.email} from this aquarium?`)) return;
        if (await runApiAction(() => removeAquariumMember(aquariumId, member.userId), "Member removed.")) {
            await loadPeople();
        }
    };

    return (
        <>
            {isOwner && (
                <SectionCard title="Join requests" description="People who asked to join this aquarium.">
                    <StatusMessages status={status} extraError={loadError} />
                    {joinRequests.length === 0 ? (
                        <EmptyState>No pending requests.</EmptyState>
                    ) : (
                        <ul className="divide-y divide-slate-100">
                            {joinRequests.map(joinRequest => (
                                <PersonRow key={joinRequest.id} person={joinRequest}>
                                    <SmallButton
                                        tone="primary"
                                        disabled={isBusy}
                                        onClick={() => handleDecision(joinRequest, true)}
                                    >
                                        Accept
                                    </SmallButton>
                                    <SmallButton
                                        tone="danger"
                                        disabled={isBusy}
                                        onClick={() => handleDecision(joinRequest, false)}
                                    >
                                        Reject
                                    </SmallButton>
                                </PersonRow>
                            ))}
                        </ul>
                    )}
                </SectionCard>
            )}

            <SectionCard title="People" description="Owner and members of this aquarium.">
                {!isOwner && <StatusMessages status={status} extraError={loadError} />}
                {members === null && !loadError ? (
                    <LoadingSpinner />
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {(members || []).map(member => (
                            <PersonRow key={member.userId} person={member}>
                                <RoleBadge role={member.role} />
                                {isOwner && member.role === "member" && (
                                    <SmallButton tone="danger" disabled={isBusy} onClick={() => handleRemove(member)}>
                                        Remove
                                    </SmallButton>
                                )}
                            </PersonRow>
                        ))}
                    </ul>
                )}
            </SectionCard>
        </>
    );
}
