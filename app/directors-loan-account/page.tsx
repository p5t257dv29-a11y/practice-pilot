import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { CREDIT_NORMAL } from "../accounts-production/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// S455 CTA 2010: charge on the outstanding DLA balance at the company's year end
// if not cleared by 9 months and 1 day after the period end. Rate tracks the
// dividend upper rate — 35.75% for loans made on or after 6 April 2026.
export function calculateS455(input: {
  closingBalance: number;
  periodEnd: string;
  repaidByDueDate: boolean;
  s455Rate: number;
}) {
  const dueDate = new Date(input.periodEnd);
  dueDate.setMonth(dueDate.getMonth() + 9);
  dueDate.setDate(dueDate.getDate() + 1);

  const isOverdrawn = input.closingBalance > 0;
  const s455Due = isOverdrawn && !input.repaidByDueDate
    ? Math.round(input.closingBalance * (input.s455Rate / 100) * 100) / 100
    : 0;

  return { dueDate, isOverdrawn, s455Due };
}

// Finds each distinct DLA nominal code within a trial balance's "Directors' Loan
// Account" category lines, computing each one's closing balance (and, if a prior
// period trial balance exists for the client, its opening balance too). Positive
// = director owes the company (overdrawn) — matches the sign convention already
// used for this category on the FRS 105/102 accounts pages.
async function detectDLABalances(trialBalanceId: string) {
  const { data: tb } = await supabase.from("trial_balances").select("*").eq("id", trialBalanceId).single();
  if (!tb) return { tb: null, detected: [] };

  const { data: lines } = await supabase
    .from("trial_balance_lines")
    .select("*")
    .eq("trial_balance_id", trialBalanceId)
    .eq("category", "Directors' Loan Account");

  // Group by description — each distinct nominal code/description is treated as one director
  const byDescription = new Map<string, number>();
  (lines || []).forEach((l) => {
    const net = CREDIT_NORMAL.has("Directors' Loan Account")
      ? Number(l.credit) - Number(l.debit)
      : Number(l.debit) - Number(l.credit);
    byDescription.set(l.description, (byDescription.get(l.description) || 0) + net);
  });

  // Find the prior trial balance for this client, for opening balances
  const { data: priorTb } = await supabase
    .from("trial_balances")
    .select("id")
    .eq("client_id", tb.client_id)
    .lt("period_end", tb.period_start)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  let priorByDescription = new Map<string, number>();
  if (priorTb) {
    const { data: priorLines } = await supabase
      .from("trial_balance_lines")
      .select("*")
      .eq("trial_balance_id", priorTb.id)
      .eq("category", "Directors' Loan Account");
    (priorLines || []).forEach((l) => {
      const net = Number(l.debit) - Number(l.credit);
      priorByDescription.set(l.description, (priorByDescription.get(l.description) || 0) + net);
    });
  }

  const detected = Array.from(byDescription.entries()).map(([description, closingBalance]) => ({
    description,
    closingBalance,
    openingBalance: priorByDescription.get(description) || 0,
  }));

  return { tb, detected };
}

async function createDLA(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  const client_id = get("client_id");
  const director_name = get("director_name");
  const period_start = get("period_start");
  const period_end = get("period_end");
  if (!client_id || !director_name || !period_start || !period_end) return;

  await supabase.from("directors_loan_accounts").insert({
    client_id,
    job_id: get("job_id") || null,
    corporation_tax_id: get("corporation_tax_id") || null,
    director_name,
    period_start,
    period_end,
    opening_balance: num("opening_balance"),
    closing_balance: num("closing_balance"),
    repaid_by_due_date: formData.get("repaid_by_due_date") === "on",
    repayment_date: get("repayment_date") || null,
    s455_rate: num("s455_rate") || 35.75,
    notes: get("notes"),
  });

  revalidatePath("/directors-loan-account");
}

async function deleteDLA(id: string) {
  "use server";
  await supabase.from("directors_loan_accounts").delete().eq("id", id);
  revalidatePath("/directors-loan-account");
}

export default async function DirectorsLoanAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; trial_balance_id?: string; browseClient?: string }>;
}) {
  const { mode, trial_balance_id, browseClient: browseClientId } = await searchParams;

  const [{ data: dlas, error }, { data: clients }, { data: jobs }, { data: ctComputations }, { data: trialBalances }] = await Promise.all([
    supabase
      .from("directors_loan_accounts")
      .select("*, clients(client_name)")
      .order("created_at", { ascending: false }),
    supabase.from("clients").select("id, client_name").order("client_name", { ascending: true }),
    supabase.from("jobs").select("id, job_name, client_id, period_start, period_end").order("job_name", { ascending: true }),
    supabase.from("corporation_tax_computations").select("id, client_id, period_start, period_end").order("period_end", { ascending: false }),
    supabase.from("trial_balances").select("id, client_id, period_start, period_end, clients(client_name)").order("period_end", { ascending: false }),
  ]);

  const { tb: selectedTb, detected } = trial_balance_id
    ? await detectDLABalances(trial_balance_id)
    : { tb: null, detected: [] };

  const rows = (dlas || []).map((dla) => ({
    dla,
    result: calculateS455({
      closingBalance: Number(dla.closing_balance),
      periodEnd: dla.period_end,
      repaidByDueDate: dla.repaid_by_due_date,
      s455Rate: Number(dla.s455_rate),
    }),
  }));

  const browseRows = browseClientId ? rows.filter((r) => r.dla.client_id === browseClientId) : [];

  const renderRow = ({ dla, result }: (typeof rows)[number]) => (
    <div key={dla.id} className={`flex items-center justify-between rounded-xl border p-4 ${
      result.s455Due > 0 ? "border-red-200 bg-red-50" : "border-slate-100"
    }`}>
      <div>
        <p className="font-semibold text-slate-900">
          {dla.director_name} — {(dla.clients as any)?.client_name}
        </p>
        <p className="text-sm text-slate-500 mt-0.5">
          Year ended {new Date(dla.period_end).toLocaleDateString("en-GB")} · Closing balance £{Number(dla.closing_balance).toFixed(2)}
          {result.isOverdrawn && ` · S455 due date ${result.dueDate.toLocaleDateString("en-GB")}`}
        </p>
      </div>
      <div className="flex items-center gap-4">
        {result.s455Due > 0 ? (
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
            S455: £{result.s455Due.toFixed(2)}
          </span>
        ) : result.isOverdrawn ? (
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">✓ Cleared in time</span>
        ) : (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">Not overdrawn</span>
        )}
        <form action={deleteDLA.bind(null, dla.id)}>
          <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
            Delete
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Director's Loan Account & S455</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Tracks overdrawn DLA balances and calculates the S455 charge if not cleared within 9 months and 1 day of the year end.
        </p>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load records: {error.message}
          </div>
        )}

        {/* Entry choice: Browse existing vs Start New */}
        <div className="grid gap-4 md:grid-cols-2 mb-6">
          <a href="/directors-loan-account?mode=browse"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "browse" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "browse" ? "text-white" : "text-slate-900"}`}>Browse Existing</p>
            <p className={`text-sm mt-1 ${mode === "browse" ? "text-slate-300" : "text-slate-500"}`}>Find a client's DLA / S455 records</p>
          </a>
          <a href="/directors-loan-account?mode=new"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "new" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "new" ? "text-white" : "text-slate-900"}`}>+ New Record</p>
            <p className={`text-sm mt-1 ${mode === "new" ? "text-slate-300" : "text-slate-500"}`}>Pull from a trial balance, or enter manually</p>
          </a>
        </div>

        {/* BROWSE MODE */}
        {mode === "browse" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Find Client</h2>
            <form method="get" className="mt-4 flex gap-2">
              <input type="hidden" name="mode" value="browse" />
              <select name="browseClient" defaultValue={browseClientId || ""}
                className="flex-1 max-w-md rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                <option value="">Select a client</option>
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
              <div className="mt-6 space-y-2">
                {browseRows.map(renderRow)}
                {browseRows.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-8">No DLA records on file for this client yet.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* NEW MODE */}
        {mode === "new" && (
          <>
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Pull From a Trial Balance</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Detects each distinct DLA nominal code in the trial balance and works out closing balances (and opening balances, from the prior period) automatically.
              </p>
              <form method="get" className="mt-4 flex gap-2 items-end">
                <input type="hidden" name="mode" value="new" />
                <div className="flex-1 max-w-lg">
                  <select name="trial_balance_id" defaultValue={trial_balance_id || ""}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                    <option value="">Select a trial balance</option>
                    {(trialBalances || []).map((tb) => (
                      <option key={tb.id} value={tb.id}>
                        {(tb.clients as any)?.client_name} — {new Date(tb.period_start).toLocaleDateString("en-GB")} to {new Date(tb.period_end).toLocaleDateString("en-GB")}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit"
                  className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                  Detect Balances
                </button>
              </form>

              {trial_balance_id && (
                <div className="mt-4 space-y-2">
                  {detected.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-4">
                      No lines mapped to "Directors' Loan Account" found on this trial balance. Check your Chart of Accounts mapping.
                    </p>
                  )}
                  {detected.map((d) => (
                    <div key={d.description} className="flex items-center justify-between rounded-xl border border-slate-100 p-4">
                      <div>
                        <p className="font-semibold text-slate-900">{d.description}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Opening: £{d.openingBalance.toFixed(2)} · Closing: £{d.closingBalance.toFixed(2)}
                          {d.closingBalance <= 0 && " (not overdrawn — no S455 risk)"}
                        </p>
                      </div>
                      <form action={createDLA}>
                        <input type="hidden" name="client_id" value={selectedTb?.client_id} />
                        <input type="hidden" name="director_name" value={d.description} />
                        <input type="hidden" name="period_start" value={selectedTb?.period_start} />
                        <input type="hidden" name="period_end" value={selectedTb?.period_end} />
                        <input type="hidden" name="opening_balance" value={d.openingBalance} />
                        <input type="hidden" name="closing_balance" value={d.closingBalance} />
                        <input type="hidden" name="s455_rate" value="35.75" />
                        <button type="submit"
                          className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors">
                          Create Record →
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Or Enter Manually</h2>
              <p className="text-sm text-slate-500 mt-0.5">One per director per accounting period.</p>

              <form action={createDLA} className="mt-6 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
                  <select name="client_id" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                    <option value="">Select a client</option>
                    {(clients || []).map((c) => (
                      <option key={c.id} value={c.id}>{c.client_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Director Name *</label>
                  <input name="director_name" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Period Start *</label>
                  <input name="period_start" type="date" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Period End *</label>
                  <input name="period_end" type="date" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Linked Job (optional)</label>
                  <select name="job_id"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                    <option value="">No linked job</option>
                    {(jobs || []).map((j) => (
                      <option key={j.id} value={j.id}>{j.job_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Linked Corporation Tax Computation (optional)</label>
                  <select name="corporation_tax_id"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                    <option value="">No linked computation</option>
                    {(ctComputations || []).map((ct) => (
                      <option key={ct.id} value={ct.id}>
                        {new Date(ct.period_start).toLocaleDateString("en-GB")} – {new Date(ct.period_end).toLocaleDateString("en-GB")}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">Linking this lets the S455 charge feed into that CT computation's tax payable.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Opening Balance (£)</label>
                  <input name="opening_balance" type="number" step="0.01" defaultValue="0"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="Positive = overdrawn" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Closing Balance (£) *</label>
                  <input name="closing_balance" type="number" step="0.01" required defaultValue="0"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="Positive = overdrawn at year end" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">S455 Rate (%)</label>
                  <input name="s455_rate" type="number" step="0.01" defaultValue="35.75"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <p className="text-xs text-slate-400 mt-1">
                    35.75% applies to loans made on/after 6 April 2026. If this period spans that date with a mixed-rate balance, adjust manually.
                  </p>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer pb-3">
                    <input name="repaid_by_due_date" type="checkbox" className="w-4 h-4 rounded" />
                    <span className="text-sm font-medium text-slate-700">Repaid/cleared before the 9-month-1-day deadline</span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Repayment Date (if applicable)</label>
                  <input name="repayment_date" type="date"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                  <input name="notes"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>

                <div className="md:col-span-2">
                  <button type="submit"
                    className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                    Save & Calculate
                  </button>
                </div>
              </form>
            </div>
          </>
        )}

        <div className="mt-6 rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
          <p className="text-xs text-yellow-800">
            Working calculation only. Doesn't handle mixed-rate balances spanning 6 April 2026, the £15,000 full-time employee exemption, bed-and-breakfasting anti-avoidance rules, or partial repayments — review manually for anything beyond a straightforward single-rate overdrawn balance.
          </p>
        </div>
      </div>
    </div>
  );
}
