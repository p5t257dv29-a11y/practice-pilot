"use client";

import { useState } from "react";

export default function StaffSwitcher({
  staffNames,
  currentStaff,
  weekStart,
}: {
  staffNames: string[];
  currentStaff: string;
  weekStart: string;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <form method="get" className="flex items-center gap-2">
      <input type="hidden" name="week" value={weekStart} />

      {adding ? (
        <input
          name="staff"
          autoFocus
          placeholder="New staff name"
          className="rounded-xl border border-slate-200 p-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      ) : (
        <select
          name="staff"
          defaultValue={currentStaff}
          onChange={(e) => {
            if (e.target.value === "__add_new__") setAdding(true);
          }}
          className="rounded-xl border border-slate-200 p-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          {staffNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
          <option value="__add_new__">+ Add new staff…</option>
        </select>
      )}

      <button type="submit" className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
        Go
      </button>
    </form>
  );
}
