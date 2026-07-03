"use client";

import { useState } from "react";

export default function SendEngagementButton({
  letterId,
  clientEmail,
  alreadySent,
  sentAt,
}: {
  letterId: string;
  clientEmail: string;
  alreadySent: boolean;
  sentAt: string | null;
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(alreadySent);
  const [error, setError] = useState("");

  const handleSend = async () => {
    setSending(true);
    setError("");

    try {
      const res = await fetch("/api/send-engagement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ letterId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError("Failed to send. Please try again.");
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
        <p className="text-sm font-semibold text-green-700">✓ Email sent to {clientEmail}</p>
        {sentAt && (
          <p className="text-xs text-green-600 mt-0.5">
            Sent {new Date(sentAt).toLocaleDateString("en-GB")}
          </p>
        )}
        <button
          onClick={handleSend}
          disabled={sending}
          className="mt-2 text-xs text-green-600 hover:underline"
        >
          Resend
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleSend}
        disabled={sending}
        className="w-full rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        {sending ? "Sending..." : "📧 Send for Signing by Email"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
