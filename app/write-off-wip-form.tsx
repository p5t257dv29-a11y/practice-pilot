"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const REASON_CATEGORIES = [
  "Fee dispute",
  "Client insolvency / gone away",
  "Scope creep / goodwill",
  "Abortive work",
  "Fixed fee overrun",
  "Other",
];

export default function WriteOffWipForm({
  jobId,
  currentWip,
}: {
  jobId: string;
  currentWip: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reasonCategory, setReasonCategory] = useState(REASON_CATEGORIES[0]);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  if (currentWip <= 0) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("saving");
    setErrorMessage("");

    const parsedAmount = Number(amount);

    if (!parsedAmount || parsedAmount <= 0) {
      setStatus("error");
      setErrorMessage("Enter an amount greater than zero.");
      return;
    }

    if (parsedAmount > currentWip) {
      setStatus("error");
      setErrorMessage(`Amount exceeds current WIP balance of £${currentWip.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
      return;
    }

    try {
      const res = await fetch("/api/wip-writeoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, amount: parsedAmount, reasonCategory, notes }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error || "Failed to record write-off.");
        return;
      }

      setOpen(false);
      setAmount("");
      setNotes("");
      setStatus("idle");
      router.refresh();
    } catch {
      setStatus("error");
      setErrorMessage("Something went wrong. Please try again.");
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
      >
        Write off WIP
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-slate-200 p-4 space-y-3 bg-slate-50"
    >
      <p className="text-sm font-semibold text-slate-900">Write off WIP</p>
      <p className="text-xs text-slate-500">
        Current WIP balance: £{currentWip.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          Amount to write off
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          max={currentWip}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="0.00"
          required
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Reason</label>
        <select
          value={reasonCategory}
          onChange={(e) => setReasonCategory(e.target.value)}
          className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          {REASON_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>

      {status === "error" && (
        <p className="text-xs text-red-600">{errorMessage}</p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={status === "saving"}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
        >
          {status === "saving" ? "Saving..." : "Confirm write-off"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
