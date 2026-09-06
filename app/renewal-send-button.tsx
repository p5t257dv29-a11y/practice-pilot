"use client";

import { useState } from "react";

export default function SendRenewalButton({
  quoteId,
  defaultEmail,
}: {
  quoteId: string;
  defaultEmail: string;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSend = async () => {
    if (!email) {
      setError("Enter a client email first.");
      return;
    }
    setSending(true);
    setError("");

    try {
      const res = await fetch("/api/send-renewal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId, clientEmail: email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send. Please try again.");
        setSending(false);
        return;
      }
      setSent(true);
      setSending(false);
    } catch {
      setError("Failed to send. Please try again.");
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-xl bg-green-50 border border-green-100 p-3">
        <p className="text-sm font-semibold text-green-700">✓ Combined renewal sent to {email}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="client@example.com"
        className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
      <button
        onClick={handleSend}
        disabled={sending}
        className="w-full rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
      >
        {sending ? "Sending..." : "📧 Send Combined Renewal for Approval"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}