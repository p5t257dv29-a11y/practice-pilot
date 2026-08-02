"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SendToXeroButton({
  invoiceId,
  alreadySent,
}: {
  invoiceId: string;
  alreadySent: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    alreadySent ? "sent" : "idle"
  );
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSend = async () => {
    setStatus("sending");
    setError("");

    try {
      const res = await fetch("/api/xero/send-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to send to Xero.");
        setStatus("error");
        return;
      }

      setStatus("sent");
      router.refresh();
    } catch {
      setError("Failed to send to Xero. Please try again.");
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div className="w-full rounded-xl bg-slate-50 border border-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-500 text-center">
        ✓ Sent to Xero
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={handleSend}
        disabled={status === "sending"}
        className="w-full rounded-xl bg-[#13B5EA] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {status === "sending" ? "Sending to Xero..." : "→ Send to Xero"}
      </button>
      {status === "error" && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}