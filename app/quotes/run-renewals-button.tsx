"use client";

import { useState, useTransition } from "react";
import { runRenewalsNow } from "@/app/renewals/actions";

export default function RunRenewalsButton() {
  const [runDate, setRunDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleRun = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        if (runDate) fd.set("run_date", runDate);
        const res = await runRenewalsNow(fd);
        setMessage(
          `Checked ${res.runDate}: created ${res.createdCount} draft renewal${res.createdCount === 1 ? "" : "s"}.`
        );
      } catch (err: any) {
        setMessage(`Error: ${err.message}`);
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={runDate}
        onChange={(e) => setRunDate(e.target.value)}
        aria-label="Test run date"
        className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
      <button
        type="button"
        onClick={handleRun}
        disabled={isPending}
        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {isPending ? "Running..." : "Run Renewals"}
      </button>
      {message && (
        <span className="text-xs font-medium text-slate-600">{message}</span>
      )}
    </div>
  );
}