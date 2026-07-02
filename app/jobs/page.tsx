import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createJobRecord(formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  const { error } = await supabase.from("jobs").insert({
    client_id: get("client_id"),
    job_name: get("job_name"),
    job_type: get("job_type"),
    status: get("status"),
    workflow_stage: get("workflow_stage"),
    period_start: get("period_start") || null,
    period_end: get("period_end") || null,
    due_date: get("due_date") || null,
    assigned_to: get("assigned_to"),
    notes: get("notes"),
  });

  if (error) {
    console.error("Could not create job:", error.message);
    return;
  }

  revalidatePath("/jobs");
}

async function deleteJobRecord(id: string) {
  "use server";

  await supabase.from("jobs").delete().eq("id", id);
  revalidatePath("/jobs");
}

export default async function JobsPage() {
  const [{ data: jobs, error }, { data: clients }] = await Promise.all([
    supabase
      .from("jobs")
      .select("*, clients(client_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, client_name")
      .order("client_name", { ascending: true }),
  ]);

  return (
    <div className="p-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Jobs</h1>
        <p className="mt-1 text-slate-500">
          Track and manage all client jobs and workflow.
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-xl bg-red-100 p-3 text-sm text-red-700">
          Could not load jobs: {error.message}
        </div>
      )}

      {/* Add Job Form */}
      <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Add New Job</h2>

        <form action={createJobRecord} className="mt-6">
          <div className="grid gap-4 md:grid-cols-2">

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Client *
              </label>
              <select
                name="client_id"
                required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <option value="">Select a client</option>
                {(clients || []).map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.client_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Job Name *
              </label>
              <input
                name="job_name"
                required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="e.g. Year End Accounts 2024"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Job Type
              </label>
              <select
                name="job_type"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <option value="">Select job type</option>
                <option>Year End Accounts</option>
                <option>Corporation Tax Return</option>
                <option>VAT Return</option>
                <option>Payroll</option>
                <option>Self Assessment</option>
                <option>Bookkeeping</option>
                <option>Management Accounts</option>
                <option>Companies House Filing</option>
                <option>Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Status
              </label>
              <select
                name="status"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <option>Draft</option>
                <option>Active</option>
                <option>On Hold</option>
                <option>Completed</option>
                <option>Cancelled</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Workflow Stage
              </label>
              <select
                name="workflow_stage"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <option>Not Started</option>
                <option>Waiting for Info</option>
                <option>In Progress</option>
                <option>Review</option>
                <option>Awaiting Client Approval</option>
                <option>Filing</option>
                <option>Complete</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Assigned To
              </label>
              <input
                name="assigned_to"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="Staff member name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Period Start
              </label>
              <input
                name="period_start"
                type="date"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Period End
              </label>
              <input
                name="period_end"
                type="date"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Due Date
              </label>
              <input
                name="due_date"
                type="date"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Notes
              </label>
              <textarea
                name="notes"
                rows={3}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="Any notes about this job"
              />
            </div>

          </div>

          <button
            type="submit"
            className="mt-6 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
          >
            Create Job
          </button>
        </form>
      </div>

      {/* Jobs List */}
      <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">
          All Jobs ({jobs?.length ?? 0})
        </h2>

        <div className="mt-4 space-y-3">
          {(jobs || []).map((job) => (
            <div
              key={job.id}
              className="flex items-center justify-between rounded-xl border border-slate-100 p-4"
            >
              <a
                href={`/jobs/${job.id}`}
                className="flex-1 hover:opacity-70 transition-opacity"
              >
                <p className="font-semibold text-slate-900">{job.job_name}</p>
                <p className="text-sm text-slate-500">
                  {job.clients?.client_name || "No client"} ·{" "}
                  {job.job_type || "No type"}
                </p>
                {job.due_date && (
                  <p className="text-xs text-slate-400 mt-1">
                    Due: {new Date(job.due_date).toLocaleDateString("en-GB")}
                  </p>
                )}
              </a>

              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    job.status === "Active"
                      ? "bg-green-100 text-green-700"
                      : job.status === "Completed"
                      ? "bg-blue-100 text-blue-700"
                      : job.status === "On Hold"
                      ? "bg-yellow-100 text-yellow-700"
                      : job.status === "Cancelled"
                      ? "bg-red-100 text-red-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {job.status || "Draft"}
                </span>

                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {job.workflow_stage || "Not Started"}
                </span>

                <form action={deleteJobRecord.bind(null, job.id)}>
                  <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                    Delete
                  </button>
                </form>
              </div>
            </div>
          ))}

          {jobs && jobs.length === 0 && (
            <p className="text-sm text-slate-500">
              No jobs yet. Add your first job above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
