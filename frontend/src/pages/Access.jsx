import AdminAccess from "../components/access/AdminAccess";
import OwnerAccess from "../components/access/OwnerAccess";
import { PageHeader } from "../components/UiKit";
import { useAuth } from "../context/AuthContext";

// access page
export default function AccessPage() {
    const { isAdmin } = useAuth();
    return (
        <div className="px-4 py-5">
            <PageHeader
                title="Access"
            />
            {isAdmin ? <AdminAccess /> : <OwnerAccess />}
        </div>
    );
}
