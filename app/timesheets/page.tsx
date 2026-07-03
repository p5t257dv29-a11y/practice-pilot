import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createTimeEntry(formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  const { error } = await supabase.from("time_entries").insert({
    client_id: get("client_id") || null,
    job_id: get("job_id") || null,
    user_name: get("user_name") || "Paul Robinson",
    date: get("date") || new Date().toISOString().split("T")[0],
    hours: parseFloat(get("hours")) || 0,
    description: get("description"),
    billable: formData.get("billable") === "on",
    hourly_rate: parseFloat(get("hourly_rate")) || 0,
  });

  if (error) {
    console.error("Could not create time entry:", error.message);
  }

  revalidatePath("/timesheets");
}

async function deleteTimeEntry(id: string) {
  "use server";

  await supabase.from("time_entries").delete().eq("id", id);
  revalidatePath("/timesheets");
}

export default async function TimesheetsPage() {
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const [
    { data: entries, error },
    { data: clients },
    { data: jobs },
  ] = await Promise.all([
    supabase
      .from("time_entries")
      .select("*, clients(client_name), jobs(job_name)")
      .gte("date", thirtyDaysAgo)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, client_name")
      .order("client_name", { ascending: true }),
    supabase
      .from("jobs")
      .select("id, job_name, client_id")
      .order("job_name", { ascending: true }),
  ]);

  // Calculate totals
  const totalHours = (entries || []).reduce((sum, e) => sum + Number(e.hours), 0);
  const billableHours = (entries || []).filter(e => e.billable).reduce((sum, e) => sum + Number(e.hours), 0);
  const totalValue = (entries || []).filter(e => e.billable).reduce((sum, e) => sum + (Number(e.hours) * Number(e.hourly_rate)), 0);

  // Group by date
  const grouped = (entries || []).reduce((acc: Record<string, typeof entries>, entry) => {
    if (!entry) return acc;
    const date = entry.date;
    if (!acc[date]) acc[date] = [];
    acc[date]!.push(entry);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Timesheets</h1>
            <p className="text-sm text-slate-500 mt-0.5">Log and track time spent on client work.</p>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-4 flex gap-8">
          <div>
            <p className="text-xs text-slate-500">Total Hours (30 days)</p>
            <p className="text-2xl font-bold text-slate-900">{totalHours.toFixed(1)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Billable Hours</p>
            <p className="text-2xl font-bold text-blue-600">{billableHours.toFixed(1)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Billable Value</p>
            <p className="text-2xl font-bold text-green-600">£{totalValue.toFixed(2)}</p>
          </div>
        </div>
      </div>

      <div className="p-8 grid gap-8 lg:grid-cols-3">

        {/* Log Time Form */}
        <div className="lg:col-span-1">
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 sticky top-8">
            <h2 className="text-lg font-bold text-slate-900">Log Time</h2>

            <form action={createTimeEntry} className="mt-6 space-y-4">

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <input name="date" type="date" defaultValue={today}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Client</label>
                <select name="client_id"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="">Select a client</option>
                  {(clients || []).map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.client_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Job</label>
                <select name="job_id"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="">Select a job (optional)</option>
                  {(jobs || []).map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.job_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Hours *</label>
                <input name="hours" type="number" step="0.25" min="0.25" required
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="e.g. 1.5" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
                <textarea name="description" required rows={3}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="What did you work on?" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Staff Member</label>
                <input name="user_name" defaultValue="Paul Robinson"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Hourly Rate (£)</label>
                <input name="hourly_rate" type="number" step="0.01" min="0" defaultValue="0"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="e.g. 150" />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input name="billable" type="checkbox" defaultChecked className="w-4 h-4 rounded" />
                <span className="text-sm font-medium text-slate-700">Billable</span>
              </label>

              <button type="submit"
                className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Log Time
              </button>
            </form>
          </div>
        </div>

        {/* Time Entries */}
        <div className="lg:col-span-2 space-y-6">
          {Object.keys(grouped).length === 0 && (
            <div className="rounded-2xl bg-white p-12 shadow-sm border border-slate-100 text-center">
              <p className="text-slate-500">No time entries yet.</p>
              <p className="text-sm text-slate-400 mt-1">Log your first time entry using the form.</p>
            </div>
          )}

          {Object.entries(grouped).map(([date, dateEntries]) => {
            const dayTotal = (dateEntries || []).reduce((sum, e) => sum + Number(e.hours), 0);
            const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            });

            return (
              <div key={date} className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-slate-900">{formattedDate}</h2>
                  <span className="text-sm font-semibold text-slate-500">
                    {dayTotal.toFixed(1)} hrs
                  </span>
                </div>

                <div className="space-y-3">
                  {(dateEntries || []).map((entry) => (
                    <div key={entry.id}
                      className="flex items-start justify-between rounded-xl border border-slate-100 p-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">
                            {entry.clients?.client_name || "No client"}
                          </p>
                          {entry.jobs?.job_name && (
                            <span className="text-xs text-slate-400">· {entry.jobs.job_name}</span>
                          )}
                          {entry.billable ? (
                            <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-semibold">Billable</span>
                          ) : (
                            <span className="rounded-full bg-slate-100 text-slate-500 px-2 py-0.5 text-xs font-semibold">Non-billable</span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600 mt-0.5">{entry.description}</p>
                        <p className="text-xs text-slate-400 mt-1">{entry.user_name}</p>
                      </div>

                      <div className="flex items-center gap-4 ml-4">
                        <div className="text-right">
                          <p className="font-bold text-slate-900">{Number(entry.hours).toFixed(1)}h</p>
                          {entry.billable && Number(entry.hourly_rate) > 0 && (
                            <p className="text-xs text-green-600">
                              £{(Number(entry.hours) * Number(entry.hourly_rate)).toFixed(2)}
                            </p>
                          )}
                        </div>

                        <form action={deleteTimeEntry.bind(null, entry.id)}>
                          <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                            Delete
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
