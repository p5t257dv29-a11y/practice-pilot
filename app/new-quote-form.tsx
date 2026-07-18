"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Client {
  id: string;
  client_name: string;
}
interface ServiceOption {
  id: string;
  service_name: string;
}

export default function NewQuoteForm({ clients, services }: { clients: Client[]; services: ServiceOption[] }) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");

  const [lines, setLines] = useState(
    Array(6).fill(null).map(() => ({ service_id: "", description: "", qty: "1", price: "0", vat_rate: "20" }))
  );

  const updateLine = (i: number, patch: Partial<{ service_id: string; description: string; qty: string; price: string; vat_rate: string }>) => {
    setLines((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };

  const activeLines = lines.filter((l) => l.description.trim());
  const subtotal = activeLines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.price) || 0), 0);
  const vat = activeLines.reduce((s, l) => s + ((parseFloat(l.qty) || 0) * (parseFloat(l.price) || 0) * (parseFloat(l.vat_rate) || 0)) / 100, 0);
  const total = subtotal + vat;

  const today = new Date().toISOString().split("T")[0];
  const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const [quoteDate, setQuoteDate] = useState(today);
  const [validUntil, setValidUntil] = useState(thirtyDays);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!clientId || activeLines.length === 0) {
      setError("Select a client and at least one line item.");
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/create-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          lines: activeLines.map((l) => ({
            service_id: l.service_id || null,
            description: l.description,
            qty: parseFloat(l.qty) || 1,
            price: parseFloat(l.price) || 0,
            vat_rate: parseFloat(l.vat_rate) || 0,
          })),
          subtotal, vat, total,
          quoteDate,
          validUntil,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create quote.");
        setSubmitting(false);
        return;
      }
      router.push(`/quotes/${data.quoteId}`);
    } catch {
      setError("Failed to create quote. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
      <h2 className="text-lg font-bold text-slate-900">New Quote</h2>
      <p className="text-sm text-slate-500 mt-0.5">Raise a quote with all its line items in one go.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2 max-w-2xl">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}
            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
            <option value="">Select a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.client_name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Quote Date</label>
            <input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Valid Until</label>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="hidden md:flex gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wide px-1 mb-1">
          <span className="w-48">Service</span>
          <span className="flex-1 min-w-[180px]">Description</span>
          <span className="w-16 text-right">Qty</span>
          <span className="w-24 text-right">Price</span>
          <span className="w-20 text-right">VAT %</span>
        </div>
        <div className="space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-center">
              <select value={line.service_id} onChange={(e) => updateLine(i, { service_id: e.target.value })}
                className="w-48 rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                <option value="">No service</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.service_name}</option>
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
      </div>

      <div className="mt-4 flex justify-end">
        <div className="w-64 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-medium">£{subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">VAT</span><span className="font-medium">£{vat.toFixed(2)}</span></div>
          <div className="flex justify-between border-t border-slate-100 pt-1 font-bold"><span>Total</span><span>£{total.toFixed(2)}</span></div>
        </div>
      </div>

      <div className="mt-6 max-w-2xl">
        <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          placeholder="Any notes to include on the quote"
          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button onClick={handleSubmit} disabled={submitting}
        className="mt-6 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors disabled:opacity-50">
        {submitting ? "Creating..." : "Create Quote"}
      </button>
    </div>
  );
}
