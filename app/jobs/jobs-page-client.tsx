"use client";

import { useState } from "react";

interface Job {
  id: string;
  job_name: string;
  job_type: string | null;
  status: string | null;
  workflow_stage: string | null;
  assigned_to: string | null;
  due_date: string | null;
  is_recurring: boolean | null;
  recurrence_frequency: string | null;
  client_id: string | null;
  clients: { client_name: string } | null;
}

interface Client {
  id: string;
  client_name: string;
  year_end: string | null;
  accounts_next_due: string | null;
  confirmation_statement_next_due: string | null;
}

interface Staff {
  id: string;
  name: string;
}

export default function JobsPageClient({
  jobs,
  clients,
  staff,
  error,
  createAction,
  deleteAction,
}: {
  jobs: Job[];
  clients: Client[];
  staff: Staff[];
  error?: string;
  createAction: (formData: FormData) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;
}) {
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false);

  const jobTypes = Array.from(new Set(jobs.map((j) => j.job_type).filter(Boolean))) as string[];

  const today = new Date().toISOString().split("T")[0];

  const isOverdue = (job: Job) =>
    !!job.due_date && job.due_date < today && job.status !== "Completed" && job.status !== "Cancelled";

  // Stat counts — computed off the unfiltered job list, so they always reflect the practice-wide picture
  const activeCount = jobs.filter((j) => j.status === "Active").length;
  const draftCount = jobs.filter((j) => (j.status || "Draft") === "Draft").length;
  const completedCount = jobs.filter((j) => j.status === "Completed").length;
  const overdueCount = jobs.filter(isOverdue).length;

  const filtered = jobs.filter((job) => {
    if (filterClient && job.client_id !== filterClient) return false;
    if (filterType && job.job_type !== filterType) return false;
    if (filterStatus && (job.status || "Draft") !== filterStatus) return false;
    if (filterOverdueOnly && !isOverdue(job)) return false;
    if (search) {
      const haystack = [job.job_name, job.clients?.client_name].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(search.trim().toLowerCase())) return false;
    }
    return true;
  });

  const clearFilters = () => {
    setSearch("");
    setFilterClient("");
    setFilterType("");
    setFilterStatus("");
    setFilterOverdueOnly(false);
  };

  const hasActiveFilters = Boolean(
    search || filterClient || filterType || filterStatus || filterOverdueOnly
  );

  const toggleStatusFilter = (status: string) => {
    setFilterStatus((prev) => (prev === status ? "" : status));
  };

  const toggleOverdueFilter = () => {
    setFilterOverdueOnly((prev) => !prev);
  };

  const statCardClass = (active: boolean) =>
    `rounded-2xl p-4 shadow-sm border text-center transition-all cursor-pointer ${
      active ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
    }`;

  const handleCreate = async (formData: FormData) => {
    await createAction(formData);
    setShowModal(false);
    resetNewJobState();
  };

  const resetNewJobState = () => {
    setNewJobClientId("");
    setNewJobType("");
    setNewJobName("");
    setNewJobNamePreset("");
    setNewJobDueDate("");
    setNewJobPeriodStart("");
    setNewJobPeriodEnd("");
    setDatesAutoFilled(false);
  };

  // Auto-fill logic for the New Job modal
  const [newJobClientId, setNewJobClientId] = useState("");
  const [newJobType, setNewJobType] = useState("");
  const [newJobName, setNewJobName] = useState("");
  const [newJobNamePreset, setNewJobNamePreset] = useState("");
  const [newJobDueDate, setNewJobDueDate] = useState("");
  const [newJobPeriodStart, setNewJobPeriodStart] = useState("");
  const [newJobPeriodEnd, setNewJobPeriodEnd] = useState("");
  const [datesAutoFilled, setDatesAutoFilled] = useState(false);

  const generateJobName = (preset: string) => {
    const refDate = newJobPeriodEnd || newJobDueDate;
    const year = refDate ? new Date(refDate).getFullYear() : new Date().getFullYear();

    switch (preset) {
      case "year_end_accounts":
        return `Year End Accounts ${year}`;
      case "confirmation_statement":
        return `Confirmation Statement ${year}`;
      case "ct_return":
        return `Corporation Tax Return ${year}`;
      case "vat_return":
        return `VAT Return ${year}`;
      case "self_assessment": {
        const dueYear = newJobDueDate ? new Date(newJobDueDate).getFullYear() : year;
        return `Self Assessment Tax Return ${dueYear - 1}/${String(dueYear).slice(-2)}`;
      }
      case "payroll": {
        const now = new Date();
        return `Payroll ${now.toLocaleString("en-GB", { month: "long" })} ${now.getFullYear()}`;
      }
      default:
        return "";
    }
  };

  const handleNamePresetChange = (preset: string) => {
    setNewJobNamePreset(preset);
    if (preset) {
      setNewJobName(generateJobName(preset));
    }
  };

  const applyAutoFill = (clientId: string, jobType: string) => {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;

    if (jobType === "Year End Accounts") {
      setNewJobDueDate(client.accounts_next_due || "");
      if (client.accounts_next_due) {
        // UK private companies file 9 months after their accounting reference date.
        // All math done in UTC to avoid timezone drift from date-only strings.
        const due = new Date(client.accounts_next_due);
        const periodEnd = new Date(due);
        periodEnd.setUTCMonth(periodEnd.getUTCMonth() - 9);
        const periodStart = new Date(periodEnd);
        periodStart.setUTCFullYear(periodStart.getUTCFullYear() - 1);
        periodStart.setUTCDate(periodStart.getUTCDate() + 1);
        setNewJobPeriodEnd(periodEnd.toISOString().split("T")[0]);
        setNewJobPeriodStart(periodStart.toISOString().split("T")[0]);
      } else if (client.year_end) {
        // Fallback: estimate the upcoming period as one year after the last recorded year end
        const lastYearEnd = new Date(client.year_end);
        const nextYearEnd = new Date(lastYearEnd);
        nextYearEnd.setUTCFullYear(nextYearEnd.getUTCFullYear() + 1);
        const periodStart = new Date(lastYearEnd);
        periodStart.setUTCDate(periodStart.getUTCDate() + 1);
        setNewJobPeriodEnd(nextYearEnd.toISOString().split("T")[0]);
        setNewJobPeriodStart(periodStart.toISOString().split("T")[0]);
      }
      setDatesAutoFilled(!!(client.accounts_next_due || client.year_end));
    } else if (jobType === "Confirmation Statement") {
      setNewJobDueDate(client.confirmation_statement_next_due || "");
      setNewJobPeriodStart("");
      setNewJobPeriodEnd("");
      setDatesAutoFilled(!!client.confirmation_statement_next_due);
    } else {
      setDatesAutoFilled(false);
    }
  };

  const handleClientChange = (clientId: string) => {
    setNewJobClientId(clientId);
    applyAutoFill(clientId, newJobType);
  };

  const handleJobTypeChange = (jobType: string) => {
    setNewJobType(jobType);
    applyAutoFill(newJobClientId, jobType);
  };

  return (
    <div className="p-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Jobs</h1>
          <p className="mt-1 text-slate-500">
            {filtered.length} of {jobs.length} job{jobs.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => { resetNewJobState(); setShowModal(true); }}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
        >
          + New Job
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-xl bg-red-100 p-3 text-sm text-red-700">
          Could not load jobs: {error}
        </div>
      )}

      {/* Drillable stat cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <button onClick={() => toggleStatusFilter("Active")} className={statCardClass(filterStatus === "Active")}>
          <p className={`text-2xl font-bold ${filterStatus === "Active" ? "text-white" : "text-green-600"}`}>{activeCount}</p>
          <p className={`text-xs mt-1 ${filterStatus === "Active" ? "text-slate-300" : "text-slate-500"}`}>Active</p>
        </button>
        <button onClick={() => toggleStatusFilter("Draft")} className={statCardClass(filterStatus === "Draft")}>
          <p className={`text-2xl font-bold ${filterStatus === "Draft" ? "text-white" : "text-slate-900"}`}>{draftCount}</p>
          <p className={`text-xs mt-1 ${filterStatus === "Draft" ? "text-slate-300" : "text-slate-500"}`}>Draft</p>
        </button>
        <button onClick={toggleOverdueFilter} className={statCardClass(filterOverdueOnly)}>
          <p className={`text-2xl font-bold ${filterOverdueOnly ? "text-white" : "text-red-600"}`}>{overdueCount}</p>
          <p className={`text-xs mt-1 ${filterOverdueOnly ? "text-slate-300" : "text-slate-500"}`}>Overdue</p>
        </button>
        <button onClick={() => toggleStatusFilter("Completed")} className={statCardClass(filterStatus === "Completed")}>
          <p className={`text-2xl font-bold ${filterStatus === "Completed" ? "text-white" : "text-blue-600"}`}>{completedCount}</p>
          <p className={`text-xs mt-1 ${filterStatus === "Completed" ? "text-slate-300" : "text-slate-500"}`}>Completed</p>
        </button>
      </div>

      {/* Search */}
      <div className="mt-6">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by job name or client..."
          className="w-full max-w-md rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>

      {/* Filters */}
      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
        <div className="grid gap-3 md:grid-cols-3">
          <select
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
            className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.client_name}</option>
            ))}
          </select>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
          >
            <option value="">All job types</option>
            {jobTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
          >
            <option value="">All statuses</option>
            <option>Draft</option>
            <option>Active</option>
            <option>On Hold</option>
            <option>Completed</option>
            <option>Cancelled</option>
          </select>
        </div>

        {hasActiveFilters && (
          <button onClick={clearFilters} className="mt-3 text-xs font-semibold text-blue-600 hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {/* Jobs List — only shown once a filter or search narrows things down */}
      {hasActiveFilters ? (
        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <div className="space-y-3">
            {filtered.map((job) => (
              <div key={job.id}
                className="flex items-center justify-between rounded-xl border border-slate-100 p-4">
                <a href={`/jobs/${job.id}`} className="flex-1 hover:opacity-70 transition-opacity">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">{job.job_name}</p>
                    {job.is_recurring && (
                      <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-600 font-medium">
                        ↻ {job.recurrence_frequency}
                      </span>
                    )}
                    {isOverdue(job) && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600 font-medium">
                        Overdue
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500">
                    {job.clients?.client_name || "No client"} · {job.job_type || "No type"}
                    {job.due_date && ` · Due ${new Date(job.due_date).toLocaleDateString("en-GB")}`}
                  </p>
                </a>

                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    job.status === "Active" ? "bg-green-100 text-green-700"
                    : job.status === "Completed" ? "bg-blue-100 text-blue-700"
                    : job.status === "On Hold" ? "bg-yellow-100 text-yellow-700"
                    : job.status === "Cancelled" ? "bg-red-100 text-red-700"
                    : "bg-slate-100 text-slate-600"
                  }`}>
                    {job.status || "Draft"}
                  </span>

                  <form action={deleteAction.bind(null, job.id)}>
                    <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            ))}

            {filtered.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">
                No jobs matching your filters.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <p className="text-sm text-slate-500 text-center py-8">
            {jobs.length === 0
              ? "No jobs yet. Click + New Job to add your first one."
              : "Search, filter, or click a stat above to see jobs."}
          </p>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 my-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-900">Add New Job</h2>
              <button
                onClick={() => { setShowModal(false); resetNewJobState(); }}
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 transition-colors"
              >
                ✕ Close
              </button>
            </div>
            <div className="p-6">
              <form action={handleCreate}>
                <div className="grid gap-4 md:grid-cols-2">

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
                    <select name="client_id" required
                      value={newJobClientId}
                      onChange={(e) => handleClientChange(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                      <option value="">Select a client</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.client_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Job Name *</label>
                    <select
                      value={newJobNamePreset}
                      onChange={(e) => handleNamePresetChange(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs mb-2 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-slate-50"
                    >
                      <option value="">Custom / type manually below</option>
                      <option value="year_end_accounts">Year End Accounts (standard name)</option>
                      <option value="confirmation_statement">Confirmation Statement (standard name)</option>
                      <option value="ct_return">Corporation Tax Return (standard name)</option>
                      <option value="vat_return">VAT Return (standard name)</option>
                      <option value="self_assessment">Self Assessment Tax Return (standard name)</option>
                      <option value="payroll">Payroll (standard name)</option>
                    </select>
                    <input name="job_name" required
                      value={newJobName}
                      onChange={(e) => setNewJobName(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      placeholder="e.g. Year End Accounts 2024" />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Job Type</label>
                    <select name="job_type"
                      value={newJobType}
                      onChange={(e) => handleJobTypeChange(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
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
                    <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                    <select name="status"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                      <option>Draft</option>
                      <option>Active</option>
                      <option>On Hold</option>
                      <option>Completed</option>
                      <option>Cancelled</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Workflow Stage</label>
                    <select name="workflow_stage"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
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
                    <label className="block text-sm font-medium text-slate-700 mb-1">Assigned To</label>
                    <select name="assigned_to"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                      <option value="">Unassigned</option>
                      {staff.map((member) => (
                        <option key={member.id} value={member.name}>{member.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Period Start</label>
                    <input name="period_start" type="date"
                      value={newJobPeriodStart}
                      onChange={(e) => setNewJobPeriodStart(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Period End</label>
                    <input name="period_end" type="date"
                      value={newJobPeriodEnd}
                      onChange={(e) => setNewJobPeriodEnd(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
                    <input name="due_date" type="date"
                      value={newJobDueDate}
                      onChange={(e) => setNewJobDueDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    {datesAutoFilled && (
                      <p className="text-xs text-blue-600 mt-1">✓ Auto-filled from Companies House — edit if needed</p>
                    )}
                  </div>

                  {/* Recurring job settings */}
                  <div className="md:col-span-2 rounded-xl border border-slate-200 p-4 bg-slate-50">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="is_recurring"
                        name="is_recurring"
                        className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                      />
                      <label htmlFor="is_recurring" className="text-sm font-medium text-slate-700">
                        Make this a recurring job
                      </label>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 ml-7">
                      When this job is marked Completed, the next occurrence will be created automatically.
                    </p>
                    <div className="mt-3 ml-7">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Recurs</label>
                      <select name="recurrence_frequency"
                        className="w-full max-w-xs rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                        <option value="Annually">Annually</option>
                        <option value="Quarterly">Quarterly</option>
                        <option value="Monthly">Monthly</option>
                      </select>
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                    <textarea name="notes" rows={3}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      placeholder="Any notes about this job" />
                  </div>

                </div>

                <button type="submit"
                  className="mt-6 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  Create Job
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
