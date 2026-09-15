"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

function SubmitButton({ label, resendLabel, alreadySent }: { label: string; resendLabel: string; alreadySent: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={alreadySent
        ? "rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
        : "rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
      }
    >
      {pending ? "Sending..." : alreadySent ? resendLabel : label}
    </button>
  );
}

// Wraps a server action form so the button disables itself and shows
// "Sending..." the instant it's clicked — prevents a fast double-click from
// firing the same email twice, since the button becomes unclickable before
// the first click has even finished submitting.
export default function OnboardingSendButton({
  action,
  alreadySent,
}: {
  action: (formData: FormData) => void;
  alreadySent: boolean;
}) {
  return (
    <form action={action}>
      <SubmitButton label="Send" resendLabel="Resend" alreadySent={alreadySent} />
    </form>
  );
}