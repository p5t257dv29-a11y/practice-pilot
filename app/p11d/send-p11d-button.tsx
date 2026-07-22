"use client";

import { useState, useEffect } from "react";

export default function SendP11DButton({
  computationId,
  defaultEmail,
  computationToken,
  status: approvalStatus,
  approvedAt,
  queriedAt,
}: {
  computationId: string;
  defaultEmail: string;
  computationToken: string | null;
  status?: string | null;
  approvedAt?: string | null;
  queriedAt?: string | null;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [computationUrl, setComputationUrl] = useState<string | null>(null);

  useEffect(() => {
    if (computationToken) {
      setComputationUrl(`${window.location.origin}/p11d/approve/${computationToken}`);
    }
  }, [computationToken]);

  const handleSend = async () => {
    if (!email) return;
    setStatus("sending");

    try {
      const res = await fetch("/api/send-p11d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ computationId, clientEmail: email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        return;
      }

      setStatus("sent");
      setComputationUrl(data.computationUrl);
    } catch {
      setStatus("error");
    }
  };

  const fmtDateTime = (iso: string) =>
    `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} at ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <div className="space-y-3">
      {approvalStatus === "Approved" && approvedAt && (
        <div className="rounded-xl bg-green-50 border border-green-100 p-3">
          <p className="text-xs font-semibold text-green-700">✓ Approved by client</p>
          <p className="text-xs text-green-600 mt-0.5">{fmtDateTime(approvedAt)}</p>
        </div>
      )}
      {approvalStatus === "Queried" && queriedAt && (
        <div className="rounded-xl bg-yellow-50 border border-yellow-100 p-3">
          <p className="text-xs font-semibold text-yellow-700">Query raised by client</p>
          <p className="text-xs text-yellow-600 mt-0.5">{fmtDateTime(queriedAt)}</p>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Employee/Director Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="employee@example.com"
        />
      </div>

      <button
        onClick={handleSend}
        disabled={status === "sending" || !email}
        className="w-full rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        {status === "sending" ? "Sending..." : status === "sent" ? "✓ Sent!" : "Send for Approval"}
      </button>

      {status === "error" && (
        <p className="text-xs text-red-600">
          Failed to send. Please check the email and try again.
        </p>
      )}

      {status === "sent" && computationUrl && (
        <div className="rounded-xl bg-green-50 border border-green-100 p-3">
          <p className="text-xs font-semibold text-green-700 mb-1">P11D summary sent!</p>
          <p className="text-xs text-green-600 mb-2">
            They can also access it directly via this link:
          </p>
          <a
            href={computationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline break-all"
          >
            {computationUrl}
          </a>
        </div>
      )}

      {computationToken && status === "idle" && (
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
          <p className="text-xs text-slate-500 mb-1">Previously sent — client link:</p>
          <a
            href={`/p11d/approve/${computationToken}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline break-all"
          >
            {typeof window !== "undefined" ? `${window.location.origin}/p11d/approve/${computationToken}` : `/p11d/approve/${computationToken}`}
          </a>
        </div>
      )}
    </div>
  );
}
