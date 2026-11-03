import { useCallback, useEffect, useState } from "react";
import { adminGetUsers, adminSetUserRole } from "../../api/backendApi";
import { useAuth } from "../../context/AuthContext";
import RoleBadge from "../RoleBadge";
import { LoadingSpinner } from "../UiKit";
import {
    EmptyState,
    INPUT_CLASS_NAME,
    PersonRow,
    SectionCard,
    SmallButton,
    StatusMessages,
    useApiAction,
} from "./AccessUiParts";

// users tab
export default function UsersTab() {
    const { user: currentUser } = useAuth();
    // state
    const [users, setUsers] = useState(null);
    const [loadError, setLoadError] = useState("");
    const [searchText, setSearchText] = useState("");
    const { status, isBusy, runApiAction } = useApiAction();

    // load users
    const loadUsers = useCallback(
        () =>
            adminGetUsers()
                .then(result => {
                    setUsers(result.users);
                    setLoadError("");
                })
                .catch(error => setLoadError(error.message || "Could not load users.")),
        [],
    );

    // initial load
    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    // toggle admin
    const toggleAdminRole = async user => {
        const role = user.role === "admin" ? "user" : "admin";
        const label = user.fullName || user.email;
        if (role === "admin" && !window.confirm(`Make ${label} an admin? Admins can manage everything.`)) return;
        if (
            await runApiAction(
                () => adminSetUserRole(user.userId, role),
                `${label} is now ${role === "admin" ? "an admin" : "a regular user"}.`,
            )
        ) {
            await loadUsers();
        }
    };

    // filter users
    const searchTerm = searchText.trim().toLowerCase();
    const visibleUsers = (users || []).filter(
        user =>
            !searchTerm ||
            (user.fullName || "").toLowerCase().includes(searchTerm) ||
            (user.email || "").toLowerCase().includes(searchTerm),
    );

    return (
        <SectionCard title="All users">
            <StatusMessages status={status} extraError={loadError} />
            <input
                value={searchText}
                onChange={event => setSearchText(event.target.value)}
                placeholder="Search by name or email"
                className={INPUT_CLASS_NAME}
                aria-label="Search users"
            />
            {users === null && !loadError ? (
                <LoadingSpinner />
            ) : visibleUsers.length === 0 ? (
                <EmptyState>No users found.</EmptyState>
            ) : (
                <ul className="divide-y divide-slate-100">
                    {visibleUsers.map(user => (
                        <PersonRow key={user.userId} person={user}>
                            <div className="hidden max-w-[220px] flex-wrap justify-end gap-1 md:flex">
                                {user.aquariums.map(item => (
                                    <span
                                        key={item.aquariumId}
                                        className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500"
                                    >
                                        {item.name} · {item.role}
                                    </span>
                                ))}
                            </div>
                            <RoleBadge role={user.accessRole || (user.role === "admin" ? "admin" : "viewer")} />
                            {user.userId !== currentUser?.id && (
                                <SmallButton disabled={isBusy} onClick={() => toggleAdminRole(user)}>
                                    {user.role === "admin" ? "Remove admin" : "Make admin"}
                                </SmallButton>
                            )}
                        </PersonRow>
                    ))}
                </ul>
            )}
        </SectionCard>
    );
}
