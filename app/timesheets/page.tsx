import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import TimesheetLogForm from "./timesheet-log-form";
import StaffSwitcher from "./staff-switcher";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEFAULT_STAFF = "Paul Robinson";

function toDateStr(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayStr() {
  return toDateStr(new Date());
}

function mondayOf(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

async function logTime(weekStart: string, staffName: string, rate: number, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();

  await supabase.from("time_entries").insert({
    date: get("date"),
    client_id: get("client_id") || null,
    job_id: get("job_id") || null,
    hours: parseFloat(get("hours")) || 0,
    hourly_rate: rate,
    billable: formData.get("billable") === "on",
    description: get("description"),
    user_name: staffName,
  });

  revalidatePath(`/timesheets`);
}

async function updateTimeEntry(id: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();

  await supabase.from("time_entries").update({
    date: get("date"),
    client_id: get("client_id") || null,
    job_id: get("job_id") || null,
    hours: parseFloat(get("hours")) || 0,
    hourly_rate: parseFloat(get("hourly_rate")) || 0,
    billable: formData.get("billable") === "on",
    description: get("description"),
    user_name: get("user_name") || DEFAULT_STAFF,
  }).eq("id", id);

  revalidatePath(`/timesheets`);
}

async function deleteTimeEntry(id: string) {
  "use server";
  await supabase.from("time_entries").delete().eq("id", id);
  revalidatePath(`/timesheets`);
}

async function closeWeek(staffName: string, weekStart: string) {
  "use server";
  await supabase.from("timesheet_week_closures").insert({ staff_name: staffName, week_start: weekStart });
  revalidatePath(`/timesheets`);
}

async function reopenWeek(staffName: string, weekStart: string) {
  "use server";
  await supabase.from("timesheet_week_closures").delete().eq("staff_name", staffName).eq("week_start", weekStart);
  revalidatePath(`/timesheets`);
}

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; staff?: string; edit?: string; view?: string; day?: string; log?: string }>;
}) {
  const { week, staff, edit, view, day, log } = await searchParams;
  const staffName = staff || DEFAULT_STAFF;
  const weekStart = mondayOf(week || todayStr());
  const weekEnd = addDays(weekStart, 6);
  const viewMode = view === "day" ? "day" : "week";
  const selectedDay = day && day >= weekStart && day <= weekEnd ? day : weekStart;

  const [{ data: entries, error }, { data: clients }, { data: jobs }, { data: closure }, { data: staffRows }] = await Promise.all([
    supabase
      .from("time_entries")
      .select("*, clients(client_name), jobs(job_name)")
      .eq("user_name", staffName)
      .gte("date", weekStart)
      .lte("date", weekEnd)
      .order("date", { ascending: true }),
    supabase.from("clients").select("id, client_name").order("client_name", { ascending: true }),
    supabase.from("jobs").select("id, job_name, client_id").order("job_name", { ascending: true }),
    supabase.from("timesheet_week_closures").select("id").eq("staff_name", staffName).eq("week_start", weekStart).maybeSingle(),
    supabase.from("staff").select("name, charge_out_rate").eq("is_active", true).order("name", { ascending: true }),
  ]);

  const staffNames = Array.from(
    new Set([DEFAULT_STAFF, ...((staffRows || []).map((s) => s.name).filter(Boolean) as string[]), staffName])
  ).sort();

  const currentStaffRate = staffRows?.find((s) => s.name === staffName)?.charge_out_rate ?? 0;

  const isClosed = !!closure;

  const logTimeWithWeek = logTime.bind(null, weekStart, staffName, currentStaffRate);
  const closeWeekWithArgs = closeWeek.bind(null, staffName, weekStart);
  const reopenWeekWithArgs = reopenWeek.bind(null, staffName, weekStart);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  const entriesByDay = new Map<string, any[]>();
  days.forEach((d) => entriesByDay.set(d, []));
  (entries || []).forEach((e) => {
    if (entriesByDay.has(e.date)) entriesByDay.get(e.date)!.push(e);
  });

  const totalHours = (entries || []).reduce((s, e) => s + Number(e.hours), 0);
  const billableHours = (entries || []).filter((e) => e.billable).reduce((s, e) => s + Number(e.hours), 0);
  const billableValue = (entries || []).filter((e) => e.billable).reduce((s, e) => s + Number(e.hours) * Number(e.hourly_rate), 0);

  const baseParams = `week=${weekStart}&staff=${encodeURIComponent(staffName)}`;
  const prevWeekHref = `/timesheets?week=${addDays(weekStart, -7)}&staff=${encodeURIComponent(staffName)}&view=${viewMode}`;
  const nextWeekHref = `/timesheets?week=${addDays(weekStart, 7)}&staff=${encodeURIComponent(staffName)}&view=${viewMode}`;
  const todayWeekHref = `/timesheets?staff=${encodeURIComponent(staffName)}&view=${viewMode}`;
  const weekViewHref = `/timesheets?${baseParams}&view=week`;
  const dayViewHref = (d: string) => `/timesheets?${baseParams}&view=day&day=${d}`;
  const logModalHref = `/timesheets?${baseParams}&view=${viewMode}${viewMode === "day" ? `&day=${selectedDay}` : ""}&log=1`;
  const closeModalHref = `/timesheets?${baseParams}&view=${viewMode}${viewMode === "day" ? `&day=${selectedDay}` : ""}`;
  const entryEditHref = (entryId: string) => `${closeModalHref}&edit=${entryId}`;

  const daysToShow = viewMode === "day" ? [selectedDay] : days;

  const renderEntryRow = (entry: any) => {
    const isEditing = edit === entry.id;
    const entryJobs = (jobs || []).filter((j) => !entry.client_id || j.client_id === entry.client_id);

    if (isEditing) {
      return (
        <form
          key={entry.id}
          action={updateTimeEntry.bind(null, entry.id)}
          className="rounded-xl bg-white border border-slate-200 p-4 grid gap-3 md:grid-cols-3"
        >
          <select name="client_id" defaultValue={entry.client_id || ""}
            className="rounded-lg border border-slate-200 p-2.5 text-sm bg-white">
            <option value="">No client</option>
            {(clients || []).map((c) => (
              <option key={c.id} value={c.id}>{c.client_name}</option>
            ))}
          </select>
          <select name="job_id" defaultValue={entry.job_id || ""}
            className="rounded-lg border border-slate-200 p-2.5 text-sm bg-white">
            <option value="">No job</option>
            {entryJobs.map((j) => (
              <option key={j.id} value={j.id}>{j.job_name}</option>
            ))}
          </select>
          <input name="date" type="date" defaultValue={entry.date}
            className="rounded-lg border border-slate-200 p-2.5 text-sm bg-white" />
          <input name="hours" type="number" step="0.25" min="0.25" defaultValue={entry.hours}
            className="rounded-lg border border-slate-200 p-2.5 text-sm bg-white" placeholder="Hours" />
          <input name="hourly_rate" type="number" step="0.01" min="0" defaultValue={entry.hourly_rate}
            className="rounded-lg border border-slate-200 p-2.5 text-sm bg-white" placeholder="Rate £" />
          <input type="hidden" name="user_name" value={entry.user_name} />
          <textarea name="description" defaultValue={entry.description} rows={2}
            className="rounded-lg border border-slate-200 p-2.5 text-sm bg-white md:col-span-3" />
          <label className="flex items-center gap-2 cursor-pointer">
            <input name="billable" type="checkbox" defaultChecked={entry.billable} className="w-4 h-4 rounded" />
            <span className="text-sm text-slate-700">Billable</span>
          </label>
          <div className="flex items-center gap-3 md:col-span-2 md:justify-end">
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Save
            </button>
            <a href={closeModalHref} className="text-sm font-semibold text-slate-500 hover:text-slate-700">
              Cancel
            </a>
          </div>
        </form>
      );
    }

    return (
      <div key={entry.id} className="flex items-center justify-between gap-4 rounded-xl bg-white border border-slate-100 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-slate-900">{entry.clients?.client_name || "No client"}</p>
            {entry.jobs?.job_name && <span className="text-sm text-slate-400">· {entry.jobs.job_name}</span>}
            <span className={`text-xs px-2 py-0.5 rounded-full ${entry.billable ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
              {entry.billable ? "Billable" : "Non-billable"}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">{entry.description}</p>
        </div>
        <div className="flex items-center gap-6 flex-shrink-0">
          <p className="font-bold text-slate-900 font-mono tabular-nums text-lg">{Number(entry.hours).toFixed(2)}h</p>
          {!isClosed && (
            <div className="flex items-center gap-3">
              <a href={entryEditHref(entry.id)} className="text-sm font-semibold text-slate-500 hover:text-slate-700">Edit</a>
              <form action={deleteTimeEntry.bind(null, entry.id)}>
                <button className="text-sm font-semibold text-red-500 hover:text-red-700">Delete</button>
              </form>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Timesheets</h1>
            <p className="text-sm text-slate-500 mt-1">
              {new Date(weekStart + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long" })} –{" "}
              {new Date(weekEnd + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
              {isClosed && <span className="ml-2 rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-white">Closed</span>}
            </p>
          </div>
          <a href={logModalHref}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors whitespace-nowrap">
            + Log Time
          </a>
        </div>

        <div className="mt-5 flex items-center gap-3 flex-wrap">
          <div className="flex gap-2">
            <a href={prevWeekHref} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">← Prev</a>
            <a href={todayWeekHref} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">This Week</a>
            <a href={nextWeekHref} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">Next →</a>
          </div>

          <StaffSwitcher staffNames={staffNames} currentStaff={staffName} weekStart={weekStart} />

          <div className="flex rounded-xl bg-slate-100 p-1 ml-1">
            <a href={weekViewHref}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${viewMode === "week" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
              Week
            </a>
            <a href={dayViewHref(selectedDay)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${viewMode === "day" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
              Day
            </a>
          </div>

          <div className="flex-1" />

          {isClosed ? (
            <form action={reopenWeekWithArgs}>
              <button className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                Reopen Week
              </button>
            </form>
          ) : (
            <form action={closeWeekWithArgs}>
              <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Close Week
              </button>
            </form>
          )}
        </div>

        <div className="mt-6" style={{ display: "flex", gap: "2.5rem" }}>
          <div>
            <p className="text-xs text-slate-500">Total Hours</p>
            <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">{totalHours.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Billable Hours</p>
            <p className="text-2xl font-bold text-blue-600 font-mono tabular-nums mt-1">{billableHours.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Billable Value</p>
            <p className="text-2xl font-bold text-green-600 font-mono tabular-nums mt-1">£{billableValue.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
        </div>
      </div>

      {/* Day strip — calendar header across the top */}
      <div className="bg-white border-b border-slate-200 px-8 py-4">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "0.75rem" }}>
          {days.map((d, i) => {
            const dayEntries = entriesByDay.get(d) || [];
            const dayTotal = dayEntries.reduce((s, e) => s + Number(e.hours), 0);
            const isToday = d === todayStr();
            const isSelected = viewMode === "day" && d === selectedDay;
            return (
              <a key={d} href={dayViewHref(d)}
                className={`rounded-xl p-3 text-center transition-colors border ${
                  isSelected ? "bg-slate-900 border-slate-900" : isToday ? "bg-white border-slate-400" : "bg-white border-slate-100 hover:border-slate-300"
                }`}>
                <p className={`text-xs font-semibold ${isSelected ? "text-white" : "text-slate-900"}`}>{dayNames[i]}</p>
                <p className={`text-xs mt-0.5 ${isSelected ? "text-slate-300" : "text-slate-400"}`}>
                  {new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </p>
                <p className={`text-sm font-bold font-mono tabular-nums mt-1.5 ${isSelected ? "text-white" : dayTotal > 0 ? "text-slate-700" : "text-slate-300"}`}>
                  {dayTotal > 0 ? `${dayTotal.toFixed(1)}h` : "—"}
                </p>
              </a>
            );
          })}
        </div>
      </div>

      <div className="p-8 space-y-6 max-w-4xl mx-auto">
        {error && (
          <div className="rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load time entries: {error.message}
          </div>
        )}

        {daysToShow.map((d) => {
          const dayEntries = entriesByDay.get(d) || [];
          const dayIndex = days.indexOf(d);
          const dayTotal = dayEntries.reduce((s, e) => s + Number(e.hours), 0);

          return (
            <div key={d}>
              {viewMode === "week" && (
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold text-slate-900">
                    {dayNames[dayIndex]}{" "}
                    <span className="font-normal text-slate-400">
                      {new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
                    </span>
                  </h2>
                  {dayTotal > 0 && <span className="text-sm font-bold text-slate-600 font-mono tabular-nums">{dayTotal.toFixed(2)}h</span>}
                </div>
              )}

              <div className="space-y-3">
                {dayEntries.map(renderEntryRow)}
                {dayEntries.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">
                    <p className="text-sm text-slate-400">No time logged</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Log Time modal */}
      {log === "1" && !isClosed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15, 23, 42, 0.4)" }}>
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Log Time</h2>
              <a href={closeModalHref} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</a>
            </div>
            <div className="p-6">
              <TimesheetLogForm
                clients={clients || []}
                jobs={jobs || []}
                weekStart={weekStart}
                weekEnd={weekEnd}
                currentStaffRate={currentStaffRate}
                defaultDate={viewMode === "day" ? selectedDay : (todayStr() >= weekStart && todayStr() <= weekEnd ? todayStr() : weekStart)}
                logAction={logTimeWithWeek}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
