import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 2026/27 capital allowances rates. Update each April when HMRC rates change.
const CA_RATES = {
  aiaLimit: 1000000, // per 12-month period, pro-rated for shorter/longer periods
  mainPoolWDA: 0.14, // reduced from 18% to 14% from April 2026
  specialRatePoolWDA: 0.06,
};

export function calculateCapitalAllowances(input: {
  assets: any[];
  periodStart: string;
  periodEnd: string;
  mainPoolBfwd: number;
  specialRatePoolBfwd: number;
}) {
  const { assets, periodStart, periodEnd, mainPoolBfwd, specialRatePoolBfwd } = input;

  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const periodMonths = Math.max(1, Math.round((end.getTime() - start.getTime()) / (30.44 * 24 * 60 * 60 * 1000)));
  const aiaLimit = CA_RATES.aiaLimit * (periodMonths / 12);

  // Additions within the period, split by pool
  const additions = assets.filter((a) => {
    const acq = new Date(a.acquisition_date);
    return acq >= start && acq <= end;
  });

  const specialRateAIAEligible = additions.filter((a) => a.capital_allowance_pool === "Special Rate Pool - AIA Eligible");
  const mainPoolAIAEligible = additions.filter((a) => a.capital_allowance_pool === "Main Pool - AIA Eligible");
  const mainPoolCars = additions.filter((a) => a.capital_allowance_pool === "Main Pool - Car (not AIA eligible)");
  const specialRateCars = additions.filter((a) => a.capital_allowance_pool === "Special Rate Pool - Car (not AIA eligible)");
  const zeroEmissionCars = additions.filter((a) => a.capital_allowance_pool === "Zero Emission Car (100% FYA)");

  const sum = (list: any[]) => list.reduce((s, a) => s + Number(a.cost), 0);

  const specialRateAIAEligibleTotal = sum(specialRateAIAEligible);
  const mainPoolAIAEligibleTotal = sum(mainPoolAIAEligible);
  const mainPoolCarsTotal = sum(mainPoolCars);
  const specialRateCarsTotal = sum(specialRateCars);
  const zeroEmissionCarsTotal = sum(zeroEmissionCars);

  // Best practice: use AIA on special rate pool additions first (only 6% WDA otherwise), then main pool
  let aiaRemaining = aiaLimit;
  const aiaOnSpecialRate = Math.min(specialRateAIAEligibleTotal, aiaRemaining);
  aiaRemaining -= aiaOnSpecialRate;
  const aiaOnMainPool = Math.min(mainPoolAIAEligibleTotal, aiaRemaining);
  aiaRemaining -= aiaOnMainPool;

  const totalAIAClaimed = aiaOnSpecialRate + aiaOnMainPool;

  // Zero-emission cars: 100% First Year Allowance, uncapped, separate from AIA
  const totalFYA = zeroEmissionCarsTotal;

  // Remaining additions not covered by AIA enter the pools and attract WDA
  const mainPoolAdditionsAfterAIA = mainPoolAIAEligibleTotal - aiaOnMainPool;
  const specialRateAdditionsAfterAIA = specialRateAIAEligibleTotal - aiaOnSpecialRate;

  const mainPoolBalance = mainPoolBfwd + mainPoolAdditionsAfterAIA + mainPoolCarsTotal;
  const specialRateBalance = specialRatePoolBfwd + specialRateAdditionsAfterAIA + specialRateCarsTotal;

  const mainPoolWDA = mainPoolBalance * CA_RATES.mainPoolWDA;
  const specialRateWDA = specialRateBalance * CA_RATES.specialRatePoolWDA;

  const mainPoolClosingBalance = mainPoolBalance - mainPoolWDA;
  const specialRateClosingBalance = specialRateBalance - specialRateWDA;

  const totalCapitalAllowances = totalAIAClaimed + totalFYA + mainPoolWDA + specialRateWDA;

  return {
    periodMonths,
    aiaLimit,
    additions,
    specialRateAIAEligibleTotal,
    mainPoolAIAEligibleTotal,
    mainPoolCarsTotal,
    specialRateCarsTotal,
    zeroEmissionCarsTotal,
    aiaOnSpecialRate,
    aiaOnMainPool,
    totalAIAClaimed,
    totalFYA,
    mainPoolAdditionsAfterAIA,
    specialRateAdditionsAfterAIA,
    mainPoolBalance,
    specialRateBalance,
    mainPoolWDA,
    specialRateWDA,
    mainPoolClosingBalance,
    specialRateClosingBalance,
    totalCapitalAllowances,
  };
}

export default async function CapitalAllowancesPage({
  searchParams,
}: {
  searchParams: Promise<{
    client?: string;
    period_start?: string;
    period_end?: string;
    main_pool_bfwd?: string;
    special_rate_pool_bfwd?: string;
  }>;
}) {
  const {
    client: clientId,
    period_start,
    period_end,
    main_pool_bfwd,
    special_rate_pool_bfwd,
  } = await searchParams;

  const { data: clients } = await supabase
    .from("clients")
    .select("id, client_name")
    .order("client_name", { ascending: true });

  let result = null;
  let clientName = "";

  if (clientId && period_start && period_end) {
    const { data: assets } = await supabase
      .from("fixed_assets")
      .select("*")
      .eq("client_id", clientId);

    const { data: client } = await supabase
      .from("clients")
      .select("client_name")
      .eq("id", clientId)
      .single();

    clientName = client?.client_name || "";

    result = calculateCapitalAllowances({
      assets: assets || [],
      periodStart: period_start,
      periodEnd: period_end,
      mainPoolBfwd: parseFloat(main_pool_bfwd || "0") || 0,
      specialRatePoolBfwd: parseFloat(special_rate_pool_bfwd || "0") || 0,
    });
  }

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/fixed-assets" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Fixed Asset Register
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">Capital Allowances Summary</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Calculates AIA, Writing Down Allowances, and First Year Allowances for a chosen accounting period, using 2026/27 rates.
        </p>
      </div>

      <div className="p-8">
        {/* Period selection form */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Select Period</h2>
          <form method="get" className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
              <select name="client" required defaultValue={clientId || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="">Select a client</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Period Start *</label>
              <input name="period_start" type="date" required defaultValue={period_start || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Period End *</label>
              <input name="period_end" type="date" required defaultValue={period_end || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Main Pool Brought Forward (£)</label>
              <input name="main_pool_bfwd" type="number" step="0.01" min="0" defaultValue={main_pool_bfwd || "0"}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Special Rate Pool Brought Forward (£)</label>
              <input name="special_rate_pool_bfwd" type="number" step="0.01" min="0" defaultValue={special_rate_pool_bfwd || "0"}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div className="flex items-end">
              <button type="submit"
                className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Calculate
              </button>
            </div>
          </form>
        </div>

        {result && (
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">

              {/* Additions */}
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">
                  {clientName} — Additions in Period ({result.additions.length})
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Period length: {result.periodMonths} month{result.periodMonths !== 1 ? "s" : ""} · AIA limit for period: {fmt(result.aiaLimit)}
                </p>
                <div className="mt-4 space-y-2">
                  {result.additions.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-2">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{a.description}</p>
                        <p className="text-xs text-slate-400">{a.capital_allowance_pool}</p>
                      </div>
                      <p className="text-sm font-medium">{fmt(Number(a.cost))}</p>
                    </div>
                  ))}
                  {result.additions.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-4">No asset additions in this period.</p>
                  )}
                </div>
              </div>

              {/* AIA & FYA */}
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">Annual Investment Allowance & First Year Allowances</h2>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">AIA on Special Rate Pool additions (used first — lower WDA rate)</span><span className="font-medium">{fmt(result.aiaOnSpecialRate)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">AIA on Main Pool additions</span><span className="font-medium">{fmt(result.aiaOnMainPool)}</span></div>
                  <div className="flex justify-between font-bold border-t border-slate-100 pt-2"><span>Total AIA Claimed</span><span>{fmt(result.totalAIAClaimed)}</span></div>
                  <div className="flex justify-between mt-2"><span className="text-slate-500">100% FYA — Zero Emission Cars</span><span className="font-medium">{fmt(result.totalFYA)}</span></div>
                </div>
              </div>

              {/* WDA Pools */}
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">Writing Down Allowances</h2>
                <div className="mt-4 grid gap-6 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Main Pool (14%)</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-slate-500">Brought forward</span><span>{fmt(parseFloat(main_pool_bfwd || "0"))}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Additions not covered by AIA</span><span>{fmt(result.mainPoolAdditionsAfterAIA)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Cars (Main Pool)</span><span>{fmt(result.mainPoolCarsTotal)}</span></div>
                      <div className="flex justify-between font-medium border-t border-slate-100 pt-1"><span>Pool balance</span><span>{fmt(result.mainPoolBalance)}</span></div>
                      <div className="flex justify-between text-green-700 font-bold"><span>WDA claimed (14%)</span><span>{fmt(result.mainPoolWDA)}</span></div>
                      <div className="flex justify-between text-slate-500"><span>Closing balance (c/fwd)</span><span>{fmt(result.mainPoolClosingBalance)}</span></div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Special Rate Pool (6%)</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-slate-500">Brought forward</span><span>{fmt(parseFloat(special_rate_pool_bfwd || "0"))}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Additions not covered by AIA</span><span>{fmt(result.specialRateAdditionsAfterAIA)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Cars (Special Rate)</span><span>{fmt(result.specialRateCarsTotal)}</span></div>
                      <div className="flex justify-between font-medium border-t border-slate-100 pt-1"><span>Pool balance</span><span>{fmt(result.specialRateBalance)}</span></div>
                      <div className="flex justify-between text-green-700 font-bold"><span>WDA claimed (6%)</span><span>{fmt(result.specialRateWDA)}</span></div>
                      <div className="flex justify-between text-slate-500"><span>Closing balance (c/fwd)</span><span>{fmt(result.specialRateClosingBalance)}</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right - total */}
            <div className="space-y-6">
              <div className="rounded-2xl bg-slate-900 p-6 shadow-sm text-white">
                <h2 className="text-lg font-bold">Total Capital Allowances</h2>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-300">AIA</span><span>{fmt(result.totalAIAClaimed)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-300">First Year Allowance</span><span>{fmt(result.totalFYA)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-300">Main Pool WDA</span><span>{fmt(result.mainPoolWDA)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-300">Special Rate WDA</span><span>{fmt(result.specialRateWDA)}</span></div>
                  <div className="border-t border-slate-700 pt-2 flex justify-between font-bold text-base">
                    <span>Total Relief</span>
                    <span>{fmt(result.totalCapitalAllowances)}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
                <p className="text-xs text-yellow-800">
                  Uses 2026/27 rates: AIA £1,000,000 (pro-rated for the period), Main Pool WDA 14%, Special Rate Pool WDA 6%, and 100% FYA for zero-emission cars. Doesn't yet handle Full Expensing, the 40% FYA, disposals/balancing charges, or short-life asset elections. Brought-forward pool balances must be entered manually each period. Always verify before filing.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
