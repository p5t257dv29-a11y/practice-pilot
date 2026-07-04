import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Calculates the next due date based on the recurrence frequency
function getNextDueDate(currentDueDate: string | null, frequency: string | null): string | null {
  if (!currentDueDate) return null;

  const date = new Date(currentDueDate);

  if (frequency === "Monthly") {
    date.setMonth(date.getMonth() + 1);
  } else if (frequency === "Quarterly") {
    date.setMonth(date.getMonth() + 3);
  } else {
    // Default to Annually
    date.setFullYear(date.getFullYear() + 1);
  }

  return date.toISOString().split("T")[0];
}

// If the job name contains a 4-digit year, bump it forward to match the new due date's year
function getNextJobName(currentName: string, oldDueDate: string | null, newDueDate: string | null): string {
  if (!oldDueDate || !newDueDate) return currentName;

  const oldYear = new Date(oldDueDate).getFullYear().toString();
  const newYear = new Date(newDueDate).getFullYear().toString();

  if (currentName.includes(oldYear)) {
    return currentName.replace(oldYear, newYear);
  }
  return currentName;
}

async function updateJobRecord(id: string, formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();
  const newStatus = get("status");
  const isRecurring = formData.get("is_recurring") === "on";

  // Fetch the current job first so we know its previous status and recurrence settings
  const { data: currentJob } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .single();

  await supabase.from("jobs").update({
    client_id: get("client_id"),
    job_name: get("job_name"),
    job_type: get("job_type"),
    status: newStatus,
    workflow_stage: get("workflow_stage"),
    period_start: get("period_start") || null,
    period_end: get("period_end") || null,
    due_date: get("due_date") || null,
    assigned_to: get("assigned_to"),
    notes: get("notes"),
    is_recurring: isRecurring,
    recurrence_frequency: isRecurring ? get("recurrence_frequency") || null : null,
  }).eq("id", id);

  // If this job just became Completed, and it's recurring, spawn the next occurrence
  const wasAlreadyCompleted = currentJob?.status === "Completed";
  if (isRecurring && newStatus === "Completed" && !wasAlreadyCompleted) {
    const nextDueDate = getNextDueDate(get("due_date") || currentJob?.due_date, get("recurrence_frequency"));
    const nextJobName = getNextJobName(get("job_name"), get("due_date") || currentJob?.due_date, nextDueDate);

    const { error: spawnError } = await supabase.from("jobs").insert({
      client_id: get("client_id"),
      job_name: nextJobName,
      job_type: get("job_type"),
      status: "Draft",
      workflow_stage: "Not Started",
      assigned_to: get("assigned_to"),
      due_date: nextDueDate,
      is_recurring: true,
      recurrence_frequency: get("recurrence_frequency"),
      recurrence_parent_id: id,
    });

    if (spawnError) {
      console.error("Could not create next recurring job:", spawnError.message);
    } else {
      console.log("✅ Next recurring job created, due:", nextDueDate);
    }
  }

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [{ data: job, error }, { data: clients }] = await Promise.all([
    supabase
      .from("jobs")
      .select("*, clients(client_name)")
      .eq("id", id)
      .single(),
    supabase
      .from("clients")
      .select("id, client_name")
      .order("client_name", { ascending: true }),
  ]);

  if (error || !job) notFound();

  const updateWithId = updateJobRecord.bind(null, id);

  return (
    <div className="p-8">
      {/* Header */}
      <a
        href="/jobs"
        className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
      >
        ← Back to Jobs
      </a>

      <div className="mt-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">{job.job_name}</h1>
            {job.is_recurring && (
              <span className="rounded-full bg-purple-50 px-3 py-1 text-xs text-purple-600 font-medium">
                ↻ Recurs {job.recurrence_frequency}
              </span>
            )}
          </div>
          <p className="mt-1 text-slate-500">
            {job.clients?.client_name || "No client"} ·{" "}
            {job.job_type || "No type"}
          </p>
        </div>

        <div className="flex gap-2">
          <span
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
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

          <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
            {job.workflow_stage || "Not Started"}
          </span>
        </div>
      </div>

      {job.recurrence_parent_id && (
        <div className="mt-4 rounded-xl bg-purple-50 border border-purple-100 p-3 text-sm text-purple-700">
          This job was automatically created from a previous recurring job.
        </div>
      )}

      {/* Edit Form */}
      <form action={updateWithId} className="mt-8 space-y-6">

        {/* Job Details */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Job Details</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
              <select
                name="client_id"
                defaultValue={job.client_id || ""}
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Job Name *</label>
              <input
                name="job_name"
                defaultValue={job.job_name || ""}
                required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Job Type</label>
              <select
                name="job_type"
                defaultValue={job.job_type || ""}
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Assigned To</label>
              <input
                name="assigned_to"
                defaultValue={job.assigned_to || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="Staff member name"
              />
            </div>

          </div>
        </div>

        {/* Status & Workflow */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Status & Workflow</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select
                name="status"
                defaultValue={job.status || "Draft"}
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Workflow Stage</label>
              <select
                name="workflow_stage"
                defaultValue={job.workflow_stage || "Not Started"}
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

          </div>
        </div>

        {/* Dates */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Dates</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Period Start</label>
              <input
                name="period_start"
                type="date"
                defaultValue={job.period_start || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Period End</label>
              <input
                name="period_end"
                type="date"
                defaultValue={job.period_end || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
              <input
                name="due_date"
                type="date"
                defaultValue={job.due_date || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>

          </div>
        </div>

        {/* Recurring Settings */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Recurring Job Settings</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            When this job is marked Completed, the next occurrence will be created automatically.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <input
              type="checkbox"
              id="is_recurring"
              name="is_recurring"
              defaultChecked={job.is_recurring || false}
              className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
            <label htmlFor="is_recurring" className="text-sm font-medium text-slate-700">
              Make this a recurring job
            </label>
          </div>
          <div className="mt-3 max-w-xs">
            <label className="block text-sm font-medium text-slate-700 mb-1">Recurs</label>
            <select
              name="recurrence_frequency"
              defaultValue={job.recurrence_frequency || "Annually"}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <option value="Annually">Annually</option>
              <option value="Quarterly">Quarterly</option>
              <option value="Monthly">Monthly</option>
            </select>
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Notes</h2>
          <div className="mt-4">
            <textarea
              name="notes"
              defaultValue={job.notes || ""}
              rows={4}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="Any notes about this job"
            />
          </div>
        </div>

        <button
          type="submit"
          className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
        >
          Save Changes
        </button>

      </form>
    </div>
  );
}
