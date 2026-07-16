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
  quoteLines,
}: {
  quoteId: string;
  clientId: string;
  subtotal: number;
  vat: number;
  total: number;
  status: string;
  jobs: { id: string; job_name: string }[];
  quoteLines: { id: string; description: string }[];
}) {
  const [lineJobs, setLineJobs] = useState<Record<string, string>>({});
  const [dueDate, setDueDate] = useState("");
  const [createJobs, setCreateJobs] = useState(false);
  const [splitRecurring, setSplitRecurring] = useState(false);
  const [numInstalments, setNumInstalments] = useState(12);
  const [frequency, setFrequency] = useState("Monthly");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const instalmentAmount = splitRecurring && numInstalments > 0 ? total / numInstalments : 0;

  const [billByDate, setBillByDate] = useState("");

  const calculateInstalmentsFromDate = () => {
    if (!firstDueDate || !billByDate) return;
    const start = new Date(firstDueDate);
    const end = new Date(billByDate);
    let count = 1;

    if (frequency === "Weekly") {
      count = Math.round((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
    } else {
      const monthsDiff = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      count = frequency === "Quarterly" ? Math.round(monthsDiff / 3) : monthsDiff;
    }

    setNumInstalments(Math.max(2, count));
  };

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
          lineJobAssignments: !createJobs ? lineJobs : {},
          createJobs,
          dueDate: dueDate || null,
          subtotal,
          vat,
          total,
          splitRecurring,
          numInstalments: splitRecurring ? numInstalments : null,
          frequency: splitRecurring ? frequency : null,
          firstDueDate: splitRecurring ? firstDueDate : null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to convert quote.");
        setConverting(false);
        return;
      }

      router.push(splitRecurring ? "/invoices" : `/invoices/${data.invoiceId}`);
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
      <label className="flex items-start gap-2 cursor-pointer rounded-xl border border-slate-100 p-3 hover:bg-slate-50 transition-colors">
        <input
          type="checkbox"
          checked={createJobs}
          onChange={(e) => setCreateJobs(e.target.checked)}
          className="w-4 h-4 rounded mt-0.5"
        />
        <span>
          <span className="block text-sm font-medium text-slate-700">
            Create a job for each line item
          </span>
          <span className="block text-xs text-slate-500 mt-0.5">
            One job per quote line, named from its description. Job type comes from the service's Job Type Link where set, otherwise guessed from the description — review and adjust on each job afterwards.
          </span>
        </span>
      </label>

      {!createJobs && (
        <div className="rounded-xl border border-slate-100 p-3 space-y-2">
          <p className="text-sm font-medium text-slate-700">Link Each Line to an Existing Job (optional)</p>
          <p className="text-xs text-slate-500 mb-2">Assign a different job per line, or leave any unassigned.</p>
          {quoteLines.map((line) => (
            <div key={line.id} className="flex items-center gap-2">
              <span className="flex-1 text-xs text-slate-600 truncate">{line.description}</span>
              <select
                value={lineJobs[line.id] || ""}
                onChange={(e) => setLineJobs((prev) => ({ ...prev, [line.id]: e.target.value }))}
                className="w-48 rounded-xl border border-slate-200 p-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
              >
                <option value="">No job</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.job_name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {quoteLines.length === 0 && (
            <p className="text-xs text-slate-400">No line items on this quote.</p>
          )}
        </div>
      )}

      <div className="rounded-xl border border-slate-100 p-3">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={splitRecurring}
            onChange={(e) => setSplitRecurring(e.target.checked)}
            className="w-4 h-4 rounded mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium text-slate-700">
              Split into recurring invoices
            </span>
            <span className="block text-xs text-slate-500 mt-0.5">
              Raises several smaller invoices instead of one, e.g. a £1,200 quote as 12 monthly invoices of £100 — useful for billing on account rather than up front.
            </span>
          </span>
        </label>

        {splitRecurring && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Number of Invoices</label>
                <input
                  type="number"
                  min="2"
                  max="52"
                  value={numInstalments}
                  onChange={(e) => setNumInstalments(parseInt(e.target.value) || 2)}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Frequency</label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
                >
                  <option value="Weekly">Weekly</option>
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">First Invoice Due Date</label>
              <input
                type="date"
                value={firstDueDate}
                onChange={(e) => setFirstDueDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>

            <div className="rounded-lg bg-white border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-700 mb-2">
                Or work it out from a date — e.g. bill everything by the client's year end
              </p>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Bill Up To</label>
                  <input
                    type="date"
                    value={billByDate}
                    onChange={(e) => setBillByDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={calculateInstalmentsFromDate}
                  disabled={!firstDueDate || !billByDate}
                  className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  Calculate
                </button>
              </div>
              {!firstDueDate && (
                <p className="text-xs text-slate-400 mt-1">Set the first due date above first</p>
              )}
            </div>
            {numInstalments > 0 && (
              <p className="text-xs text-slate-500">
                {numInstalments} invoices of ~£{instalmentAmount.toFixed(2)} each (the last one absorbs any rounding, so they total exactly £{total.toFixed(2)})
              </p>
            )}
          </div>
        )}
      </div>

      {!splitRecurring && (
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
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        onClick={handleConvert}
        disabled={converting}
        className="w-full rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 transition-colors disabled:opacity-50"
      >
        {converting
          ? "Converting..."
          : splitRecurring
          ? `🧾 Create ${numInstalments} Invoices`
          : "🧾 Convert to Invoice"}
      </button>
    </div>
  );
}
