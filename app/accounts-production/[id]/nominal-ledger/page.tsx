import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function NominalLedgerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [{ data: tb, error }, { data: accounts }, { data: journals }, { data: lines }] = await Promise.all([
    supabase.from("trial_balances").select("*, clients(client_name)").eq("id", id).single(),
    supabase.from("chart_of_accounts").select("nominal_code, account_name"),
    supabase.from("journals").select("*").eq("trial_balance_id", id),
    supabase.from("trial_balance_lines").select("*").eq("trial_balance_id", id),
  ]);

  if (error || !tb) notFound();

  const fmt = (n: number) =>
    `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const accountNameByCode = new Map((accounts || []).map((a) => [a.nominal_code, a.account_name]));
  const journalById = new Map((journals || []).map((j) => [j.id, j]));

  // Each trial_balance_lines row is either the original TB import (journal_id is
  // null) or a journal adjustment (journal_id links to the journals table for its
  // date, reference and description). This groups every movement by nominal code,
  // so the ledger shows exactly what makes up each closing balance and why.
  const byCode = new Map<string, any[]>();
  for (const line of lines || []) {
    const code = line.nominal_code || "(No code)";
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push(line);
  }

  const sortedCodes = Array.from(byCode.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const codeGroups = sortedCodes.map((code) => {
    const codeLines = byCode.get(code)!;

const movements = codeLines.map((line) => {
      const journal = line.journal_id ? journalById.get(line.journal_id) : null;
      return {
        id: line.id,
        date: journal?.journal_date || null,
        reference: journal?.reference || null,
        description: journal ? journal.description : "Opening trial balance import",
        lineDescription: line.description,
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        isJournal: !!journal,
        journalId: line.journal_id || null,
      };
    });
    // Opening import lines first (no date), then journals in date order
    movements.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return -1;
      if (!b.date) return 1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    let running = 0;
    const withRunning = movements.map((m) => {
      running += m.debit - m.credit;
      return { ...m, runningBalance: running };
    });

    const totalDebit = movements.reduce((s, m) => s + m.debit, 0);
    const totalCredit = movements.reduce((s, m) => s + m.credit, 0);
    const closingBalance = totalDebit - totalCredit;

    return {
      code,
      accountName: accountNameByCode.get(code) || codeLines[0]?.description || "Unmapped",
      movements: withRunning,
      totalDebit,
      totalCredit,
      closingBalance,
    };
  });

  const grandTotalDebit = codeGroups.reduce((s, g) => s + g.totalDebit, 0);
  const grandTotalCredit = codeGroups.reduce((s, g) => s + g.totalCredit, 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6 print:hidden">
        <a
          href={`/accounts-production/${id}`}
          className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          ← Back to Trial Balance
        </a>
        <div className="flex items-center justify-between mt-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Nominal Ledger</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {(tb.clients as any)?.client_name} · Period {new Date(tb.period_start).toLocaleDateString("en-GB")} to{" "}
              {new Date(tb.period_end).toLocaleDateString("en-GB")}
            </p>
          </div>
<p className="text-xs text-slate-400 self-center">Use ⌘P to print or save as PDF</p>        </div>
      </div>

      <div className="p-8 print:p-0 space-y-6">
        <div className="hidden print:block mb-4">
          <h1 className="text-xl font-bold">{(tb.clients as any)?.client_name} — Nominal Ledger</h1>
          <p className="text-sm text-slate-500">
            Period {new Date(tb.period_start).toLocaleDateString("en-GB")} to{" "}
            {new Date(tb.period_end).toLocaleDateString("en-GB")}
          </p>
        </div>

        {codeGroups.map((group) => (
          <div
            key={group.code}
            className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 print:border print:shadow-none print:break-inside-avoid"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-slate-900">
                <span className="font-mono text-slate-400 mr-2">{group.code}</span>
                {group.accountName}
              </h2>
              <span
                className={`text-sm font-bold ${group.closingBalance >= 0 ? "text-slate-900" : "text-slate-900"}`}
              >
                {fmt(Math.abs(group.closingBalance))} {group.closingBalance >= 0 ? "Dr" : "Cr"}
              </span>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Reference</th>
                  <th className="py-2 pr-4">Description</th>
                  <th className="py-2 pr-4 text-right">Debit</th>
                  <th className="py-2 pr-4 text-right">Credit</th>
                  <th className="py-2 pr-4 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
{group.movements.map((m) => {
                  const editHref = m.isJournal
                    ? `/accounts-production/${id}/journal/${m.journalId}`
                    : `/accounts-production/${id}?line_edit=${m.id}`;
                  return (
                    <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50 print:hover:bg-transparent">
                      <td className="py-2 pr-4 text-slate-500">
                        <a href={editHref} className="hover:text-blue-600 hover:underline print:no-underline print:text-inherit">
                          {m.date ? new Date(m.date).toLocaleDateString("en-GB") : "—"}
                        </a>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-slate-400">
                        <a href={editHref} className="hover:text-blue-600 hover:underline print:no-underline print:text-inherit">
                          {m.reference || "—"}
                        </a>
                      </td>
                      <td className="py-2 pr-4">
                        <a href={editHref} className="hover:text-blue-600 hover:underline print:no-underline print:text-inherit">
                          {m.description}
                          {m.lineDescription && m.lineDescription !== m.description && (
                            <span className="text-slate-400"> — {m.lineDescription}</span>
                          )}
                        </a>
                      </td>
                      <td className="py-2 pr-4 text-right">{m.debit > 0 ? fmt(m.debit) : ""}</td>
                      <td className="py-2 pr-4 text-right">{m.credit > 0 ? fmt(m.credit) : ""}</td>
                      <td className="py-2 pr-4 text-right font-medium">
                        {fmt(Math.abs(m.runningBalance))} {m.runningBalance >= 0 ? "Dr" : "Cr"}
                      </td>
                    </tr>
                  );
                })}              
                </tbody>
            </table>
          </div>
        ))}

        <div className="rounded-2xl bg-slate-900 p-6 text-white print:border print:bg-white print:text-slate-900">
          <div className="flex justify-between text-sm">
            <span className="font-semibold">Total (all nominal codes)</span>
            <span className="font-mono">
              Dr {fmt(grandTotalDebit)} &nbsp;·&nbsp; Cr {fmt(grandTotalCredit)}
            </span>
          </div>
          {Math.abs(grandTotalDebit - grandTotalCredit) >= 0.01 && (
            <p className="text-xs text-amber-300 print:text-amber-700 mt-2">
              ⚠ Ledger does not balance — check for an incomplete journal or import error.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}