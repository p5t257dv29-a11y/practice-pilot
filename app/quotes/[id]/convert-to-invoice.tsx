"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ConvertToInvoiceButton({
  quoteId,
  clientId,
  subtotal,
  vat,
  total,
  status,
  jobs,
}: {
  quoteId: string;
  clientId: string;
  subtotal: number;
  vat: number;
  total: number;
  status: string;
  jobs: { id: string; job_name: string }[];
}) {
  const [jobId, setJobId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleConvert = async () => {
    setConverting(true);
    setError("");

    try {
      const res = await fetch("/api/convert-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId,
          clientId,
          jobId: jobId || null,
          dueDate: dueDate || null,
          subtotal,
          vat,
          total,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to convert quote.");
        setConverting(false);
        return;
      }

      router.push(`/invoices/${data.invoiceId}`);
    } catch {
      setError("Failed to convert. Please try again.");
      setConverting(false);
    }
  };

  if (status !== "Accepted") {
    return (
      <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
        <p className="text-xs text-slate-500">
          Quote must be <strong>Accepted</strong> before converting to an invoice.
          Current status: <strong>{status}</strong>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Link to Job (optional)
        </label>
        <select
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          <option value="">Select a job</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.job_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Payment Due Date
        </label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        onClick={handleConvert}
        disabled={converting}
        className="w-full rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 transition-colors disabled:opacity-50"
      >
        {converting ? "Converting..." : "🧾 Convert to Invoice"}
      </button>
    </div>
  );
}
