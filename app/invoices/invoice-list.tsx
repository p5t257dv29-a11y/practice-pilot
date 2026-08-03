"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const formatCurrency = (amount: number | string) => {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "£0.00";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

export default function InvoiceList({
  invoices,
  deleteInvoiceAction,
}: {
  invoices: any[];
  deleteInvoiceAction: (id: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<{ sent: number; failed: number } | null>(null);
  const router = useRouter();

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkSend = async () => {
    setSending(true);
    setResults(null);
    let sent = 0;
    let failed = 0;

    // Sent sequentially rather than all at once — avoids hammering Xero's API
    // with parallel requests and keeps error reporting per-invoice reliable.
    for (const id of selected) {
      try {
        const res = await fetch("/api/xero/send-invoice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoiceId: id }),
        });
        if (res.ok) sent++;
        else failed++;
      } catch {
        failed++;
      }
    }

    setResults({ sent, failed });
    setSelected(new Set());
    setSending(false);
    router.refresh();
  };

  return (
    <div className="mt-4 space-y-3">
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 mb-2">
          <span className="text-sm text-white font-medium">
            {selected.size} invoice{selected.size > 1 ? "s" : ""} selected
          </span>
          <button
            onClick={handleBulkSend}
            disabled={sending}
            className="rounded-lg bg-[#13B5EA] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {sending ? "Sending..." : `→ Send ${selected.size} to Xero`}
          </button>
        </div>
      )}

      {results && (
        <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm">
          Sent {results.sent} invoice{results.sent !== 1 ? "s" : ""} to Xero.
          {results.failed > 0 && (
            <span className="text-red-600"> {results.failed} failed — check each invoice for details.</span>
          )}
        </div>
      )}

      {invoices.map((invoice) => {
        const alreadySent = !!invoice.xero_invoice_id;
        return (
          <div
            key={invoice.id}
            className="flex items-center justify-between rounded-xl border border-slate-100 p-4"
          >
            <div className="flex items-center gap-3 flex-1">
              <input
                type="checkbox"
                checked={selected.has(invoice.id)}
                disabled={alreadySent}
                onChange={() => toggleSelected(invoice.id)}
                className="w-4 h-4 rounded disabled:opacity-30"
                title={alreadySent ? "Already sent to Xero" : "Select for bulk send"}
              />
              <a href={`/invoices/${invoice.id}`} className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-900">{invoice.invoice_number}</p>
                  {invoice.quotes?.quote_number && (
                    <span className="text-xs text-slate-400">from {invoice.quotes.quote_number}</span>
                  )}
                  {alreadySent && (
                    <span className="text-xs text-[#13B5EA] font-semibold">✓ Sent to Xero</span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  {invoice.clients?.client_name || "No client"}
                  {invoice.jobs?.job_name && ` · ${invoice.jobs.job_name}`}
                </p>
                {invoice.due_date && (
                  <p
                    className={`text-xs mt-1 ${
                      invoice.status !== "Paid" && new Date(invoice.due_date) < new Date()
                        ? "text-red-500 font-semibold"
                        : "text-slate-400"
                    }`}
                  >
                    Due: {new Date(invoice.due_date).toLocaleDateString("en-GB")}
                    {invoice.status !== "Paid" && new Date(invoice.due_date) < new Date() && " — OVERDUE"}
                  </p>
                )}
              </a>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="font-bold text-slate-900">{formatCurrency(invoice.total || 0)}</p>
                <p className="text-xs text-slate-400">inc. VAT</p>
              </div>

              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  invoice.status === "Paid"
                    ? "bg-green-100 text-green-700"
                    : invoice.status === "Sent"
                    ? "bg-blue-100 text-blue-700"
                    : invoice.status === "Overdue"
                    ? "bg-red-100 text-red-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {invoice.status}
              </span>

              <form action={deleteInvoiceAction.bind(null, invoice.id)}>
                <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                  Delete
                </button>
              </form>
            </div>
          </div>
        );
      })}
    </div>
  );
}