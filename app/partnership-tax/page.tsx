import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { calculateCapitalAllowances } from "../fixed-assets/capital-allowances/page";
import { calculateProfitAndLoss } from "../accounts-production/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Computes the partnership's adjusted total profit for the period —
// same adjustment logic as Corporation Tax, but with no tax charge:
// partnerships are tax-transparent, so the profit is simply allocated to partners.
export function calculatePartnershipProfit(input: {
  accountingProfit: number;
  depreciationAddback: number;
  disallowableExpenses: number;
  otherAllowableDeductions: number;
  totalCapitalAllowances: number;
}) {
  const adjustedProfit =
    input.accountingProfit +
    input.depreciationAddback +
    input.disallowableExpenses -
    input.totalCapitalAllowances -
    input.otherAllowableDeductions;

  return { adjustedProfit };
}

async function createComputation(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  const client_id = get("client_id");
  if (!client_id) return;

  const { data: computation, error } = await supabase
    .from("partnership_tax_computations")
    .insert({
      client_id,
      job_id: get("job_id") || null,
      period_start: get("period_start"),
      period_end: get("period_end"),
      accounting_profit: num("accounting_profit"),
      depreciation_addback: num("depreciation_addback"),
      disallowable_expenses: num("disallowable_expenses"),
      other_allowable_deductions: num("other_allowable_deductions"),
      main_pool_bfwd: num("main_pool_bfwd"),
      special_rate_pool_bfwd: num("special_rate_pool_bfwd"),
      notes: get("notes"),
    })
    .select()
    .single();

  if (error || !computation) {
    console.error("Could not create partnership tax computation:", error?.message);
    return;
  }

  const partnerRows = [];
  for (let i = 0; i < 6; i++) {
    const partnerName = get(`partner_name_${i}`);
    const share = num(`profit_share_${i}`);
    if (!partnerName) continue;
    partnerRows.push({
      computation_id: computation.id,
      partner_name: partnerName,
      partner_client_id: get(`partner_client_${i}`) || null,
      profit_share_percentage: share,
    });
  }

  if (partnerRows.length > 0) {
    await supabase.from("partnership_tax_partners").insert(partnerRows);
  }

  revalidatePath("/partnership-tax");
}

async function deleteComputation(id: string) {
  "use server";
  await supabase.from("partnership_tax_computations").delete().eq("id", id);
  revalidatePath("/partnership-tax");
}

export default async function PartnershipTaxPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; client?: string; job?: string; browseClient?: string }>;
}) {
  const { mode, client: selectedClientId, job: selectedJobId, browseClient: browseClientId } = await searchParams;

  const [{ data: computations, error }, { data: clients }, { data: jobs }] = await Promise.all([
    supabase
      .from("partnership_tax_computations")
      .select("*, clients(client_name), jobs(job_name), partnership_tax_partners(id, partner_name, profit_share_percentage)")
      .order("created_at", { ascending: false }),
    supabase.from("clients").select("id, client_name").order("client_name", { ascending: true }),
    supabase.from("jobs").select("id, job_name, client_id").order("job_name", { ascending: true }),
  ]);

  const rows = await Promise.all(
    (computations || []).map(async (comp) => {
      const { data: assets } = await supabase.from("fixed_assets").select("*").eq("client_id", comp.client_id);

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

      const partners = comp.partnership_tax_partners || [];
      const totalShare = partners.reduce((s: number, p: any) => s + Number(p.profit_share_percentage), 0);

      return { comp, ca, adjustedProfit, partners, totalShare };
    })
  );

  const selectedClient = (clients || []).find((c) => c.id === selectedClientId);

  // If a job is selected, look up its most recent linked trial balance and
  // suggest Accounting Profit / Depreciation / Period from the accounts
  let linkedTrialBalance: any = null;
  let suggestedAccountingProfit = 0;
  let suggestedDepreciation = 0;
  let suggestedPeriodStart = "";
  let suggestedPeriodEnd = "";

  if (selectedJobId) {
    const { data: tb } = await supabase
      .from("trial_balances")
      .select("*, trial_balance_lines(*)")
      .eq("job_id", selectedJobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tb) {
      linkedTrialBalance = tb;
      const pl = calculateProfitAndLoss(tb.trial_balance_lines || []);
      suggestedAccountingProfit = pl.profitBeforeTax;
      suggestedDepreciation = pl.depreciation;
      suggestedPeriodStart = tb.period_start;
      suggestedPeriodEnd = tb.period_end;
    }
  }

  const selectedJobRecord = selectedJobId ? (jobs || []).find((j) => j.id === selectedJobId) : null;

  const browseRows = browseClientId ? rows.filter((r) => r.comp.client_id === browseClientId) : [];

  const renderRow = ({ comp, ca, adjustedProfit, partners, totalShare }: (typeof rows)[number]) => (
    <div key={comp.id} className="rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
      <div className="flex items-center justify-between">
        <a href={`/partnership-tax/${comp.id}`} className="flex-1">
          <p className="font-semibold text-slate-900">
            {(comp.clients as any)?.client_name || "No client"} — {new Date(comp.period_start).toLocaleDateString("en-GB")} to {new Date(comp.period_end).toLocaleDateString("en-GB")}
          </p>
          <p className="text-sm text-slate-500">
            Adjusted profit: £{adjustedProfit.toFixed(2)} · Capital allowances: £{ca.totalCapitalAllowances.toFixed(2)} · {partners.length} partner{partners.length !== 1 ? "s" : ""}
          </p>
        </a>
        <form action={deleteComputation.bind(null, comp.id)}>
          <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
            Delete
          </button>
        </form>
      </div>
      {partners.length > 0 && Math.abs(totalShare - 100) > 0.01 && (
        <div className="mt-2 rounded-lg bg-yellow-50 px-3 py-1.5 text-xs font-semibold text-yellow-700">
          ⚠ Profit shares total {totalShare.toFixed(2)}%, not 100%
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Partnership Tax</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Computes adjusted partnership profit and allocates it across partners — partnerships are tax-transparent, so each partner is taxed individually via their own Personal Tax.
        </p>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load computations: {error.message}
          </div>
        )}

        {/* Entry choice: Browse existing vs Start New */}
        <div className="grid gap-4 md:grid-cols-2 mb-6">
          <a href="/partnership-tax?mode=browse"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "browse" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "browse" ? "text-white" : "text-slate-900"}`}>Browse Existing</p>
            <p className={`text-sm mt-1 ${mode === "browse" ? "text-slate-300" : "text-slate-500"}`}>Find a partnership's computations</p>
          </a>
          <a href="/partnership-tax?mode=new"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "new" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "new" ? "text-white" : "text-slate-900"}`}>+ New Computation</p>
            <p className={`text-sm mt-1 ${mode === "new" ? "text-slate-300" : "text-slate-500"}`}>Select a partnership to start</p>
          </a>
        </div>

        {/* BROWSE MODE */}
        {mode === "browse" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Find Partnership</h2>
            <form method="get" className="mt-4 flex gap-2">
              <input type="hidden" name="mode" value="browse" />
              <select name="browseClient" defaultValue={browseClientId || ""}
                className="flex-1 max-w-md rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                <option value="">Select a partnership</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}</option>
                ))}
              </select>
              <button type="submit"
                className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                Show
              </button>
            </form>

            {browseClientId && (
              <div className="mt-6 space-y-3">
                {browseRows.map(renderRow)}
                {browseRows.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-8">No partnership tax computations on file for this client yet.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* NEW MODE */}
        {mode === "new" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">New Partnership Tax Computation</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Capital allowances are calculated automatically from assets acquired in this period in the Fixed Asset Register.
            </p>

            {/* Step 1: pick the partnership client */}
            <form method="get" className="mt-4 flex gap-2 items-end">
              <input type="hidden" name="mode" value="new" />
              <div className="flex-1 max-w-sm">
                <label className="block text-sm font-medium text-slate-700 mb-1">Partnership (Client)</label>
                <select name="client" defaultValue={selectedClientId || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                  <option value="">Select the partnership to start</option>
                  {(clients || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.client_name}</option>
                  ))}
                </select>
              </div>
              <button type="submit"
                className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                Continue
              </button>
            </form>

            {/* Step 2: optionally pick a linked job */}
            {selectedClientId && selectedClient && selectedJobId === undefined && (
              <div className="mt-4">
                <form method="get" className="flex gap-2 items-end">
                  <input type="hidden" name="mode" value="new" />
                  <input type="hidden" name="client" value={selectedClientId} />
                  <div className="flex-1 max-w-sm">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Linked Job (optional)</label>
                    <select name="job" defaultValue=""
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                      <option value="">No linked job</option>
                      {(jobs || []).filter((j) => j.client_id === selectedClientId).map((j) => (
                        <option key={j.id} value={j.id}>{j.job_name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-400 mt-1">
                      If linked, capital allowances pull from that job's assets, and Accounting Profit/Depreciation/Period pre-fill from any linked trial balance.
                    </p>
                  </div>
                  <button type="submit"
                    className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                    Continue
                  </button>
                </form>
                <a href={`/partnership-tax?mode=new&client=${selectedClientId}&job=`}
                  className="inline-block mt-2 text-xs font-semibold text-blue-600 hover:underline">
                  Skip — continue without a job →
                </a>
              </div>
            )}

            {/* Step 3: full form */}
            {selectedClientId && selectedClient && selectedJobId !== undefined && (
              <>
                {linkedTrialBalance && (
                  <div className="mt-4 rounded-xl bg-green-50 border border-green-100 p-3 text-sm text-green-800">
                    Trial balance found for this job, period {new Date(suggestedPeriodStart).toLocaleDateString("en-GB")} to {new Date(suggestedPeriodEnd).toLocaleDateString("en-GB")}:
                    {" "}Accounting Profit and Depreciation have been pre-filled from the accounts below.
                  </div>
                )}

                <form action={createComputation} className="mt-4 space-y-6">
                  <input type="hidden" name="client_id" value={selectedClientId} />
                  <input type="hidden" name="job_id" value={selectedJobId || ""} />
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                    <span className="text-sm font-medium text-slate-700">
                      Partnership: {selectedClient.client_name}
                      {selectedJobRecord && ` · Job: ${selectedJobRecord.job_name}`}
                    </span>
                    <a href="/partnership-tax?mode=new" className="text-xs font-semibold text-blue-600 hover:underline">Change client</a>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Period Start *</label>
                      <input name="period_start" type="date" required defaultValue={suggestedPeriodStart || ""}
                        className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Period End *</label>
                      <input name="period_end" type="date" required defaultValue={suggestedPeriodEnd || ""}
                        className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                    <div></div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Accounting Profit (£) {linkedTrialBalance && <span className="text-green-600 font-normal">(auto-filled)</span>}
                      </label>
                      <input name="accounting_profit" type="number" step="0.01" defaultValue={suggestedAccountingProfit || 0}
                        className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Depreciation Add-back (£) {linkedTrialBalance && <span className="text-green-600 font-normal">(auto-filled)</span>}
                      </label>
                      <input name="depreciation_addback" type="number" step="0.01" min="0" defaultValue={suggestedDepreciation || 0}
                        className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Other Disallowable Expenses (£)</label>
                      <input name="disallowable_expenses" type="number" step="0.01" min="0" defaultValue="0"
                        className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Other Allowable Deductions (£)</label>
                      <input name="other_allowable_deductions" type="number" step="0.01" min="0" defaultValue="0"
                        className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Main Pool Brought Forward (£)</label>
                      <input name="main_pool_bfwd" type="number" step="0.01" min="0" defaultValue="0"
                        className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Special Rate Pool Brought Forward (£)</label>
                      <input name="special_rate_pool_bfwd" type="number" step="0.01" min="0" defaultValue="0"
                        className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                  </div>

                  {/* Partners */}
                  <div className="border-t border-slate-100 pt-6">
                    <h3 className="text-sm font-bold text-slate-900 mb-1">Partners</h3>
                    <p className="text-xs text-slate-400 mb-4">
                      Add each partner and their profit-sharing percentage. Link to an existing client to later pull their share into their Personal Tax computation. Shares should sum to 100%.
                    </p>
                    <div className="hidden md:grid grid-cols-12 gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wide px-1 mb-1">
                      <span className="col-span-4">Partner Name</span>
                      <span className="col-span-5">Link to Client (optional)</span>
                      <span className="col-span-3 text-right">Profit Share %</span>
                    </div>
                    <div className="space-y-2">
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="grid gap-2 md:grid-cols-12">
                          <input name={`partner_name_${i}`} placeholder="Partner name"
                            className="md:col-span-4 rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                          <select name={`partner_client_${i}`} defaultValue=""
                            className="md:col-span-5 rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                            <option value="">No linked client</option>
                            {(clients || []).map((c) => (
                              <option key={c.id} value={c.id}>{c.client_name}</option>
                            ))}
                          </select>
                          <input name={`profit_share_${i}`} type="number" step="0.01" min="0" max="100" placeholder="0.00"
                            className="md:col-span-3 rounded-xl border border-slate-200 p-2.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                    <textarea name="notes" rows={2}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>

                  <button type="submit"
                    className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                    Calculate & Save
                  </button>
                </form>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
