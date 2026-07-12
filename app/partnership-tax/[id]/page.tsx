import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { calculatePartnershipProfit } from "../page";
import { calculateCapitalAllowances } from "../../fixed-assets/capital-allowances/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateComputation(id: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  await supabase.from("partnership_tax_computations").update({
    period_start: get("period_start"),
    period_end: get("period_end"),
    accounting_profit: num("accounting_profit"),
    depreciation_addback: num("depreciation_addback"),
    disallowable_expenses: num("disallowable_expenses"),
    other_allowable_deductions: num("other_allowable_deductions"),
    main_pool_bfwd: num("main_pool_bfwd"),
    special_rate_pool_bfwd: num("special_rate_pool_bfwd"),
    notes: get("notes"),
  }).eq("id", id);

  revalidatePath(`/partnership-tax/${id}`);
  revalidatePath("/partnership-tax");
}

async function addPartner(computationId: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const name = get("partner_name");
  if (!name) return;

  await supabase.from("partnership_tax_partners").insert({
    computation_id: computationId,
    partner_name: name,
    partner_client_id: get("partner_client_id") || null,
    profit_share_percentage: parseFloat(get("profit_share_percentage")) || 0,
  });

  revalidatePath(`/partnership-tax/${computationId}`);
}

async function deletePartner(computationId: string, partnerId: string) {
  "use server";
  await supabase.from("partnership_tax_partners").delete().eq("id", partnerId);
  revalidatePath(`/partnership-tax/${computationId}`);
}

export default async function PartnershipTaxDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: comp, error } = await supabase
    .from("partnership_tax_computations")
    .select("*, clients(client_name), jobs(job_name)")
    .eq("id", id)
    .single();

  if (error || !comp) notFound();

  const [{ data: partners }, { data: clients }, { data: assets }] = await Promise.all([
    supabase.from("partnership_tax_partners").select("*, clients:partner_client_id(client_name)").eq("computation_id", id).order("created_at", { ascending: true }),
    supabase.from("clients").select("id, client_name").order("client_name", { ascending: true }),
    supabase.from("fixed_assets").select("*").eq("client_id", comp.client_id),
  ]);

  const ca = calculateCapitalAllowances({
    assets: assets || [],
    periodStart: comp.period_start,
    periodEnd: comp.period_end,
    mainPoolBfwd: Number(comp.main_pool_bfwd),
    specialRatePoolBfwd: Number(comp.special_rate_pool_bfwd),
    jobId: comp.job_id,
  });

  const { adjustedProfit } = calculatePartnershipProfit({
    accountingProfit: Number(comp.accounting_profit),
    depreciationAddback: Number(comp.depreciation_addback),
    disallowableExpenses: Number(comp.disallowable_expenses),
    otherAllowableDeductions: Number(comp.other_allowable_deductions),
    totalCapitalAllowances: ca.totalCapitalAllowances,
  });

  const totalShare = (partners || []).reduce((s, p) => s + Number(p.profit_share_percentage), 0);
  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const updateWithId = updateComputation.bind(null, id);
  const addPartnerWithId = addPartner.bind(null, id);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/partnership-tax" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Partnership Tax
        </a>
        <div className="mt-4">
          <h1 className="text-2xl font-bold text-slate-900">{(comp.clients as any)?.client_name || "No client"}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Accounting period {new Date(comp.period_start).toLocaleDateString("en-GB")} to {new Date(comp.period_end).toLocaleDateString("en-GB")}
            {(comp.jobs as any)?.job_name && ` · Job: ${(comp.jobs as any).job_name}`}
          </p>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">

          {/* Adjusted Profit Computation */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Adjusted Profit Computation</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Accounting Profit</span><span className="font-medium">{fmt(Number(comp.accounting_profit))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Add: Depreciation</span><span className="font-medium">{fmt(Number(comp.depreciation_addback))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Add: Other Disallowable Expenses</span><span className="font-medium">{fmt(Number(comp.disallowable_expenses))}</span></div>
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <span className="text-slate-500">Less: Capital Allowances</span>
                <span className="font-medium text-red-600">({fmt(ca.totalCapitalAllowances)})</span>
              </div>
              <div className="flex justify-between"><span className="text-slate-500">Less: Other Allowable Deductions</span><span className="font-medium text-red-600">({fmt(Number(comp.other_allowable_deductions))})</span></div>
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-base">
                <span>Adjusted Total Profit</span>
                <span>{fmt(adjustedProfit)}</span>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-3">
              Partnerships are tax-transparent — this profit is allocated to partners below and taxed on each partner's own Personal Tax return, not at the partnership level.
            </p>
          </div>

          {/* Capital Allowances */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Capital Allowances</h2>
            <p className="text-xs text-slate-400 mt-1">
              {comp.job_id ? "Calculated from assets linked to this job in the Fixed Asset Register." : "Calculated from assets acquired within this date range."}
              {" "}AIA limit for this period: {fmt(ca.aiaLimit)}
            </p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">AIA Claimed</span><span className="font-medium">{fmt(ca.totalAIAClaimed)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">First Year Allowance (Zero Emission Cars)</span><span className="font-medium">{fmt(ca.totalFYA)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Main Pool WDA (14%)</span><span className="font-medium">{fmt(ca.mainPoolWDA)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Special Rate Pool WDA (6%)</span><span className="font-medium">{fmt(ca.specialRateWDA)}</span></div>
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                <span>Total Capital Allowances</span>
                <span>{fmt(ca.totalCapitalAllowances)}</span>
              </div>
            </div>
          </div>

          {/* Partnership Statement */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Partnership Statement</h2>
            <p className="text-xs text-slate-400 mt-1">Each partner's share of the adjusted total profit, for their own Self Assessment.</p>

            {(partners || []).length > 0 && Math.abs(totalShare - 100) > 0.01 && (
              <div className="mt-3 rounded-lg bg-yellow-50 px-3 py-2 text-xs font-semibold text-yellow-700">
                ⚠ Profit shares total {totalShare.toFixed(2)}%, not 100% — allocated amounts below won't sum to the full adjusted profit.
              </div>
            )}

            <div className="mt-4 space-y-2">
              {(partners || []).map((p) => {
                const share = (adjustedProfit * Number(p.profit_share_percentage)) / 100;
                return (
                  <div key={p.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-900">{p.partner_name}</p>
                      <p className="text-xs text-slate-500">
                        {Number(p.profit_share_percentage).toFixed(2)}% share
                        {(p.clients as any)?.client_name && ` · Linked to ${(p.clients as any).client_name}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="font-bold text-slate-900">{fmt(share)}</p>
                      {p.partner_client_id && (
                        <a href={`/tax?client=${p.partner_client_id}&self_employment=${share.toFixed(2)}`}
                          className="text-xs font-semibold text-blue-600 hover:underline whitespace-nowrap">
                          Add to Personal Tax →
                        </a>
                      )}
                      <form action={deletePartner.bind(null, id, p.id)}>
                        <button className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                          Remove
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })}
              {(!partners || partners.length === 0) && (
                <p className="text-sm text-slate-400 text-center py-4">No partners added yet.</p>
              )}
            </div>

            <form action={addPartnerWithId} className="mt-4 pt-4 border-t border-slate-100 grid gap-3 md:grid-cols-4">
              <input name="partner_name" placeholder="Partner name" required
                className="md:col-span-2 rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <select name="partner_client_id" defaultValue=""
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                <option value="">No linked client</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <input name="profit_share_percentage" type="number" step="0.01" min="0" max="100" placeholder="Share %"
                  className="flex-1 rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                <button type="submit"
                  className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 transition-colors whitespace-nowrap">
                  + Add
                </button>
              </div>
            </form>
          </div>

          {comp.notes && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Notes</h2>
              <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{comp.notes}</p>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <div className="rounded-2xl bg-slate-900 p-6 shadow-sm text-white">
            <h2 className="text-lg font-bold">Adjusted Total Profit</h2>
            <p className="mt-4 text-3xl font-bold">{fmt(adjustedProfit)}</p>
            <p className="mt-1 text-sm text-slate-300">Allocated across {(partners || []).length} partner{(partners || []).length !== 1 ? "s" : ""}</p>
          </div>

          <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
            <p className="text-xs text-yellow-800">
              This is a working-paper computation, not a filable SA800 return. It does not include partner capital account movements, partnership losses carried forward, or interest on capital. "Add to Personal Tax" pre-fills the client's Self-Employment Profit with this partner's share — review the rest of their income before saving.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Edit Computation</h2>
            <form action={updateWithId} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Period Start</label>
                <input name="period_start" type="date" defaultValue={comp.period_start}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Period End</label>
                <input name="period_end" type="date" defaultValue={comp.period_end}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Accounting Profit (£)</label>
                <input name="accounting_profit" type="number" step="0.01" defaultValue={comp.accounting_profit}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Depreciation Add-back (£)</label>
                <input name="depreciation_addback" type="number" step="0.01" min="0" defaultValue={comp.depreciation_addback}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Other Disallowable Expenses (£)</label>
                <input name="disallowable_expenses" type="number" step="0.01" min="0" defaultValue={comp.disallowable_expenses}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Other Allowable Deductions (£)</label>
                <input name="other_allowable_deductions" type="number" step="0.01" min="0" defaultValue={comp.other_allowable_deductions}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Main Pool Brought Forward (£)</label>
                <input name="main_pool_bfwd" type="number" step="0.01" min="0" defaultValue={comp.main_pool_bfwd}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Special Rate Pool Brought Forward (£)</label>
                <input name="special_rate_pool_bfwd" type="number" step="0.01" min="0" defaultValue={comp.special_rate_pool_bfwd}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" defaultValue={comp.notes || ""} rows={3}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <button type="submit"
                className="w-full rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save & Recalculate
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
