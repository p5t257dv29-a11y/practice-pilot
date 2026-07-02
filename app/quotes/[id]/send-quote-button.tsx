"use client";

import { useState } from "react";

export default function SendQuoteButton({
  quoteId,
  defaultEmail,
  quoteToken,
}: {
  quoteId: string;
  defaultEmail: string;
  quoteToken: string | null;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [quoteUrl, setQuoteUrl] = useState<string | null>(
    quoteToken ? `${window.location.origin}/q/${quoteToken}` : null
  );

  const handleSend = async () => {
    if (!email) return;
    setStatus("sending");

    try {
      const res = await fetch("/api/send-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId, clientEmail: email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        return;
      }

      setStatus("sent");
      setQuoteUrl(data.quoteUrl);
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Client Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="client@example.com"
        />
      </div>

      <button
        onClick={handleSend}
        disabled={status === "sending" || !email}
        className="w-full rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        {status === "sending" ? "Sending..." : status === "sent" ? "✓ Sent!" : "Send Quote by Email"}
      </button>

      {status === "error" && (
        <p className="text-xs text-red-600">
          Failed to send. Please check the email and try again.
        </p>
      )}

      {status === "sent" && quoteUrl && (
        <div className="rounded-xl bg-green-50 border border-green-100 p-3">
          <p className="text-xs font-semibold text-green-700 mb-1">Quote sent!</p>
          <p className="text-xs text-green-600 mb-2">
            Client can also access it directly via this link:
          </p>
          <a
            href={quoteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline break-all"
          >
            {quoteUrl}
          </a>
        </div>
      )}

      {quoteToken && status === "idle" && (
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
          <p className="text-xs text-slate-500 mb-1">Previously sent — client link:</p>
          <a
            href={`/q/${quoteToken}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline break-all"
          >
            {typeof window !== "undefined" ? `${window.location.origin}/q/${quoteToken}` : `/q/${quoteToken}`}
          </a>
        </div>
      )}
    </div>
  );
}
