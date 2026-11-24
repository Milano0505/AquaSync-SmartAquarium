import { useState } from "react";
import { ErrorAlert, SuccessAlert } from "../UiKit";

// input style
export const INPUT_CLASS_NAME =
    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-400";

// api action
export function useApiAction() {
    // state
    const [status, setStatus] = useState({ error: "", saved: "" });
    const [isBusy, setIsBusy] = useState(false);

    // run action
    const runApiAction = async (action, successMessage) => {
        setStatus({ error: "", saved: "" });
        setIsBusy(true);
        try {
            const result = await action();
            setStatus({ error: "", saved: successMessage });
            return result ?? true;
        } catch (error) {
            setStatus({ error: error.message || "Request failed.", saved: "" });
            return false;
        } finally {
            setIsBusy(false);
        }
    };

    return { status, isBusy, runApiAction, clearStatus: () => setStatus({ error: "", saved: "" }) };
}

// section card
export function SectionCard({ title, description, headerAction, children, className = "" }) {
    return (
        <section className={`rounded-2xl border border-slate-200 bg-white ${className}`}>
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div className="min-w-0">
                    <h2 className="text-sm font-bold text-slate-800">{title}</h2>
                    {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
                </div>
                {headerAction && <div className="flex-shrink-0">{headerAction}</div>}
            </div>
            <div className="space-y-3 p-4">{children}</div>
        </section>
    );
}

// status messages
export function StatusMessages({ status, extraError }) {
    return (
        <>
            <ErrorAlert message={extraError || status.error} />
            <SuccessAlert message={status.saved} />
        </>
    );
}

// person row
export function PersonRow({ person, children }) {
    const name = person.fullName || person.email || person.userId;
    return (
        <li className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-600">
                    {name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800">{name}</div>
                    {person.email && <div className="truncate text-xs text-slate-400">{person.email}</div>}
                </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">{children}</div>
        </li>
    );
}

// empty state
export function EmptyState({ children }) {
    return <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">{children}</p>;
}

// small button
export function SmallButton({ children, onClick, disabled, tone = "default", type = "button" }) {
    const tones = {
        default: "border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600",
        primary: "border-blue-500 bg-blue-500 text-white hover:bg-blue-600",
        danger: "border-red-200 text-red-500 hover:bg-red-50",
    };
    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${tones[tone]}`}
        >
            {children}
        </button>
    );
}

// device key notice
export function DeviceKeyNotice({ deviceKey }) {
    const [isKeyCopied, setIsKeyCopied] = useState(false);
    if (!deviceKey) return null;

    // copy key
    const copyDeviceKey = async () => {
        try {
            await navigator.clipboard.writeText(deviceKey);
            setIsKeyCopied(true);
        } catch {
            setIsKeyCopied(false);
        }
    };

    return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <div className="mb-1 font-semibold">Copy this key now. It will not be shown again.</div>
            <code className="block break-all rounded bg-white px-2 py-1.5 text-xs">{deviceKey}</code>
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <SmallButton onClick={copyDeviceKey}>{isKeyCopied ? "Copied" : "Copy key"}</SmallButton>
                <span className="text-xs">Put it in device/include/secrets.h as DEVICE_KEY.</span>
            </div>
        </div>
    );
}
