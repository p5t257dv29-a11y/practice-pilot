"use client";

import { useState } from "react";

type ClientOption = { id: string; client_name: string };
type JobOption = { id: string; job_name: string; client_id: string };

export default function TimesheetLogForm({
  clients,
  jobs,
  weekStart,
  weekEnd,
  currentStaffRate,
  defaultDate,
  logAction,
}: {
  clients: ClientOption[];
  jobs: JobOption[];
  weekStart: string;
  weekEnd: string;
  currentStaffRate: number;
  defaultDate: string;
  logAction: (formData: FormData) => void;
}) {
  const [clientId, setClientId] = useState("");

  const filteredJobs = clientId ? jobs.filter((j) => j.client_id === clientId) : [];

  return (
    <form action={logAction} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
        <input
          name="date"
          type="date"
          defaultValue={defaultDate}
          min={weekStart}
          max={weekEnd}
          required
          className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Client *</label>
        <select
          name="client_id"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          <option value="">Select a client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.client_name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Job</label>
        <select
          name="job_id"
          disabled={!clientId}
          className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-50 disabled:text-slate-400"
        >
          <option value="">{clientId ? "Select a job (optional)" : "Select a client first"}</option>
          {filteredJobs.map((j) => (
            <option key={j.id} value={j.id}>{j.job_name}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-700 mb-1">Hours *</label>
          <input
            name="hours"
            type="number"
            step="0.25"
            min="0.25"
            required
            placeholder="e.g. 1.5"
            className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-700 mb-1">Rate</label>
          <div className="w-full rounded-lg border border-slate-100 bg-slate-50 p-2 text-sm text-slate-600 font-mono tabular-nums">
            £{currentStaffRate.toFixed(2)}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Description *</label>
        <textarea
          name="description"
          required
          rows={2}
          placeholder="What did you work on?"
          className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input name="billable" type="checkbox" defaultChecked className="w-4 h-4 rounded" />
        <span className="text-sm font-medium text-slate-700">Billable</span>
      </label>

      <button
        type="submit"
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
      >
        Log Time
      </button>
    </form>
  );
}
