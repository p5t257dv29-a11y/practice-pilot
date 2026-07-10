import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { ALL_CATEGORIES, PL_CATEGORIES, BS_CATEGORIES } from "../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function saveMappings(trialBalanceId: string, clientId: string, formData: FormData) {
  "use server";

  const { data: lines } = await supabase
    .from("trial_balance_lines")
    .select("id, nominal_code")
    .eq("trial_balance_id", trialBalanceId);

  for (const line of lines || []) {
    const category = String(formData.get(`category_${line.id}`) || "").trim();
    if (!category) continue;

    await supabase.from("trial_balance_lines").update({ category }).eq("id", line.id);

    if (line.nominal_code) {
      await supabase.from("nominal_code_mappings").upsert(
        { client_id: clientId, nominal_code: line.nominal_code, category },
        { onConflict: "client_id,nominal_code" }
      );
    }
  }

  revalidatePath(`/accounts-production/${trialBalanceId}`);
  revalidatePath("/accounts-production");
}

export default async function TrialBalanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: tb, error } = await supabase
    .from("trial_balances")
    .select("*, clients(client_name), jobs(job_name)")
    .eq("id", id)
    .single();

  if (error || !tb) notFound();

  const { data: lines } = await supabase
    .from("trial_balance_lines")
    .select("*")
    .eq("trial_balance_id", id)
    .order("nominal_code", { ascending: true });

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const totalDebit = (lines || []).reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = (lines || []).reduce((s, l) => s + Number(l.credit), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const unmappedLines = (lines || []).filter((l) => !l.category);
  const mappedLines = (lines || []).filter((l) => l.category);

  // Category totals (net = debit - credit, shown as entered; sign interpretation
  // depends on whether the category is normally a debit or credit balance)
  const categoryTotals = new Map<string, { debit: number; credit: number }>();
  mappedLines.forEach((l) => {
    const existing = categoryTotals.get(l.category) || { debit: 0, credit: 0 };
    existing.debit += Number(l.debit);
    existing.credit += Number(l.credit);
    categoryTotals.set(l.category, existing);
  });

  const saveMappingsWithIds = saveMappings.bind(null, id, tb.client_id);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/accounts-production" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Accounts Production
        </a>
        <div className="mt-4">
          <h1 className="text-2xl font-bold text-slate-900">{(tb.clients as any)?.client_name || "No client"}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Period {new Date(tb.period_start).toLocaleDateString("en-GB")} to {new Date(tb.period_end).toLocaleDateString("en-GB")}
            {(tb.jobs as any)?.job_name && ` · Job: ${(tb.jobs as any).job_name}`}
            {tb.filename && ` · ${tb.filename}`}
          </p>
        </div>
      </div>

      <div className="p-8">
        {/* Balance check */}
        <div className={`rounded-2xl p-4 border ${isBalanced ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100"}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-bold ${isBalanced ? "text-green-700" : "text-red-700"}`}>
                {isBalanced ? "✓ Trial balance is balanced" : "⚠ Trial balance does not balance"}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Total Debits: {fmt(totalDebit)} · Total Credits: {fmt(totalCredit)}
                {!isBalanced && ` · Difference: ${fmt(Math.abs(totalDebit - totalCredit))}`}
              </p>
            </div>
          </div>
        </div>

        {/* Unmapped lines — need categorising */}
        {unmappedLines.length > 0 && (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">
              Map Categories ({unmappedLines.length} unmapped)
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Assign each nominal code to a category. This is remembered for this client, so future uploads with the same codes will map automatically.
            </p>
            <form action={saveMappingsWithIds} className="mt-4 space-y-2">
              {unmappedLines.map((line) => (
                <div key={line.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {line.nominal_code && <span className="text-slate-400 font-mono mr-2">{line.nominal_code}</span>}
                      {line.description}
                    </p>
                    <p className="text-xs text-slate-400">
                      Dr {fmt(Number(line.debit))} · Cr {fmt(Number(line.credit))}
                    </p>
                  </div>
                  <select name={`category_${line.id}`}
                    className="w-72 rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                    <option value="">Select category...</option>
                    <optgroup label="Profit & Loss">
                      {PL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                    <optgroup label="Balance Sheet">
                      {BS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                  </select>
                </div>
              ))}
              <button type="submit"
                className="mt-3 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save Mappings
              </button>
            </form>
          </div>
        )}

        {/* Category totals */}
        {categoryTotals.size > 0 && (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Category Totals</h2>
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Profit & Loss</p>
                <div className="space-y-1 text-sm">
                  {PL_CATEGORIES.filter((c) => categoryTotals.has(c)).map((c) => {
                    const t = categoryTotals.get(c)!;
                    return (
                      <div key={c} className="flex justify-between">
                        <span className="text-slate-600">{c}</span>
                        <span className="font-medium">{fmt(t.debit - t.credit)}</span>
                      </div>
                    );
                  })}
                  {PL_CATEGORIES.filter((c) => categoryTotals.has(c)).length === 0 && (
                    <p className="text-xs text-slate-400">No P&L lines mapped yet.</p>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Balance Sheet</p>
                <div className="space-y-1 text-sm">
                  {BS_CATEGORIES.filter((c) => categoryTotals.has(c)).map((c) => {
                    const t = categoryTotals.get(c)!;
                    return (
                      <div key={c} className="flex justify-between">
                        <span className="text-slate-600">{c}</span>
                        <span className="font-medium">{fmt(t.debit - t.credit)}</span>
                      </div>
                    );
                  })}
                  {BS_CATEGORIES.filter((c) => categoryTotals.has(c)).length === 0 && (
                    <p className="text-xs text-slate-400">No Balance Sheet lines mapped yet.</p>
                  )}
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-4">
              Figures shown as Debit − Credit. Formatted Profit &amp; Loss and Balance Sheet statements are the next stage of this module.
            </p>
          </div>
        )}

        {/* All lines (reference) */}
        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">All Lines ({lines?.length ?? 0})</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="pb-2">Code</th>
                  <th className="pb-2">Description</th>
                  <th className="pb-2">Category</th>
                  <th className="pb-2 text-right">Debit</th>
                  <th className="pb-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(lines || []).map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 font-mono text-slate-500">{l.nominal_code || "—"}</td>
                    <td className="py-2 text-slate-900">{l.description}</td>
                    <td className="py-2 text-slate-600">{l.category || <span className="text-yellow-600">Unmapped</span>}</td>
                    <td className="py-2 text-right">{Number(l.debit) > 0 ? fmt(Number(l.debit)) : "—"}</td>
                    <td className="py-2 text-right">{Number(l.credit) > 0 ? fmt(Number(l.credit)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
