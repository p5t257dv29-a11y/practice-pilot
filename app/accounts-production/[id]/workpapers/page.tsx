import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { BS_CATEGORIES, CREDIT_NORMAL } from "../../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Fixed Assets has its own dedicated Register — not duplicated here
const WORKPAPER_CATEGORIES = BS_CATEGORIES.filter((c) => c !== "Tangible Fixed Assets");

export default async function WorkpapersHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: tb, error } = await supabase
    .from("trial_balances")
    .select("*, clients(client_name)")
    .eq("id", id)
    .single();

  if (error || !tb) notFound();

  const [{ data: lines }, { data: workpapers }] = await Promise.all([
    supabase.from("trial_balance_lines").select("*").eq("trial_balance_id", id),
    supabase.from("workpapers").select("*, workpaper_lines(amount)").eq("trial_balance_id", id),
  ]);

  // TB balance per category, using the same debit/credit normal-balance logic as the accounts
  const tbTotals = new Map<string, number>();
  (lines || []).forEach((l) => {
    if (!l.category) return;
    const net = CREDIT_NORMAL.has(l.category) ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit);
    tbTotals.set(l.category, (tbTotals.get(l.category) || 0) + net);
  });

  const workpapersByCategory = new Map((workpapers || []).map((w) => [w.category, w]));

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const rows = WORKPAPER_CATEGORIES.map((category) => {
    const tbBalance = tbTotals.get(category) || 0;
    const workpaper = workpapersByCategory.get(category);
    const supportingTotal = workpaper
      ? (workpaper.workpaper_lines || []).reduce((s: number, l: any) => s + Number(l.amount), 0)
      : 0;
    const variance = tbBalance - supportingTotal;
    const hasWorkpaper = !!workpaper;
    const isAgreed = hasWorkpaper && Math.abs(variance) < 0.01;

    return { category, tbBalance, supportingTotal, variance, hasWorkpaper, isAgreed, workpaper };
  }).filter((r) => r.tbBalance !== 0 || r.hasWorkpaper); // hide categories with no balance and no workpaper started

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href={`/accounts-production/${id}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Trial Balance
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">Workpapers</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {(tb.clients as any)?.client_name} · {new Date(tb.period_start).toLocaleDateString("en-GB")} to {new Date(tb.period_end).toLocaleDateString("en-GB")}
        </p>
      </div>

      <div className="p-8">
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold text-slate-900">Balance Sheet Reconciliations</h2>
            <a href={`/fixed-assets/report?job=${tb.job_id || ""}`}
              className="text-xs font-semibold text-blue-600 hover:underline">
              Fixed Assets Report →
            </a>
          </div>
          <p className="text-sm text-slate-500 mb-4">Each category's trial balance figure, reconciled against itemized supporting detail.</p>

          <div className="space-y-2">
            {rows.map((r) => (
              <a key={r.category} href={`/accounts-production/${id}/workpapers/${encodeURIComponent(r.category)}`}
                className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                <div>
                  <p className="font-semibold text-slate-900">{r.category}</p>
                  <p className="text-xs text-slate-500 mt-0.5">TB Balance: {fmt(r.tbBalance)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {r.workpaper?.reviewed_by ? (
                    <span className="rounded-full bg-purple-100 px-2.5 py-1 text-xs font-semibold text-purple-700">✓ Reviewed</span>
                  ) : r.workpaper?.prepared_by ? (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Prepared</span>
                  ) : null}
                  {!r.hasWorkpaper ? (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">Not Started</span>
                  ) : r.isAgreed ? (
                    <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">✓ Agreed</span>
                  ) : (
                    <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                      Variance {fmt(Math.abs(r.variance))}
                    </span>
                  )}
                </div>
              </a>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">
                No balance sheet categories with a balance on this trial balance yet.
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
          <p className="text-xs text-yellow-800">
            Reconciles each balance sheet figure against your own itemized supporting detail — it doesn't pull data from anywhere else automatically. "Agreed" means your supporting lines sum to exactly the trial balance figure.
          </p>
        </div>
      </div>
    </div>
  );
}
