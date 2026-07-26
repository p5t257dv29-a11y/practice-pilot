"use client";

import { useState } from "react";

const STAGES = [
  "Not Started",
  "Waiting for Info",
  "In Progress",
  "Review",
  "Awaiting Client Approval",
  "Filing",
  "Complete",
];

const STAGE_COLORS: Record<string, string> = {
  "Not Started": "border-slate-200",
  "Waiting for Info": "border-amber-200",
  "In Progress": "border-blue-200",
  "Review": "border-purple-200",
  "Awaiting Client Approval": "border-orange-200",
  "Filing": "border-teal-200",
  "Complete": "border-green-200",
};

function getDaysUntil(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(date);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default function JobsBoardClient({
  jobs,
  staff,
  error,
  updateStageAction,
}: {
  jobs: any[];
  staff: any[];
  error?: string;
  updateStageAction: (jobId: string, newStage: string) => Promise<void>;
}) {
  const [localJobs, setLocalJobs] = useState(jobs);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [staffFilter, setStaffFilter] = useState<string>("");

  const filteredJobs = staffFilter
    ? localJobs.filter((j) => j.assigned_to === staffFilter)
    : localJobs;

  const handleDrop = async (newStage: string) => {
    if (!draggingId) return;
    const jobId = draggingId;
    setDraggingId(null);

    // Optimistic update — move the card immediately, then confirm with the server
    setLocalJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, workflow_stage: newStage } : j)));
    await updateStageAction(jobId, newStage);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Jobs Board</h1>
            <p className="text-sm text-slate-500 mt-0.5">Drag a job card between columns to update its workflow stage.</p>
          </div>
          <a href="/jobs" className="text-sm font-semibold text-blue-600 hover:underline">
            List view →
          </a>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => setStaffFilter("")}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              !staffFilter ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}>
            Everyone
          </button>
          {staff.map((s) => (
            <button
              key={s.id}
              onClick={() => setStaffFilter(s.name)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                staffFilter === s.name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}>
              {s.name}
            </button>
          ))}
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load jobs: {error}
          </div>
        )}

        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
            const stageJobs = filteredJobs.filter((j) => (j.workflow_stage || "Not Started") === stage);

            return (
              <div
                key={stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(stage)}
                className={`flex-shrink-0 w-72 rounded-2xl bg-white border-2 ${STAGE_COLORS[stage]} p-3 flex flex-col`}
                style={{ minHeight: "70vh" }}
              >
                <div className="flex items-center justify-between px-1 pb-3 border-b border-slate-100 mb-3">
                  <h2 className="text-sm font-bold text-slate-900">{stage}</h2>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                    {stageJobs.length}
                  </span>
                </div>

                <div className="space-y-2 flex-1">
                  {stageJobs.map((job) => {
                    const daysUntilDue = job.due_date ? getDaysUntil(new Date(job.due_date)) : null;
                    const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
                    const isDueSoon = daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 7;

                    return (
                      <a
                        key={job.id}
                        href={`/jobs/${job.id}`}
                        draggable
                        onDragStart={() => setDraggingId(job.id)}
                        onDragEnd={() => setDraggingId(null)}
                        className={`block rounded-xl border p-3 bg-white shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing ${
                          draggingId === job.id ? "opacity-40" : ""
                        } ${isOverdue ? "border-red-200 bg-red-50" : "border-slate-100"}`}
                      >
                        <p className="text-sm font-semibold text-slate-900 line-clamp-2">{job.job_name}</p>
                        <p className="text-xs text-slate-500 mt-1">
                          {(job.clients as any)?.client_name || "No client"}
                        </p>
                        <div className="mt-2 flex items-center justify-between">
                          {job.assigned_to ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                              {job.assigned_to}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">Unassigned</span>
                          )}
                          {job.due_date && (
                            <span className={`text-xs font-semibold ${
                              isOverdue ? "text-red-600" : isDueSoon ? "text-orange-600" : "text-slate-400"
                            }`}>
                              {isOverdue
                                ? `${Math.abs(daysUntilDue!)}d overdue`
                                : new Date(job.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                            </span>
                          )}
                        </div>
                      </a>
                    );
                  })}
                  {stageJobs.length === 0 && (
                    <p className="text-xs text-slate-300 text-center py-6">No jobs here</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}