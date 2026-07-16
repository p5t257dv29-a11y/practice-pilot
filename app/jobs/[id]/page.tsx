import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import WriteOffWipForm from "../../write-off-wip-form";

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

async function attachChecklist(jobId: string, formData: FormData) {
  "use server";

  const templateId = String(formData.get("template_id") || "").trim();
  if (!templateId) return;

  const { data: templateItems } = await supabase
    .from("checklist_template_items")
    .select("*")
    .eq("template_id", templateId)
    .order("sort_order", { ascending: true });

  if (templateItems && templateItems.length > 0) {
    await supabase.from("job_checklist_items").insert(
      templateItems.map((item) => ({
        job_id: jobId,
        item_text: item.item_text,
        sort_order: item.sort_order,
        is_received: false,
      }))
    );
  }

  revalidatePath(`/jobs/${jobId}`);
}

async function toggleChecklistItem(jobId: string, itemId: string, currentStatus: boolean) {
  "use server";
  await supabase.from("job_checklist_items").update({ is_received: !currentStatus }).eq("id", itemId);
  revalidatePath(`/jobs/${jobId}`);
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

  const [
    { data: job, error },
    { data: clients },
    { data: checklistItems },
    { data: templates },
    { data: staff },
    { data: timeEntries },
    { data: trialBalance },
    { data: invoices },
    { data: writeoffs },
  ] = await Promise.all([
    supabase
      .from("jobs")
      .select("*, clients(client_name)")
      .eq("id", id)
      .single(),
    supabase
      .from("clients")
      .select("id, client_name")
      .order("client_name", { ascending: true }),
    supabase
      .from("job_checklist_items")
      .select("*")
      .eq("job_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("checklist_templates")
      .select("id, name")
      .order("name", { ascending: true }),
    supabase
      .from("staff")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("time_entries")
      .select("*")
      .eq("job_id", id)
      .order("date", { ascending: false }),
    supabase
      .from("trial_balances")
      .select("id")
      .eq("job_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("invoices")
      .select("subtotal, status")
      .eq("job_id", id),
    supabase
      .from("wip_writeoffs")
      .select("*")
      .eq("job_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (error || !job) notFound();

  const updateWithId = updateJobRecord.bind(null, id);
  const attachChecklistWithId = attachChecklist.bind(null, id);
  const receivedCount = (checklistItems || []).filter((i) => i.is_received).length;

  // Time logged against this job
  const totalHours = (timeEntries || []).reduce((sum, e) => sum + Number(e.hours), 0);
  const billableHours = (timeEntries || []).filter((e) => e.billable).reduce((sum, e) => sum + Number(e.hours), 0);
  const chargeOutValue = (timeEntries || []).filter((e) => e.billable).reduce((sum, e) => sum + (Number(e.hours) * Number(e.hourly_rate)), 0);

  // WIP for this job: charge-out value less what's been invoiced and what's already been written off
  const invoicedAmount = (invoices || []).reduce((sum, i) => sum + Number(i.subtotal || 0), 0);
  const writtenOffAmount = (writeoffs || []).reduce((sum, w) => sum + Number(w.amount), 0);
  const currentWip = Math.max(chargeOutValue - invoicedAmount - writtenOffAmount, 0);

  // Where the Accounts Production link should go: straight to the existing
  // trial balance if one's linked to this job, otherwise the job-first upload screen
  const accountsProductionHref = trialBalance
    ? `/accounts-production/${trialBalance.id}`
    : `/accounts-production?job=${id}`;

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

        <div className="flex items-center gap-2">
          <a href={accountsProductionHref}
            className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
            {trialBalance ? "View Accounts →" : "Prepare Accounts →"}
          </a>

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

      <div className="mt-8 grid gap-6 lg:grid-cols-3">

        {/* Left column — main job details */}
        <div className="lg:col-span-2">
          <form action={updateWithId} className="space-y-6">

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
                    <option>Capital Gains Tax</option>
                    <option>Partnership Tax</option>
                    <option>P11D / Benefits in Kind</option>
                    <option>Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Assigned To</label>
                  <select
                    name="assigned_to"
                    defaultValue={job.assigned_to || ""}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  >
                    <option value="">Unassigned</option>
                    {(staff || []).map((member) => (
                      <option key={member.id} value={member.name}>{member.name}</option>
                    ))}
                  </select>
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

        {/* Right column — checklist + time logged */}
        <div className="space-y-6">

          {/* Time Logged / WIP */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Time Logged</h2>
              <a href="/timesheets" className="text-xs font-semibold text-blue-600 hover:underline">
                Log time →
              </a>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-xl font-bold text-slate-900">{totalHours.toFixed(1)}h</p>
                <p className="text-xs text-slate-500">Total</p>
              </div>
              <div>
                <p className="text-xl font-bold text-blue-600">{billableHours.toFixed(1)}h</p>
                <p className="text-xs text-slate-500">Billable</p>
              </div>
              <div>
                <p className="text-xl font-bold text-green-600">£{chargeOutValue.toFixed(2)}</p>
                <p className="text-xs text-slate-500">Value</p>
              </div>
            </div>

            {timeEntries && timeEntries.length > 0 ? (
              <div className="mt-4 space-y-2 max-h-64 overflow-y-auto">
                {timeEntries.map((entry) => (
                  <div key={entry.id} className="flex items-start justify-between rounded-lg border border-slate-100 p-2.5">
                    <div className="flex-1">
                      <p className="text-xs text-slate-700">{entry.description}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {new Date(entry.date + "T00:00:00").toLocaleDateString("en-GB")} · {entry.user_name}
                      </p>
                    </div>
                    <p className="text-xs font-bold text-slate-900 ml-2">{Number(entry.hours).toFixed(1)}h</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-400 text-center py-2">No time logged against this job yet.</p>
            )}

            {/* WIP summary + write-off */}
            <div className="mt-5 border-t border-slate-100 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">Current WIP</p>
                <p className={`text-sm font-bold ${currentWip > 0 ? "text-orange-600" : "text-green-600"}`}>
                  £{currentWip.toFixed(2)}
                </p>
              </div>
              {invoicedAmount > 0 && (
                <p className="text-xs text-slate-500">Invoiced to date: £{invoicedAmount.toFixed(2)}</p>
              )}
              {writtenOffAmount > 0 && (
                <p className="text-xs text-slate-500">Written off to date: £{writtenOffAmount.toFixed(2)}</p>
              )}

              <WriteOffWipForm jobId={id} currentWip={currentWip} />

              {writeoffs && writeoffs.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Write-off history</p>
                  {writeoffs.map((w) => (
                    <div key={w.id} className="rounded-lg border border-slate-100 p-2.5">
                      <div className="flex items-start justify-between">
                        <p className="text-xs font-semibold text-slate-700">{w.reason_category}</p>
                        <p className="text-xs font-bold text-slate-900">£{Number(w.amount).toFixed(2)}</p>
                      </div>
                      {w.notes && <p className="text-xs text-slate-500 mt-0.5">{w.notes}</p>}
                      <p className="text-xs text-slate-400 mt-0.5">
                        {new Date(w.created_at).toLocaleDateString("en-GB")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Information Checklist</h2>
              {checklistItems && checklistItems.length > 0 && (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {receivedCount} of {checklistItems.length}
                </span>
              )}
            </div>

            {(!checklistItems || checklistItems.length === 0) ? (
              <div className="mt-4">
                <p className="text-sm text-slate-500 mb-3">
                  No checklist attached yet. Pick a template to track what's been received from the client.
                </p>
                <form action={attachChecklistWithId} className="space-y-3">
                  <select name="template_id" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Select a checklist template</option>
                    {(templates || []).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <button type="submit"
                    className="w-full rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                    Attach Checklist
                  </button>
                </form>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {checklistItems.map((item) => (
                  <form key={item.id} action={toggleChecklistItem.bind(null, id, item.id, item.is_received)}>
                    <button
                      type="submit"
                      className={`w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                        item.is_received
                          ? "border-green-100 bg-green-50 hover:bg-green-100"
                          : "border-slate-100 hover:bg-slate-50"
                      }`}
                    >
                      <span className={`w-5 h-5 rounded-md border flex items-center justify-center text-xs flex-shrink-0 mt-0.5 ${
                        item.is_received ? "bg-green-600 border-green-600 text-white" : "border-slate-300 text-transparent"
                      }`}>
                        ✓
                      </span>
                      <span className={`text-sm ${item.is_received ? "text-green-800 line-through" : "text-slate-700"}`}>
                        {item.item_text}
                      </span>
                    </button>
                  </form>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
