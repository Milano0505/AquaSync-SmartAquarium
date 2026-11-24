// role styles
const ROLE_BADGE_CLASSES = {
    owner: "bg-blue-100 text-blue-700",
    member: "bg-sky-100 text-sky-700",
    viewer: "bg-slate-100 text-slate-600",
};

// role badge
export default function RoleBadge({ role }) {
    return (
        <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${ROLE_BADGE_CLASSES[role] || ROLE_BADGE_CLASSES.viewer}`}
        >
            {role}
        </span>
    );
}
