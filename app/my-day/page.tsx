import { createClient } from "@supabase/supabase-js";
import { computeDeadlines, getUrgencyColor, getDaysUntil } from "../deadlines/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function MyDayPage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string }>;
}) {
  const { staff: selectedStaff } = await searchParams;

  const { data: staffList } = await supabase
    .from("staff")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true });

  const activeStaffName = selectedStaff || staffList?.[0]?.name || "";

  const [
    { data: myJobs },
    { data: myClients },
  ] = await Promise.all([
    activeStaffName
      ? supabase
          .from("jobs")
          .select("*, clients(client_name)")
          .eq("assigned_to", activeStaffName)
          .not("status", "in", "(Completed,Cancelled)")
          .order("due_date", { ascending: true, nullsFirst: false })
      : Promise.resolve({ data: [] }),
    activeStaffName
      ? supabase
          .from("clients")
          .select("id, client_name, company_number, entity_type, accounts_next_due, confirmation_statement_next_due, requires_self_assessment, vat_stagger_group, paye_reference")
          .eq("assigned_staff", activeStaffName)
      : Promise.resolve({ data: [] }),
  ]);

  const jobIds = (myJobs || []).map((j) => j.id);
  const { data: checklistItems } = jobIds.length > 0
    ? await supabase
        .from("job_checklist_items")
        .select("job_id, item_text, is_received")
        .in("job_id", jobIds)
        .eq("is_received", false)
    : { data: [] };

  const outstandingByJob = new Map<string, number>();
  (checklistItems || []).forEach((item) => {
    outstandingByJob.set(item.job_id, (outstandingByJob.get(item.job_id) || 0) + 1);
  });

  const myDeadlines = computeDeadlines(myClients || [])
    .filter((d) => d.days <= 30)
    .sort((a, b) => a.days - b.days);

  const jobsWithDueDate = (myJobs || []).filter((j) => j.due_date);
  const jobsWithoutDueDate = (myJobs || []).filter((j) => !j.due_date);
  const sortedJobs = [...jobsWithDueDate, ...jobsWithoutDueDate];

  const overdueJobs = sortedJobs.filter((j) => j.due_date && getDaysUntil(new Date(j.due_date)) < 0);
  const todayCount = overdueJobs.length + myDeadlines.filter((d) => d.days < 0).length;

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">My Day</h1>
            <p className="text-sm text-slate-500 mt-0.5">{today}</p>
          </div>

          <form method="get" className="flex items-center gap-2">
            <select name="staff" defaultValue={activeStaffName}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
              {(staffList || []).map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
            <button type="submit"
              className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
              Switch
            </button>
          </form>
        </div>

        {todayCount > 0 && (
          <div className="mt-4 rounded-xl bg-red-50 border border-red-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-red-700">
              ⚠ {todayCount} item{todayCount !== 1 ? "s" : ""} overdue
            </p>
          </div>
        )}
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">

        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">My Jobs ({sortedJobs.length})</h2>
            <div className="mt-4 space-y-2">
              {sortedJobs.map((job) => {
                const daysUntilDue = job.due_date ? getDaysUntil(new Date(job.due_date)) : null;
                const urgency = daysUntilDue !== null ? getUrgencyColor(daysUntilDue) : null;
                const outstandingCount = outstandingByJob.get(job.id) || 0;

                return (
                  <a key={job.id} href={`/jobs/${job.id}`}
                    className={`flex items-center justify-between rounded-xl border p-4 hover:opacity-80 transition-opacity ${
                      urgency ? `${urgency.border} ${urgency.bg}` : "border-slate-100"
                    }`}>
                    <div className="flex items-center gap-3">
                      {urgency && <div className={`w-2.5 h-2.5 rounded-full ${urgency.dot}`}></div>}
                      <div>
                        <p className="font-semibold text-slate-900">{job.job_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {(job.clients as any)?.client_name || "No client"} · {job.job_type || "No type"}
                          {outstandingCount > 0 && ` · ${outstandingCount} outstanding item${outstandingCount !== 1 ? "s" : ""}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {job.workflow_stage || "Not Started"}
                      </span>
                      {job.due_date && urgency && (
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${urgency.badge}`}>
                          {daysUntilDue! < 0 ? `${Math.abs(daysUntilDue!)} days overdue` : urgency.label}
                        </span>
                      )}
                      {!job.due_date && (
                        <span className="text-xs text-slate-400">No due date</span>
                      )}
                    </div>
                  </a>
                );
              })}
              {sortedJobs.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-8">No active jobs assigned to you.</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-base font-bold text-slate-900 mb-4">Client Deadlines (next 30 days)</h2>
            <div className="space-y-2">
              {myDeadlines.map((d, i) => {
                const urgency = getUrgencyColor(d.days);
                return (
                  <a key={i} href={`/clients/${d.client_id}`}
                    className={`flex items-center justify-between rounded-xl border ${urgency.border} ${urgency.bg} p-3 hover:opacity-80 transition-opacity`}>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{d.client_name}</p>
                      <p className="text-xs text-slate-500">{d.type}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${urgency.badge}`}>
                      {d.days < 0 ? `${Math.abs(d.days)}d overdue` : urgency.label}
                    </span>
                  </a>
                );
              })}
              {myDeadlines.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">No deadlines in the next 30 days for your clients.</p>
              )}
            </div>
            <a href="/deadlines" className="mt-3 block text-xs font-semibold text-blue-600 hover:underline">
              View all deadlines →
            </a>
          </div>
        </div>

      </div>
    </div>
  );
}