import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { calculateNBV } from "../../page";
import { INTANGIBLE_CATEGORY_OPTIONS } from "../../add/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEPN_REFERENCE = "DEPN-AUTO";

async function postDepreciation(clientId: string, tbId: string, formData: FormData) {
  "use server";

  const { data: tb } = await supabase.from("trial_balances").select("*").eq("id", tbId).single();
  if (!tb) redirect(`/fixed-assets/register/depreciation?client=${clientId}&tb=${tbId}&error=Trial+balance+not+found`);

  // Block duplicate posting — the reference tag lets us find an existing auto-posted
  // depreciation journal for this exact period, so re-running this doesn't double up.
  const { data: existing } = await supabase
    .from("journals")
    .select("id")
    .eq("trial_balance_id", tbId)
    .eq("reference", DEPN_REFERENCE)
    .maybeSingle();

  if (existing) {
    redirect(`/fixed-assets/register/depreciation?client=${clientId}&tb=${tbId}&error=Depreciation+already+posted+for+this+period+%E2%80%94+reverse+it+from+Journals+first`);
  }

  const { data: assets } = await supabase
    .from("fixed_assets")
    .select("*")
    .eq("client_id", clientId);

  const periodStart = new Date(tb.period_start);
  const periodEnd = new Date(tb.period_end);

  const rows: { nominal_code: null; description: string; debit: number; credit: number; category: string }[] = [];

  for (const asset of assets || []) {
    if (tb.job_id && asset.job_id && asset.job_id !== tb.job_id) continue;

    const nbvStart = calculateNBV(asset, periodStart).nbv;
    const nbvEnd = calculateNBV(asset, periodEnd).nbv;
    const charge = Math.round((nbvStart - nbvEnd) * 100) / 100;

    if (charge <= 0) continue;

    const isIntangible = asset.asset_type === "Intangible";
    const expenseCategory = isIntangible ? "Amortisation" : "Depreciation";
    const assetCategory = isIntangible ? "Intangible Fixed Assets" : "Tangible Fixed Assets";
    const label = `${isIntangible ? "Amortisation" : "Depreciation"} — ${asset.description}`;

    rows.push({ nominal_code: null, description: label, debit: charge, credit: 0, category: expenseCategory });
    rows.push({ nominal_code: null, description: label, debit: 0, credit: charge, category: assetCategory });
  }

  if (rows.length === 0) {
    redirect(`/fixed-assets/register/depreciation?client=${clientId}&tb=${tbId}&error=No+depreciation+due+for+this+period`);
  }

  const { data: journal, error: journalError } = await supabase
    .from("journals")
    .insert({
      trial_balance_id: tbId,
      reference: DEPN_REFERENCE,
      description: `Depreciation/amortisation charge for year ended ${periodEnd.toLocaleDateString("en-GB")}`,
      journal_date: tb.period_end,
    })
    .select()
    .single();

  if (journalError || !journal) {
    redirect(`/fixed-assets/register/depreciation?client=${clientId}&tb=${tbId}&error=Could+not+create+journal`);
  }

  await supabase.from("trial_balance_lines").insert(
    rows.map((r) => ({ trial_balance_id: tbId, journal_id: journal!.id, ...r }))
  );

  revalidatePath(`/accounts-production/${tbId}`);
  revalidatePath(`/accounts-production/${tbId}/journal`);
  revalidatePath(`/accounts-production/${tbId}/accounts`);
  revalidatePath("/fixed-assets/register");
  redirect(`/accounts-production/${tbId}/journal`);
}

export default async function PostDepreciationPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; tb?: string; error?: string }>;
}) {
  const { client: clientId, tb: tbId, error } = await searchParams;

  if (!clientId) redirect("/fixed-assets/register");

  const [{ data: client }, { data: trialBalances }] = await Promise.all([
    supabase.from("clients").select("client_name").eq("id", clientId).single(),
    supabase
      .from("trial_balances")
      .select("id, period_start, period_end, job_id")
      .eq("client_id", clientId)
      .order("period_end", { ascending: false }),
  ]);

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  let preview: { assetId: string; description: string; category: string; isIntangible: boolean; charge: number }[] = [];
  let selectedTb: any = null;
  let alreadyPosted = false;

  if (tbId) {
    const { data: tb } = await supabase.from("trial_balances").select("*").eq("id", tbId).single();
    selectedTb = tb;

    if (tb) {
      const { data: existing } = await supabase
        .from("journals")
        .select("id, created_at")
        .eq("trial_balance_id", tbId)
        .eq("reference", DEPN_REFERENCE)
        .maybeSingle();
      alreadyPosted = !!existing;

      const { data: assets } = await supabase.from("fixed_assets").select("*").eq("client_id", clientId);
      const periodStart = new Date(tb.period_start);
      const periodEnd = new Date(tb.period_end);

      for (const asset of assets || []) {
        if (tb.job_id && asset.job_id && asset.job_id !== tb.job_id) continue;
        const nbvStart = calculateNBV(asset, periodStart).nbv;
        const nbvEnd = calculateNBV(asset, periodEnd).nbv;
        const charge = Math.round((nbvStart - nbvEnd) * 100) / 100;
        if (charge <= 0) continue;
        preview.push({
          assetId: asset.id,
          description: asset.description,
          category: asset.category || "Uncategorised",
          isIntangible: asset.asset_type === "Intangible",
          charge,
        });
      }
    }
  }

  const totalTangible = preview.filter((p) => !p.isIntangible).reduce((s, p) => s + p.charge, 0);
  const totalIntangible = preview.filter((p) => p.isIntangible).reduce((s, p) => s + p.charge, 0);

  const postDepreciationWithIds = tbId ? postDepreciation.bind(null, clientId, tbId) : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href={`/fixed-assets/register?client=${clientId}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Register
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">Post Depreciation</h1>
        <p className="text-sm text-slate-500 mt-0.5">{client?.client_name}</p>
      </div>

      <div className="p-8 max-w-3xl space-y-6">
        {error && (
          <div className="rounded-2xl bg-red-50 border border-red-100 p-4">
            <p className="text-sm font-bold text-red-700">⚠ {decodeURIComponent(error).replace(/\+/g, " ")}</p>
          </div>
        )}

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Select Period</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Choose the trial balance/accounting period to post this year's depreciation into.
          </p>
          <form method="get" className="mt-4 flex gap-3">
            <input type="hidden" name="client" value={clientId} />
            <select
              name="tb"
              defaultValue={tbId || ""}
              className="flex-1 rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
            >
              <option value="">Select a period</option>
              {(trialBalances || []).map((tb) => (
                <option key={tb.id} value={tb.id}>
                  {new Date(tb.period_start).toLocaleDateString("en-GB")} to {new Date(tb.period_end).toLocaleDateString("en-GB")}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Load
            </button>
          </form>
        </div>

        {selectedTb && alreadyPosted && (
          <div className="rounded-2xl bg-amber-50 border border-amber-100 p-6">
            <p className="text-sm font-bold text-amber-800">Depreciation already posted for this period.</p>
            <p className="text-sm text-amber-700 mt-1">
              To make changes (e.g. after adding a new asset), reverse the existing depreciation journal first, then post again.
            </p>
            <a
              href={`/accounts-production/${tbId}/journal`}
              className="mt-3 inline-block rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 transition-colors"
            >
              Go to Journals →
            </a>
          </div>
        )}

        {selectedTb && !alreadyPosted && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">
              Preview — Period {new Date(selectedTb.period_start).toLocaleDateString("en-GB")} to{" "}
              {new Date(selectedTb.period_end).toLocaleDateString("en-GB")}
            </h2>

            {preview.length === 0 ? (
              <p className="text-sm text-slate-500 mt-4">No depreciation due for any asset in this period.</p>
            ) : (
              <>
                <div className="mt-4 space-y-1">
                  {preview.map((p) => (
                    <div key={p.assetId} className="flex justify-between text-sm py-1 border-b border-slate-50">
                      <span className="text-slate-600">
                        {p.description} <span className="text-slate-400">({p.category})</span>
                      </span>
                      <span className="font-medium">{fmt(p.charge)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t border-slate-200 space-y-1">
                  {totalTangible > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Total Depreciation (P&amp;L)</span>
                      <span className="font-semibold">{fmt(totalTangible)}</span>
                    </div>
                  )}
                  {totalIntangible > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Total Amortisation (P&amp;L)</span>
                      <span className="font-semibold">{fmt(totalIntangible)}</span>
                    </div>
                  )}
                </div>
                <form action={postDepreciationWithIds!} className="mt-4">
                  <button
                    type="submit"
                    className="rounded-xl bg-green-600 px-6 py-3 text-sm font-semibold text-white hover:bg-green-700 transition-colors"
                  >
                    Post Depreciation Journal
                  </button>
                  <p className="text-xs text-slate-400 mt-2">
                    Posts as a normal journal — reversible any time from the Journals page for this period.
                  </p>
                </form>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}