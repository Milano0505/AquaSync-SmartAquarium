import { useEffect, useState } from "react";
import { exportTelemetryCsv, getAquariumDetail, getTelemetryRecords } from "../api/backendApi";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, SearchIcon } from "../components/Icons";
import { Card, ErrorAlert, PageHeader, LoadingSpinner, StatusBadge } from "../components/UiKit";
import { useAuth } from "../context/AuthContext";

// page size
const RECORDS_PER_PAGE = 10;
// event filters
const EVENT_FILTERS = ["all", "heater", "led", "feeder", "temp", "system"];
// tabs
const HISTORY_TABS = [
    { id: "table", label: "📋 Table" },
    { id: "calendar", label: "📅 Calendar" },
];
// month names
const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
// weekday names
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// date key
const toDateKey = (year, month, day) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

// format datetime
const formatRecordDateTime = timestamp =>
    new Date(timestamp).toLocaleString("en-PH", { dateStyle: "short", timeStyle: "short" });

// format time
const formatRecordTime = timestamp =>
    new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

// download csv
async function downloadTelemetryCsv(aquariumId) {
    const { csv, filename } = await exportTelemetryCsv(aquariumId);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// header style
const TABLE_HEADER_CLASS_NAME =
    "px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap";

// status cells
function DeviceStatusCells({ record }) {
    return [record.heaterState, record.ledState, record.feederState].map((status, index) => (
        <td key={index} className="px-4 py-3">
            <StatusBadge status={status} />
        </td>
    ));
}

// record list
function RecordList({ records, leadingColumns }) {
    if (records.length === 0) {
        return <div className="text-center py-10 text-slate-400 text-sm">No records found.</div>;
    }

    return (
        <>
            {/* desktop table */}
            <div className="hidden md:block bg-white rounded-2xl shadow-sm overflow-hidden border border-slate-100">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                            {[
                                ...leadingColumns.map(([header]) => header),
                                "Temp",
                                "Heater",
                                "LED",
                                "Feeder",
                                "Event",
                            ].map(header => (
                                <th key={header} className={TABLE_HEADER_CLASS_NAME}>
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {records.map((record, index) => (
                            <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                                {leadingColumns.map(([header, render]) => (
                                    <td key={header} className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                                        {render(record, index)}
                                    </td>
                                ))}
                                <td className="px-4 py-3 font-bold text-blue-600 whitespace-nowrap">{record.temp}°C</td>
                                <DeviceStatusCells record={record} />
                                <td className="px-4 py-3 text-xs text-slate-600 max-w-[200px] truncate">
                                    {record.event}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* mobile cards */}
            <div className="md:hidden space-y-3">
                {records.map((record, index) => (
                    <Card key={record.id} className="p-4">
                        <div className="flex items-start justify-between mb-2">
                            <div className="text-xs text-slate-500 space-y-0.5">
                                {leadingColumns.map(([header, render]) => (
                                    <div key={header}>{render(record, index)}</div>
                                ))}
                            </div>
                            <div className="text-lg font-bold text-blue-600">{record.temp}°C</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mb-2">
                            {[
                                ["Heater", record.heaterState],
                                ["LED", record.ledState],
                                ["Feeder", record.feederState],
                            ].map(([name, status]) => (
                                <span key={name} className="flex items-center gap-1.5 mr-1">
                                    <span className="text-xs text-slate-500">{name}:</span>
                                    <StatusBadge status={status} />
                                </span>
                            ))}
                        </div>
                        <div className="text-xs text-slate-600 bg-slate-50 rounded-lg px-2 py-1.5">
                            📋 {record.event}
                        </div>
                    </Card>
                ))}
            </div>
        </>
    );
}

// table tab
function HistoryTableTab({ records }) {
    const { activeAquariumId } = useAuth();
    // state
    const [searchText, setSearchText] = useState("");
    const [eventFilter, setEventFilter] = useState("all");
    const [currentPage, setCurrentPage] = useState(1);
    const [isExporting, setIsExporting] = useState(false);
    const [exportError, setExportError] = useState("");

    // filter records
    const searchQuery = searchText.toLowerCase();
    const filteredRecords = records.filter(record => {
        // changes tersembunyi
        const matchesSearch =
            !searchQuery ||
            Object.entries(record).some(
                ([field, value]) => field !== "changes" && String(value).toLowerCase().includes(searchQuery),
            );
        const matchesFilter = eventFilter === "all" || (record.changes || []).includes(eventFilter);
        return matchesSearch && matchesFilter;
    });
    const totalPages = Math.ceil(filteredRecords.length / RECORDS_PER_PAGE);
    const firstIndex = (currentPage - 1) * RECORDS_PER_PAGE;
    const pageRecords = filteredRecords.slice(firstIndex, firstIndex + RECORDS_PER_PAGE);

    // summary stats
    const summaryStats = [
        ["📊", "Records", records.length || "No Data"],
        [
            "🌡️",
            "Avg Temp",
            records.length
                ? `${(records.reduce((sum, record) => sum + record.temp, 0) / records.length).toFixed(1)}°C`
                : "--",
        ],
        ["🔥", "Heater ON", records.length ? records.filter(record => record.heaterState === "ON").length : "--"],
        ["🐠", "Feedings", records.length ? records.filter(record => record.feederState === "Active").length : "--"],
    ];

    // export csv
    const handleExportCsv = async () => {
        setExportError("");
        setIsExporting(true);
        try {
            await downloadTelemetryCsv(activeAquariumId);
        } catch (error) {
            setExportError(error.message || "Could not export telemetry data.");
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {summaryStats.map(([icon, label, value]) => (
                    <Card key={label} className="p-3">
                        <div className="text-xl mb-0.5">{icon}</div>
                        <div className="text-xl font-bold text-slate-800">{value}</div>
                        <div className="text-xs text-slate-400">{label}</div>
                    </Card>
                ))}
            </div>

            <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <SearchIcon />
                </span>
                <input
                    value={searchText}
                    onChange={event => {
                        setSearchText(event.target.value);
                        setCurrentPage(1);
                    }}
                    placeholder="Search records…"
                    className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                {EVENT_FILTERS.map(name => (
                    <button
                        key={name}
                        onClick={() => {
                            setEventFilter(name);
                            setCurrentPage(1);
                        }}
                        className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                            eventFilter === name
                                ? "bg-blue-500 text-white"
                                : "bg-white border border-slate-200 text-slate-600"
                        }`}
                    >
                        {name.charAt(0).toUpperCase() + name.slice(1)}
                    </button>
                ))}
            </div>

            <RecordList
                records={pageRecords}
                leadingColumns={[
                    ["#", (_, index) => <span className="font-mono text-slate-400">#{firstIndex + index + 1}</span>],
                    ["Timestamp", record => formatRecordDateTime(record.timestamp)],
                ]}
            />

            {totalPages > 1 && (
                <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-4 py-3">
                    <span className="text-xs text-slate-500">
                        {firstIndex + 1}–{Math.min(firstIndex + RECORDS_PER_PAGE, filteredRecords.length)} of{" "}
                        {filteredRecords.length}
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setCurrentPage(current => Math.max(1, current - 1))}
                            disabled={currentPage === 1}
                            aria-label="Previous page"
                            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40 transition-colors"
                        >
                            <ChevronLeftIcon />
                        </button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                            .filter(number => Math.abs(number - currentPage) <= 1)
                            .map(number => (
                                <button
                                    key={number}
                                    onClick={() => setCurrentPage(number)}
                                    className={`w-8 h-8 rounded-lg text-xs font-semibold transition-colors ${
                                        number === currentPage
                                            ? "bg-blue-500 text-white"
                                            : "text-slate-600 hover:bg-slate-100"
                                    }`}
                                >
                                    {number}
                                </button>
                            ))}
                        <button
                            onClick={() => setCurrentPage(current => Math.min(totalPages, current + 1))}
                            disabled={currentPage === totalPages}
                            aria-label="Next page"
                            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40 transition-colors"
                        >
                            <ChevronRightIcon />
                        </button>
                    </div>
                </div>
            )}

            <ErrorAlert message={exportError} />
            <button
                onClick={handleExportCsv}
                disabled={isExporting}
                className="w-full flex items-center justify-center gap-2 py-3 bg-slate-800 text-white text-sm font-semibold rounded-xl hover:bg-slate-900 transition-colors disabled:opacity-60"
            >
                <DownloadIcon /> {isExporting ? "Exporting…" : "Export CSV"}
            </button>
        </div>
    );
}

// calendar tab
function HistoryCalendarTab({ records }) {
    const now = new Date();
    // state
    const [viewYear, setViewYear] = useState(now.getFullYear());
    const [viewMonth, setViewMonth] = useState(now.getMonth());
    const [selectedDate, setSelectedDate] = useState(null);

    // group date
    const recordsByDate = new Map();
    records.forEach(record => {
        const timestamp = new Date(record.timestamp);
        if (!Number.isFinite(timestamp.getTime())) return;
        const key = toDateKey(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate());
        recordsByDate.set(key, [...(recordsByDate.get(key) || []), record]);
    });

    const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();
    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
    const leadingBlanks = new Date(viewYear, viewMonth, 1).getDay();
    const calendarCells = [...Array(leadingBlanks).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];
    const dayRecords = selectedDate ? recordsByDate.get(selectedDate) || [] : [];

    // change month
    const changeMonth = offset => {
        const next = new Date(viewYear, viewMonth + offset, 1);
        setViewYear(next.getFullYear());
        setViewMonth(next.getMonth());
        setSelectedDate(null);
    };

    return (
        <div className="space-y-4">
            <Card>
                <div className="flex items-center justify-between mb-4">
                    <button
                        onClick={() => changeMonth(-1)}
                        aria-label="Previous month"
                        className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-600"
                    >
                        <ChevronLeftIcon />
                    </button>
                    <span className="text-sm font-bold text-slate-800">
                        {MONTHS[viewMonth]} {viewYear}
                    </span>
                    <button
                        onClick={() => changeMonth(1)}
                        disabled={isCurrentMonth}
                        aria-label="Next month"
                        className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <ChevronRightIcon />
                    </button>
                </div>

                <div className="grid grid-cols-7 mb-1">
                    {WEEKDAYS.map(day => (
                        <div key={day} className="text-center text-[10px] font-bold text-slate-400 py-1">
                            {day}
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-7 gap-y-1">
                    {calendarCells.map((day, index) => {
                        if (!day) return <div key={`blank-${index}`} />;
                        const key = toDateKey(viewYear, viewMonth, day);
                        const isSelected = selectedDate === key;
                        const isFuture = new Date(viewYear, viewMonth, day) > now;
                        const isToday = isCurrentMonth && day === now.getDate();
                        const stateClass = isFuture
                            ? "text-slate-300 cursor-not-allowed"
                            : isSelected
                              ? "bg-blue-500 text-white shadow-md"
                              : isToday
                                ? "bg-blue-50 text-blue-600"
                                : "hover:bg-slate-100 text-slate-700";
                        return (
                            <button
                                key={key}
                                onClick={() => setSelectedDate(key)}
                                disabled={isFuture}
                                className={`relative flex flex-col items-center justify-center rounded-xl py-2 mx-0.5 transition-all text-sm font-semibold ${stateClass}`}
                            >
                                {day}
                                {recordsByDate.has(key) && !isFuture && (
                                    <span
                                        className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${
                                            isSelected ? "bg-white/70" : "bg-blue-400"
                                        }`}
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-50 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                        Has data
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-4 h-4 rounded-lg bg-blue-50 inline-block border border-blue-200" />
                        Today
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-4 h-4 rounded-lg bg-blue-500 inline-block" />
                        Selected
                    </span>
                </div>
            </Card>

            {selectedDate ? (
                <div>
                    <div className="mb-3">
                        <p className="text-sm font-bold text-slate-800">
                            {new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-PH", {
                                weekday: "long",
                                year: "numeric",
                                month: "long",
                                day: "numeric",
                            })}
                        </p>
                        <p className="text-xs text-slate-400">
                            {dayRecords.length} record{dayRecords.length !== 1 ? "s" : ""} found
                        </p>
                    </div>
                    {dayRecords.length === 0 ? (
                        <Card className="flex flex-col items-center py-10 text-slate-400">
                            <div className="text-3xl mb-2">📭</div>
                            <p className="text-sm">No data recorded on this day.</p>
                        </Card>
                    ) : (
                        <RecordList
                            records={dayRecords}
                            leadingColumns={[["Time", record => formatRecordTime(record.timestamp)]]}
                        />
                    )}
                </div>
            ) : (
                <Card className="flex flex-col items-center py-8 text-slate-400">
                    <div className="text-3xl mb-2">📅</div>
                    <p className="text-sm">Select a date to view recorded data.</p>
                    <p className="text-xs mt-1">Days with a blue dot have sensor records.</p>
                </Card>
            )}
        </div>
    );
}

// history page
export default function DataHistoryPage() {
    const { activeAquariumId } = useAuth();
    // state
    const [records, setRecords] = useState([]);
    const [timezone, setTimezone] = useState("Asia/Manila");
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [activeTab, setActiveTab] = useState("table");

    // fetch history
    useEffect(() => {
        let isMounted = true;
        Promise.all([getTelemetryRecords(activeAquariumId, { limit: 500 }), getAquariumDetail(activeAquariumId)])
            .then(([{ telemetryRecords }, aquarium]) => {
                if (!isMounted) return;
                setRecords(telemetryRecords);
                setTimezone(aquarium?.systemConfig?.timezone || "Asia/Manila");
            })
            .catch(error => isMounted && setLoadError(error.message || "Could not load telemetry history."))
            .finally(() => isMounted && setIsLoading(false));
        return () => {
            isMounted = false;
        };
    }, []);

    if (isLoading || loadError) {
        return (
            <div className="px-4 py-5">
                <PageHeader title="Data History" />
                {isLoading ? <LoadingSpinner /> : <ErrorAlert message={loadError} />}
            </div>
        );
    }

    return (
        <div className="px-4 py-5">
            <PageHeader
                title="Data History"
                subtitle={records.length ? `${records.length} total records` : "No Data"}
                timezone={timezone}
            />

            <div className="flex gap-2 mb-5">
                {HISTORY_TABS.map(item => (
                    <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-semibold transition-all ${
                            activeTab === item.id
                                ? "bg-blue-500 text-white shadow-sm"
                                : "bg-white border border-slate-200 text-slate-600 hover:border-blue-300"
                        }`}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {activeTab === "table" ? <HistoryTableTab records={records} /> : <HistoryCalendarTab records={records} />}
        </div>
    );
}
