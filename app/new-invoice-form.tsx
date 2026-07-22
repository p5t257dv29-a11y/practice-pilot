"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Client {
  id: string;
  client_name: string;
}
interface Job {
  id: string;
  job_name: string;
  client_id: string;
}

export default function NewInvoiceForm({ clients, jobs }: { clients: Client[]; jobs: Job[] }) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");

  const [lines, setLines] = useState(
    Array(6).fill(null).map(() => ({ job_id: "", description: "", qty: "1", price: "0", vat_rate: "20" }))
  );

  const updateLine = (i: number, patch: Partial<{ job_id: string; description: string; qty: string; price: string; vat_rate: string }>) => {
    setLines((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };

  const clientJobs = jobs.filter((j) => j.client_id === clientId);

  const activeLines = lines.filter((l) => l.description.trim());
  const subtotal = activeLines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.price) || 0), 0);
  const vat = activeLines.reduce((s, l) => s + ((parseFloat(l.qty) || 0) * (parseFloat(l.price) || 0) * (parseFloat(l.vat_rate) || 0)) / 100, 0);
  const total = subtotal + vat;

  const [splitRecurring, setSplitRecurring] = useState(false);
  const [numInstalments, setNumInstalments] = useState(2);
  const [frequency, setFrequency] = useState("Monthly");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [billByDate, setBillByDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const instalmentAmount = splitRecurring && numInstalments > 0 ? total / numInstalments : 0;

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

  const handleSubmit = async () => {
    if (!clientId || activeLines.length === 0) {
      setError("Select a client and at least one line item.");
      return;
    }
    setSubmitting(true);
    setError("");

    // The invoice as a whole links to the first line's job, for WIP reporting —
    // an invoice can only reference one job, even though each line can differ.
    const primaryJobId = activeLines.find((l) => l.job_id)?.job_id || null;

    try {
      const res = await fetch("/api/create-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          jobId: primaryJobId,
          lines: activeLines.map((l) => ({
            job_id: l.job_id || null,
            description: l.description,
            qty: parseFloat(l.qty) || 1,
            price: parseFloat(l.price) || 0,
            vat_rate: parseFloat(l.vat_rate) || 0,
          })),
          subtotal, vat, total,
          dueDate: dueDate || null,
          splitRecurring,
          numInstalments: splitRecurring ? numInstalments : null,
          frequency: splitRecurring ? frequency : null,
          firstDueDate: splitRecurring ? firstDueDate : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create invoice.");
        setSubmitting(false);
        return;
      }
      router.push(splitRecurring ? "/invoices" : `/invoices/${data.invoiceId}`);
    } catch {
      setError("Failed to create invoice. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
      <h2 className="text-lg font-bold text-slate-900">New Invoice</h2>
      <p className="text-sm text-slate-500 mt-0.5">Raise an invoice directly, without needing a quote first.</p>

      <div className="mt-6 max-w-sm">
        <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)}
          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
          <option value="">Select a client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.client_name}</option>
          ))}
        </select>
      </div>

      <div className="mt-6">
        <div className="hidden md:flex gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wide px-1 mb-1">
          <span className="w-40">Job</span>
          <span className="flex-1 min-w-[180px]">Description</span>
          <span className="w-16 text-right">Qty</span>
          <span className="w-24 text-right">Net</span>
          <span className="w-20 text-right">Tax Code</span>
        </div>
        <div className="space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-center">
              <select value={line.job_id} onChange={(e) => updateLine(i, { job_id: e.target.value })}
                className="w-40 rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                <option value="">No job</option>
                {clientJobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.job_name}</option>
                ))}
              </select>
              <input value={line.description} onChange={(e) => updateLine(i, { description: e.target.value })}
                placeholder="Line description"
                className="flex-1 min-w-[180px] rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input type="number" step="0.01" min="0" value={line.qty} onChange={(e) => updateLine(i, { qty: e.target.value })}
                className="w-16 rounded-xl border border-slate-200 p-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input type="number" step="0.01" min="0" value={line.price} onChange={(e) => updateLine(i, { price: e.target.value })}
                className="w-24 rounded-xl border border-slate-200 p-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <select value={line.vat_rate} onChange={(e) => updateLine(i, { vat_rate: e.target.value })}
                className="w-20 rounded-xl border border-slate-200 p-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                <option value="20">20%</option>
                <option value="5">5%</option>
                <option value="0">0%</option>
              </select>
            </div>
          ))}
        </div>
        {!clientId && (
          <p className="text-xs text-slate-400 mt-2">Select a client above to choose from their jobs on each line.</p>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <div className="w-64 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-medium">£{subtotal.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">VAT</span><span className="font-medium">£{vat.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <div className="flex justify-between border-t border-slate-100 pt-1 font-bold"><span>Total</span><span>£{total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
        </div>
      </div>

      {/* Recurring split — unchanged */}
      <div className="mt-6 rounded-xl border border-slate-100 p-3">
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={splitRecurring} onChange={(e) => setSplitRecurring(e.target.checked)} className="w-4 h-4 rounded mt-0.5" />
          <span>
            <span className="block text-sm font-medium text-slate-700">Split into recurring invoices</span>
            <span className="block text-xs text-slate-500 mt-0.5">
              Raises several smaller invoices instead of one — useful for billing on account rather than up front.
            </span>
          </span>
        </label>

        {splitRecurring && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Number of Invoices</label>
                <input type="number" min="2" max="52" value={numInstalments}
                  onChange={(e) => setNumInstalments(parseInt(e.target.value) || 2)}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Frequency</label>
                <select value={frequency} onChange={(e) => setFrequency(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                  <option value="Weekly">Weekly</option>
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">First Invoice Due Date</label>
              <input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-700 mb-2">Or work it out from a date — e.g. bill everything by the client's year end</p>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Bill Up To</label>
                  <input type="date" value={billByDate} onChange={(e) => setBillByDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <button type="button" onClick={calculateInstalmentsFromDate} disabled={!firstDueDate || !billByDate}
                  className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 transition-colors disabled:opacity-40 whitespace-nowrap">
                  Calculate
                </button>
              </div>
            </div>

            {numInstalments > 0 && total > 0 && (
              <p className="text-xs text-slate-500">
                {numInstalments} invoices of ~£{instalmentAmount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} each (the last absorbs rounding, so they total exactly £{total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
              </p>
            )}
          </div>
        )}
      </div>

      {!splitRecurring && (
        <div className="mt-4 max-w-xs">
          <label className="block text-sm font-medium text-slate-700 mb-1">Payment Due Date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button onClick={handleSubmit} disabled={submitting}
        className="mt-6 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors disabled:opacity-50">
        {submitting ? "Creating..." : splitRecurring ? `Create ${numInstalments} Invoices` : "Create Invoice"}
      </button>
    </div>
  );
}
