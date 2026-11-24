import { Link, Navigate, useParams } from "react-router-dom";
import Aquariums from "../components/aquariums/Aquariums";
import MyAquariums from "../components/aquariums/MyAquariums";
import { PageHeader } from "../components/UiKit";

// tabs
const AQUARIUM_TABS = [
    { id: "all", label: "Aquariums" },
    { id: "mine", label: "My Aquariums" },
];

// aquariums page
export default function AquariumsPage() {
    const { tab } = useParams();
    if (!AQUARIUM_TABS.some(item => item.id === tab)) return <Navigate to="/aquariums/all" replace />;

    return (
        <div className="px-4 py-5">
            <PageHeader title="Aquariums" />
            <div className="mb-4 flex gap-2" role="tablist">
                {AQUARIUM_TABS.map(item => (
                    <Link
                        key={item.id}
                        to={`/aquariums/${item.id}`}
                        role="tab"
                        aria-selected={item.id === tab}
                        className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                            item.id === tab ? "bg-blue-500 text-white" : "bg-white text-slate-500 hover:text-blue-600"
                        }`}
                    >
                        {item.label}
                    </Link>
                ))}
            </div>
            {tab === "all" ? <Aquariums /> : <MyAquariums />}
        </div>
    );
}
