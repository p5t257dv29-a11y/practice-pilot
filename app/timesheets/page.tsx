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
  searchParams: Promise<{ week?: string; staff?: string; edit?: string }>;
}) {
  const { week, staff, edit } = await searchParams;
  const staffName = staff || DEFAULT_STAFF;
  const weekStart = mondayOf(week || todayStr());
  const weekEnd = addDays(weekStart, 6);

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

  const prevWeekHref = `/timesheets?week=${addDays(weekStart, -7)}&staff=${encodeURIComponent(staffName)}`;
  const nextWeekHref = `/timesheets?week=${addDays(weekStart, 7)}&staff=${encodeURIComponent(staffName)}`;
  const todayWeekHref = `/timesheets?staff=${encodeURIComponent(staffName)}`;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Timesheets</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {new Date(weekStart + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long" })} –{" "}
          {new Date(weekEnd + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          {isClosed && <span className="ml-2 rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-white">Closed</span>}
        </p>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <div className="flex gap-2">
            <a href={prevWeekHref} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">← Prev</a>
            <a href={todayWeekHref} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">This Week</a>
            <a href={nextWeekHref} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">Next →</a>
          </div>

          <StaffSwitcher staffNames={staffNames} currentStaff={staffName} weekStart={weekStart} />

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

        <div className="mt-4 flex gap-8">
          <div>
            <p className="text-xs text-slate-500">Total Hours</p>
            <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums">{totalHours.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Billable Hours</p>
            <p className="text-2xl font-bold text-blue-600 font-mono tabular-nums">{billableHours.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Billable Value</p>
            <p className="text-2xl font-bold text-green-600 font-mono tabular-nums">£{billableValue.toFixed(2)}</p>
          </div>
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-4 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load time entries: {error.message}
          </div>
        )}

        <div className="flex gap-6 items-start">
          <div className="w-80 flex-shrink-0">
            {!isClosed && (
              <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
                <h2 className="text-base font-bold text-slate-900 mb-4">Log Time</h2>
                <TimesheetLogForm
                  clients={clients || []}
                  jobs={jobs || []}
                  weekStart={weekStart}
                  weekEnd={weekEnd}
                  currentStaffRate={currentStaffRate}
                  defaultDate={todayStr() >= weekStart && todayStr() <= weekEnd
                    ? todayStr()
                    : weekStart}
                  logAction={logTimeWithWeek}
                />
              </div>
            )}

            {isClosed && (
              <div className="rounded-2xl bg-slate-100 border border-slate-200 p-4 text-sm text-slate-600">
                This week is closed. Reopen it above if you need to add or edit entries.
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "0.75rem" }}>
            {days.map((day, i) => {
              const dayEntries = entriesByDay.get(day) || [];
              const dayTotal = dayEntries.reduce((s, e) => s + Number(e.hours), 0);
              const isToday = day === todayStr();

              return (
                <div key={day} className={`rounded-2xl bg-white border p-2.5 ${isToday ? "border-slate-400" : "border-slate-100"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-900">{dayNames[i]}</p>
                      <p className="text-xs text-slate-400">{new Date(day + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
                    </div>
                    {dayTotal > 0 && <span className="text-xs font-bold text-slate-600 font-mono tabular-nums">{dayTotal.toFixed(1)}h</span>}
                  </div>

                  <div className="space-y-1.5">
                    {dayEntries.map((entry) => {
                      const isEditing = edit === entry.id;
                      const entryJobs = (jobs || []).filter((j) => !entry.client_id || j.client_id === entry.client_id);
                      const editHref = `/timesheets?week=${weekStart}&staff=${encodeURIComponent(staffName)}&edit=${entry.id}`;
                      const closeEditHref = `/timesheets?week=${weekStart}&staff=${encodeURIComponent(staffName)}`;

                      if (isEditing) {
                        return (
                          <form
                            key={entry.id}
                            action={updateTimeEntry.bind(null, entry.id)}
                            className="rounded-lg bg-white border border-slate-200 p-2 text-xs space-y-1.5"
                          >
                            <select name="client_id" defaultValue={entry.client_id || ""}
                              className="w-full rounded-lg border border-slate-200 p-1.5 text-xs bg-white">
                              <option value="">No client</option>
                              {(clients || []).map((c) => (
                                <option key={c.id} value={c.id}>{c.client_name}</option>
                              ))}
                            </select>
                            <select name="job_id" defaultValue={entry.job_id || ""}
                              className="w-full rounded-lg border border-slate-200 p-1.5 text-xs bg-white">
                              <option value="">No job</option>
                              {entryJobs.map((j) => (
                                <option key={j.id} value={j.id}>{j.job_name}</option>
                              ))}
                            </select>
                            <div className="flex gap-1.5">
                              <input name="date" type="date" defaultValue={entry.date}
                                className="w-1/2 rounded-lg border border-slate-200 p-1.5 text-xs bg-white" />
                              <input name="hours" type="number" step="0.25" min="0.25" defaultValue={entry.hours}
                                className="w-1/2 rounded-lg border border-slate-200 p-1.5 text-xs bg-white" />
                            </div>
                            <textarea name="description" defaultValue={entry.description} rows={2}
                              className="w-full rounded-lg border border-slate-200 p-1.5 text-xs bg-white" />
                            <input name="hourly_rate" type="number" step="0.01" min="0" defaultValue={entry.hourly_rate}
                              className="w-full rounded-lg border border-slate-200 p-1.5 text-xs bg-white" placeholder="Rate £" />
                            <input type="hidden" name="user_name" value={entry.user_name} />
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input name="billable" type="checkbox" defaultChecked={entry.billable} className="w-3.5 h-3.5 rounded" />
                              <span className="text-[11px] text-slate-700">Billable</span>
                            </label>
                            <div className="flex items-center justify-between pt-0.5">
                              <button type="submit" className="rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700 transition-colors">
                                Save
                              </button>
                              <a href={closeEditHref} className="text-[11px] font-semibold text-slate-500 hover:text-slate-700">
                                Cancel
                              </a>
                            </div>
                          </form>
                        );
                      }

                      return (
                        <div key={entry.id} className="rounded-lg bg-slate-50 p-2 text-xs">
                          <div className="flex items-start justify-between gap-1">
                            <p className="font-semibold text-slate-800 leading-tight">
                              {entry.clients?.client_name || "No client"}
                            </p>
                            <span className="font-bold text-slate-900 flex-shrink-0 font-mono tabular-nums">{Number(entry.hours).toFixed(2)}h</span>
                          </div>
                          {entry.jobs?.job_name && <p className="text-slate-500">{entry.jobs.job_name}</p>}
                          <p className="text-slate-500 mt-0.5">{entry.description}</p>
                          <div className="flex items-center justify-between mt-1">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${entry.billable ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                              {entry.billable ? "Billable" : "Non-billable"}
                            </span>
                            {!isClosed && (
                              <div className="flex items-center gap-2">
                                <a href={editHref} className="text-slate-500 hover:text-slate-700 text-[10px] font-semibold">Edit</a>
                                <form action={deleteTimeEntry.bind(null, entry.id)}>
                                  <button className="text-red-500 hover:text-red-700 text-[10px] font-semibold">Delete</button>
                                </form>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {dayEntries.length === 0 && (
                      <p className="text-[11px] text-slate-300 text-center py-3">No time logged</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
