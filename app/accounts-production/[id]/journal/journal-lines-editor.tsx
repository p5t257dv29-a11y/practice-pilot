"use client";

import { useState } from "react";

interface ChartAccount {
  nominal_code: string;
  account_name: string;
  category: string;
}

export default function JournalLinesEditor({
  accounts,
  plCategories,
  bsCategories,
  initialLines,
}: {
  accounts: ChartAccount[];
  plCategories: string[];
  bsCategories: string[];
  initialLines?: { code: string; description: string; category: string; debit: string; credit: string }[];
}) {
  const emptyRow = { code: "", description: "", category: "" };
  const startingRows = Array(8).fill(null).map((_, i) => {
    const line = initialLines?.[i];
    return line ? { code: line.code, description: line.description, category: line.category } : emptyRow;
  });
  const [rows, setRows] = useState(startingRows);

  const updateRow = (i: number, patch: Partial<{ code: string; description: string; category: string }>) => {
    setRows((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };

  const handleCodeChange = (i: number, value: string) => {
    const match = accounts.find((a) => a.nominal_code === value);
    if (match) {
      updateRow(i, { code: value, category: match.category });
    } else {
      updateRow(i, { code: value });
    }
  };

  return (
    <>
      <datalist id="coa-codes">
        {accounts.map((a) => (
          <option key={a.nominal_code} value={a.nominal_code}>{a.account_name}</option>
        ))}
      </datalist>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap gap-2 items-center">
            <input
              name={`line_code_${i}`}
              list="coa-codes"
              placeholder="Code"
              value={row.code}
              onChange={(e) => handleCodeChange(i, e.target.value)}
              className="w-24 rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
            <input
              name={`line_description_${i}`}
              placeholder="Line description"
              value={row.description}
              onChange={(e) => updateRow(i, { description: e.target.value })}
              className="flex-1 min-w-[200px] rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
            <select
              name={`line_category_${i}`}
              value={row.category}
              onChange={(e) => updateRow(i, { category: e.target.value })}
              className="w-56 rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
            >
              <option value="">Category...</option>
              <optgroup label="Profit & Loss">
                {plCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </optgroup>
              <optgroup label="Balance Sheet">
                {bsCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </optgroup>
            </select>
            <div className="flex gap-2 flex-shrink-0">
              <input name={`line_debit_${i}`} type="number" step="0.01" min="0" placeholder="Debit"
                defaultValue={initialLines?.[i]?.debit || ""}
                className="w-28 rounded-xl border border-slate-200 p-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name={`line_credit_${i}`} type="number" step="0.01" min="0" placeholder="Credit"
                defaultValue={initialLines?.[i]?.credit || ""}
                className="w-28 rounded-xl border border-slate-200 p-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
