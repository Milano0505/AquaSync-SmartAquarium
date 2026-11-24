import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getInitials } from "../utils/displayFormatters";
import {
    BellIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    DashboardIcon,
    FishIcon,
    HistoryIcon,
    LogoutIcon,
    SettingsIcon,
} from "./Icons";

// nav items
const NAV_ITEMS = {
    dashboard: { path: "/dashboard", label: "Dashboard", icon: DashboardIcon },
    history: { path: "/history", label: "History", icon: HistoryIcon },
    alerts: { path: "/notifications", label: "Alerts", icon: BellIcon },
    config: { path: "/configuration", label: "Config", icon: SettingsIcon },
    aquariums: { path: "/aquariums", label: "Aquariums", icon: FishIcon },
};
// sidebar color
const SIDEBAR_BACKGROUND_COLOR = "#0d1b4b";

// role badge
const HEADER_ROLE_BADGE_CLASSES = {
    owner: "bg-blue-500/40 text-blue-100",
    member: "bg-sky-500/30 text-sky-100",
    viewer: "bg-white/10 text-slate-300",
};

// unread badge
function UnreadBadge({ count }) {
    if (count <= 0) return null;
    return (
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">
            {count > 9 ? "9+" : count}
        </span>
    );
}

// app layout
export default function AppLayout({ children, unreadNotificationCount = 0, successNotice, onDismissSuccessNotice }) {
    const {
        user,
        signOut,
        aquariums,
        activeAquariumId,
        activeAquariumRole,
        selectActiveAquarium,
        isViewer,
        isViewingOtherAquarium,
        viewedAquariumName,
        stopViewing,
    } = useAuth();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    // sidebar state
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

    const displayName = user?.fullName || "Aquarist";
    // visible nav
    const hasAquarium = Boolean(activeAquariumId);
    const visibleNavItems = [
        ...(hasAquarium ? [NAV_ITEMS.dashboard] : []),
        ...(hasAquarium && !isViewer ? [NAV_ITEMS.history, NAV_ITEMS.alerts] : []),
        NAV_ITEMS.aquariums,
        NAV_ITEMS.config,
    ];
    // active path
    const isNavPathActive = path => pathname === path || pathname.startsWith(`${path}/`);
    const pageLabel = visibleNavItems.find(item => isNavPathActive(item.path))?.label || "Dashboard";

    // sign out
    const handleSignOut = async () => {
        try {
            await signOut();
        } catch (error) {
            console.warn("Sign out completed with a storage error.", error);
        } finally {
            navigate("/login", { replace: true });
        }
    };

    return (
        <div className="min-h-screen bg-slate-100 flex">
            {/* sidebar */}
            <aside
                id="desktop-sidebar"
                className={`hidden md:flex flex-col ${isSidebarCollapsed ? "w-16" : "w-64"} fixed top-0 left-0 bottom-0 flex-shrink-0 shadow-xl z-30 overflow-hidden transition-all duration-200`}
                style={{ background: SIDEBAR_BACKGROUND_COLOR }}
            >
                <div className="flex-shrink-0 h-16" />
                <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
                    {visibleNavItems.map(({ path, label, icon: NavIcon }) => (
                        <button
                            key={path}
                            onClick={() => navigate(path)}
                            title={isSidebarCollapsed ? label : undefined}
                            className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold transition-all ${
                                isSidebarCollapsed ? "justify-center" : ""
                            } ${
                                isNavPathActive(path)
                                    ? "bg-blue-500 text-white shadow-md shadow-blue-500/30"
                                    : "text-blue-100/70 hover:bg-white/10 hover:text-white"
                            }`}
                        >
                            <span className="flex-shrink-0 relative">
                                <NavIcon />
                                {path === "/notifications" && <UnreadBadge count={unreadNotificationCount} />}
                            </span>
                            {!isSidebarCollapsed && <span className="truncate">{label}</span>}
                        </button>
                    ))}
                </nav>

                <div className="px-3 py-4 border-t border-white/10 flex-shrink-0">
                    <button
                        onClick={handleSignOut}
                        title={isSidebarCollapsed ? "Sign Out" : undefined}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-all ${
                            isSidebarCollapsed ? "justify-center px-3" : ""
                        }`}
                    >
                        <LogoutIcon />
                        {!isSidebarCollapsed && <span>Sign Out</span>}
                    </button>
                </div>
            </aside>

            <button
                type="button"
                onClick={() => setIsSidebarCollapsed(current => !current)}
                aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!isSidebarCollapsed}
                aria-controls="desktop-sidebar"
                title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                className={`hidden md:flex fixed top-20 ${
                    isSidebarCollapsed ? "left-16" : "left-64"
                } z-40 h-10 w-6 items-center justify-center rounded-r-lg border border-l-0 border-white/20 bg-[#0d1b4b] text-white shadow-md transition-all duration-200 hover:bg-blue-700`}
            >
                {isSidebarCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </button>

            <div
                className={`flex-1 flex flex-col min-h-screen min-w-0 ${isSidebarCollapsed ? "md:ml-16" : "md:ml-64"} transition-all duration-200`}
            >
                {/* header */}
                <header
                    className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 md:px-6 h-14 md:h-16 shadow-sm overflow-hidden"
                    style={{ background: SIDEBAR_BACKGROUND_COLOR }}
                >
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-white">
                            <FishIcon />
                            {!isSidebarCollapsed && (
                                <div className="leading-none">
                                    <div className="text-white text-sm font-bold tracking-widest leading-none">
                                        SMART
                                    </div>
                                    <div className="text-blue-300 text-[10px] font-semibold tracking-widest leading-none">
                                        AQUARIUM
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="hidden md:flex items-center gap-3">
                            <span className="w-px h-6 bg-white/20" />
                            <span className="text-white/70 text-sm font-semibold">{pageLabel}</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                        {(aquariums.length > 0 || isViewingOtherAquarium) && (
                            <div className="flex items-center gap-2">
                                {isViewingOtherAquarium ? (
                                    <>
                                        <span className="hidden max-w-[140px] truncate text-xs font-semibold text-white/80 md:inline">
                                            {viewedAquariumName}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                stopViewing();
                                                navigate("/aquariums/all");
                                            }}
                                            className="rounded-lg border border-white/20 px-2 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/10"
                                        >
                                            Exit view
                                        </button>
                                    </>
                                ) : aquariums.length > 1 ? (
                                    <select
                                        value={activeAquariumId || ""}
                                        onChange={event => selectActiveAquarium(event.target.value)}
                                        aria-label="Select aquarium"
                                        className="max-w-[140px] rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-xs font-semibold text-white outline-none"
                                    >
                                        {aquariums.map(item => (
                                            <option key={item.id} value={item.id} className="text-slate-800">
                                                {item.name}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <span className="hidden max-w-[140px] truncate text-xs font-semibold text-white/80 md:inline">
                                        {aquariums[0].name}
                                    </span>
                                )}
                                {activeAquariumRole && (
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${HEADER_ROLE_BADGE_CLASSES[activeAquariumRole] || HEADER_ROLE_BADGE_CLASSES.viewer}`}
                                    >
                                        {activeAquariumRole}
                                    </span>
                                )}
                            </div>
                        )}
                        <button
                            onClick={() => navigate("/configuration")}
                            className="flex items-center gap-2.5 flex-shrink-0"
                        >
                            {user?.photoUrl ? (
                                <img
                                    src={user.photoUrl}
                                    alt={displayName}
                                    className="w-8 h-8 rounded-full object-cover border-2 border-blue-400"
                                />
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold border-2 border-blue-400">
                                    {getInitials(user?.fullName, "SA")}
                                </div>
                            )}
                            <div className="hidden md:block text-left min-w-0">
                                <div className="text-white text-sm font-semibold leading-none truncate max-w-[140px]">
                                    {displayName}
                                </div>
                                <div className="text-blue-300 text-[11px] leading-none mt-0.5 truncate max-w-[140px]">
                                    {user?.email || ""}
                                </div>
                            </div>
                        </button>
                    </div>
                </header>

                {/* content */}
                <main
                    className="flex-1 overflow-y-auto scroll-area md:p-6 mt-14 md:mt-16"
                    style={{ paddingBottom: "calc(56px + env(safe-area-inset-bottom, 0px))" }}
                >
                    <div className="mx-auto w-full max-w-[1600px]">{children}</div>
                </main>
            </div>

            {/* success notice */}
            {successNotice && (
                <div
                    role="status"
                    aria-live="polite"
                    className="fixed right-4 top-20 z-50 w-[calc(100vw-2rem)] max-w-sm"
                >
                    <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 shadow-lg">
                        <span className="flex-shrink-0" aria-hidden="true">
                            ✅
                        </span>
                        <p className="flex-1">{successNotice}</p>
                        <button
                            type="button"
                            onClick={onDismissSuccessNotice}
                            aria-label="Dismiss notification"
                            className="-mr-1 -mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-green-700 hover:bg-green-100"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}

            {/* mobile nav */}
            <nav
                className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-slate-200 bg-white md:hidden"
                style={{
                    height: "calc(56px + env(safe-area-inset-bottom, 0px))",
                    paddingBottom: "env(safe-area-inset-bottom, 0px)",
                }}
            >
                {visibleNavItems.map(({ path, label, icon: NavIcon }) => {
                    const isActive = isNavPathActive(path);
                    return (
                        <button
                            key={path}
                            onClick={() => navigate(path)}
                            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 transition-colors ${
                                isActive ? "text-blue-600" : "text-slate-400 hover:text-slate-600"
                            }`}
                        >
                            <span className="relative flex-shrink-0">
                                <NavIcon />
                                {path === "/notifications" && <UnreadBadge count={unreadNotificationCount} />}
                            </span>
                            <span className="text-[10px] font-semibold leading-none">{label}</span>
                            {isActive && <span className="absolute top-0 w-8 h-0.5 bg-blue-500 rounded-full" />}
                        </button>
                    );
                })}
            </nav>
        </div>
    );
}
