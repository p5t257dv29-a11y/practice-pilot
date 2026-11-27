import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type ScenarioKey = "base" | "upside" | "downside";

interface CashFlowItem {
  id: string;
  forecast_id: string;
  month_index: number;
  title: string;
  category: string;
  amount: number;
  enabled_base: boolean;
  enabled_upside: boolean;
  enabled_downside: boolean;
}

interface MonthRow {
  monthIndex: number;
  label: string;
  monthNumber: number;
  opening: number;
  income: number;
  costs: number;
  payroll: number;
  dividends: number;
  vatDue: number;
  taxDue: number;
  oneOffs: number;
  closing: number;
}

function formatGbp(value: number) {
  const abs = Math.abs(Number(value || 0)).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `−£${abs}` : `£${abs}`;
}

function addMonthsToDate(startIso: string, monthOffset: number) {
  const base = new Date(`${startIso}T00:00:00`);
  const d = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const label = d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const monthNumber = d.getMonth() + 1; // 1..12
  const year = d.getFullYear();
  const monthKey = `${year}-${String(monthNumber).padStart(2, "0")}`;
  return { label, monthNumber, monthKey };
}

function parseWeights(raw: unknown): number[] {
  if (Array.isArray(raw) && raw.length === 12) {
    return raw.map((n) => {
      const parsed = Number(n);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
    });
  }
  return Array(12).fill(1);
}

function parseQuarterEndMonths(raw: unknown): number[] {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((n) => Number(n)).filter((n) => n >= 1 && n <= 12);
  }
  return [3, 6, 9, 12];
}

// VAT payment is typically due 1 calendar month + 7 days after quarter end,
// which lands in the month following the quarter end + 1 month (e.g. Q1 ends Mar -> due May).
function getVatPaymentMonth(quarterEndMonth: number): number {
  return ((quarterEndMonth + 1) % 12) + 1;
}

async function saveAssumptionsAction(formData: FormData) {
  "use server";

  const get = (k: string) => String(formData.get(k) || "").trim();
  const clientId = get("client_id");
  if (!clientId) return;

  const forecastId = get("forecast_id") || null;
  const activeScenario = (get("active_scenario") || "base") as ScenarioKey;
  const startDate = get("forecast_start_date") || new Date().toISOString().split("T")[0];
  const openingCash = parseFloat(get("opening_cash_balance")) || 0;
  const monthlyIncome = parseFloat(get("expected_monthly_income")) || 0;
  const fixedCosts = parseFloat(get("fixed_monthly_costs")) || 0;
  const monthlyDividends = parseFloat(get("planned_monthly_dividend_drawings")) || 0;
  const monthlyPayroll = parseFloat(get("monthly_payroll")) || 0;
  const minCashBuffer = parseFloat(get("min_cash_buffer")) || 0;

  const upsideIncomePct = parseFloat(get("upside_income_pct")) || 0;
  const upsideCostPct = parseFloat(get("upside_cost_pct")) || 0;
  const downsideIncomePct = parseFloat(get("downside_income_pct")) || 0;
  const downsideCostPct = parseFloat(get("downside_cost_pct")) || 0;

  const vatEnabled = formData.get("vat_enabled") === "on";
  const quarterlyVatEstimate = parseFloat(get("quarterly_vat_estimate")) || 0;
  const stagger = get("vat_stagger") || "3-6-9-12";
  const vatQuarterEndMonths = stagger.split("-").map((s) => parseInt(s, 10)).filter(Boolean);

  const seasonalWeights = Array.from({ length: 12 }, (_, idx) => {
    const val = parseFloat(get(`season_${idx}`));
    return Number.isFinite(val) && val >= 0 ? val / 100 : 1;
  });

  const payload = {
    client_id: clientId,
    active_scenario: activeScenario,
    forecast_start_date: startDate,
    opening_cash_balance: openingCash,
    expected_monthly_income: monthlyIncome,
    fixed_monthly_costs: fixedCosts,
    planned_monthly_dividend_drawings: monthlyDividends,
    monthly_payroll: monthlyPayroll,
    min_cash_buffer: minCashBuffer,
    upside_income_pct: upsideIncomePct,
    upside_cost_pct: upsideCostPct,
    downside_income_pct: downsideIncomePct,
    downside_cost_pct: downsideCostPct,
    vat_enabled: vatEnabled,
    quarterly_vat_estimate: quarterlyVatEstimate,
    vat_quarter_end_months: vatQuarterEndMonths,
    seasonal_weights: seasonalWeights,
    notes: get("notes") || null,
  };

  if (forecastId) {
    await supabase.from("cash_flow_forecasts").update(payload).eq("id", forecastId);
  } else {
    await supabase.from("cash_flow_forecasts").insert(payload);
  }

  revalidatePath("/cash-flow");
}

async function addMicroforecastAction(formData: FormData) {
  "use server";

  const get = (k: string) => String(formData.get(k) || "").trim();
  const forecastId = get("forecast_id");
  const title = get("title");
  const category = get("category") || "Microforecast";
  const monthIndex = Math.min(11, Math.max(0, parseInt(get("month_index"), 10) || 0));
  const amount = parseFloat(get("amount")) || 0;

  if (!forecastId || !title || amount === 0) return;

  await supabase.from("cash_flow_items").insert({
    forecast_id: forecastId,
    title,
    category,
    month_index: monthIndex,
    amount,
    enabled_base: true,
    enabled_upside: true,
    enabled_downside: true,
  });

  revalidatePath("/cash-flow");
}

async function toggleMicroforecastScenarioAction(
  itemId: string,
  scenario: ScenarioKey,
  currentValue: boolean
) {
  "use server";

  const column =
    scenario === "upside"
      ? "enabled_upside"
      : scenario === "downside"
      ? "enabled_downside"
      : "enabled_base";

  await supabase.from("cash_flow_items").update({ [column]: !currentValue }).eq("id", itemId);
  revalidatePath("/cash-flow");
}

async function deleteMicroforecastAction(itemId: string) {
  "use server";
  await supabase.from("cash_flow_items").delete().eq("id", itemId);
  revalidatePath("/cash-flow");
}

async function setScenarioAction(forecastId: string, scenario: ScenarioKey) {
  "use server";
  if (!forecastId) return;
  await supabase
    .from("cash_flow_forecasts")
    .update({ active_scenario: scenario })
    .eq("id", forecastId);
  revalidatePath("/cash-flow");
}

export default async function CashFlowForecastPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; scenario?: string }>;
}) {
  const { client: selectedClientParam, scenario: scenarioParam } = await searchParams;

  const { data: clients } = await supabase
    .from("clients")
    .select("id, client_name")
    .order("client_name", { ascending: true });

  const activeClientId = selectedClientParam || clients?.[0]?.id || "";

  const { data: forecast } = activeClientId
    ? await supabase
        .from("cash_flow_forecasts")
        .select("*")
        .eq("client_id", activeClientId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const activeScenario: ScenarioKey =
    scenarioParam === "upside" || scenarioParam === "downside" || scenarioParam === "base"
      ? scenarioParam
      : forecast?.active_scenario === "upside" || forecast?.active_scenario === "downside"
      ? forecast.active_scenario
      : "base";

  const [itemsRes, ctRes, saRes] = await Promise.all([
    forecast?.id
      ? supabase
          .from("cash_flow_items")
          .select("*")
          .eq("forecast_id", forecast.id)
          .order("month_index", { ascending: true })
      : Promise.resolve({ data: [] as CashFlowItem[] }),
    activeClientId
      ? supabase.from("corporation_tax_computations").select("*").eq("client_id", activeClientId)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    activeClientId
      ? supabase.from("tax_computations").select("*").eq("client_id", activeClientId)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const items: CashFlowItem[] = (itemsRes.data || []) as CashFlowItem[];

  // Build map of YYYY-MM -> tax due amount from CT & Personal Tax computations
  const taxByMonth = new Map<string, number>();
  const addTaxRecord = (row: Record<string, unknown>) => {
    const rawDate = String(
      row.due_date || row.payment_due_date || row.tax_due_date || row.created_at || ""
    );
    const rawAmount = Number(
      row.tax_payable ?? row.ct_payable ?? row.total_tax ?? row.amount ?? row.liability ?? 0
    );
    if (rawDate.length >= 7 && Number.isFinite(rawAmount) && rawAmount > 0) {
      const key = rawDate.slice(0, 7);
      taxByMonth.set(key, (taxByMonth.get(key) || 0) + rawAmount);
    }
  };

  for (const r of ctRes.data || []) addTaxRecord(r as Record<string, unknown>);
  for (const r of saRes.data || []) addTaxRecord(r as Record<string, unknown>);

  const startDate =
    forecast?.forecast_start_date || new Date().toISOString().split("T")[0];
  const openingCash = Number(forecast?.opening_cash_balance ?? 1000);
  const baseMonthlyIncome = Number(forecast?.expected_monthly_income ?? 500);
  const baseFixedCosts = Number(forecast?.fixed_monthly_costs ?? 125);
  const monthlyDividends = Number(forecast?.planned_monthly_dividend_drawings ?? 250);
  const monthlyPayroll = Number(forecast?.monthly_payroll ?? 0);
  const minCashBuffer = Number(forecast?.min_cash_buffer ?? 1000);

  const upsideIncomePct = Number(forecast?.upside_income_pct ?? 15);
  const upsideCostPct = Number(forecast?.upside_cost_pct ?? 0);
  const downsideIncomePct = Number(forecast?.downside_income_pct ?? -15);
  const downsideCostPct = Number(forecast?.downside_cost_pct ?? 10);

  const incomeMult =
    activeScenario === "upside"
      ? 1 + upsideIncomePct / 100
      : activeScenario === "downside"
      ? 1 + downsideIncomePct / 100
      : 1;

  const costMult =
    activeScenario === "upside"
      ? 1 + upsideCostPct / 100
      : activeScenario === "downside"
      ? 1 + downsideCostPct / 100
      : 1;

  const seasonalWeights = parseWeights(forecast?.seasonal_weights);
  const vatEnabled = Boolean(forecast?.vat_enabled);
  const quarterlyVatEstimate = Number(forecast?.quarterly_vat_estimate ?? 0);
  const vatPaymentMonths = new Set(
    parseQuarterEndMonths(forecast?.vat_quarter_end_months).map(getVatPaymentMonth)
  );

  const rows: MonthRow[] = [];
  let runningCash = openingCash;

  for (let i = 0; i < 12; i++) {
    const { label, monthNumber, monthKey } = addMonthsToDate(startDate, i);
    const weight = seasonalWeights[i] ?? 1;

    const income = baseMonthlyIncome * weight * incomeMult;
    const costs = baseFixedCosts * weight * costMult;
    const payroll = monthlyPayroll;
    const dividends = monthlyDividends;
    const vatDue = vatEnabled && vatPaymentMonths.has(monthNumber) ? quarterlyVatEstimate : 0;
    const taxDue = taxByMonth.get(monthKey) || 0;

    const monthItems = items.filter((item) => {
      if (item.month_index !== i) return false;
      if (activeScenario === "upside") return item.enabled_upside !== false;
      if (activeScenario === "downside") return item.enabled_downside !== false;
      return item.enabled_base !== false;
    });

    const oneOffs = monthItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const opening = runningCash;
    const closing = opening + income - costs - payroll - dividends - vatDue - taxDue + oneOffs;

    rows.push({
      monthIndex: i,
      label,
      monthNumber,
      opening,
      income,
      costs,
      payroll,
      dividends,
      vatDue,
      taxDue,
      oneOffs,
      closing,
    });

    runningCash = closing;
  }

  const lowestRow = rows.reduce((min, r) => (r.closing < min.closing ? r : min), rows[0]);
  const finalRow = rows[rows.length - 1];
  const breachCount = rows.filter((r) => r.closing < minCashBuffer).length;
  const maxAbsClosing = Math.max(
    1,
    ...rows.map((r) => Math.abs(r.closing)),
    Math.abs(minCashBuffer)
  );

  return (
    <div className="min-h-screen bg-slate-50 p-8 space-y-6">
      {/* Header & Scenario Switcher */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
            Advisory Projections
          </span>
          <h1 className="text-3xl font-bold text-slate-900 mt-0.5">
            Cash Flow Forecast
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            12-month cash projection with scenarios, microforecasts, seasonality, VAT &amp; payroll timing, and live CT / Personal Tax due dates.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(["base", "upside", "downside"] as ScenarioKey[]).map((sc) => {
            const isActive = activeScenario === sc;
            const labelMap: Record<ScenarioKey, string> = {
              base: "Base Case",
              upside: "Upside",
              downside: "Downside",
            };
            return forecast?.id ? (
              <form key={sc} action={setScenarioAction.bind(null, forecast.id, sc)}>
                <button
                  type="submit"
                  className={`rounded-xl px-4 py-2 text-xs font-semibold border transition-colors ${
                    isActive
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {labelMap[sc]}
                </button>
              </form>
            ) : (
              <a
                key={sc}
                href={`/cash-flow?client=${activeClientId}&scenario=${sc}`}
                className={`rounded-xl px-4 py-2 text-xs font-semibold border transition-colors ${
                  isActive
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {labelMap[sc]}
              </a>
            );
          })}
        </div>
      </div>

      {/* Client Selector */}
      <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100 flex flex-wrap items-center justify-between gap-4">
        <form method="GET" action="/cash-flow" className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-slate-700">Client</label>
          <select
            name="client"
            defaultValue={activeClientId}
            className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm bg-white"
          >
            {(clients || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.client_name}
              </option>
            ))}
          </select>
          <input type="hidden" name="scenario" value={activeScenario} />
          <button
            type="submit"
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
          >
            Load
          </button>
        </form>

        <div className="text-xs text-slate-500">
          Active Scenario: <span className="font-semibold text-slate-800 uppercase">{activeScenario}</span>
          {" · "}
          Minimum Buffer: <span className="font-semibold text-slate-800">{formatGbp(minCashBuffer)}</span>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
          <p className="text-xs font-medium text-slate-500">Lowest Projected Balance</p>
          <p className={`text-2xl font-bold mt-1 ${lowestRow.closing < 0 ? "text-red-600" : lowestRow.closing < minCashBuffer ? "text-amber-600" : "text-slate-900"}`}>
            {formatGbp(lowestRow.closing)}
          </p>
          <p className="text-xs text-slate-400 mt-1">In {lowestRow.label}</p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
          <p className="text-xs font-medium text-slate-500">12-Month Closing Cash</p>
          <p className={`text-2xl font-bold mt-1 ${finalRow.closing < 0 ? "text-red-600" : "text-emerald-700"}`}>
            {formatGbp(finalRow.closing)}
          </p>
          <p className="text-xs text-slate-400 mt-1">After {rows[rows.length - 1]?.label}</p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
          <p className="text-xs font-medium text-slate-500">Buffer Warnings</p>
          <p className={`text-2xl font-bold mt-1 ${breachCount > 0 ? "text-amber-600" : "text-slate-900"}`}>
            {breachCount} {breachCount === 1 ? "month" : "months"}
          </p>
          <p className="text-xs text-slate-400 mt-1">Below {formatGbp(minCashBuffer)} target</p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
          <p className="text-xs font-medium text-slate-500">Scheduled Tax &amp; VAT Outflows</p>
          <p className="text-2xl font-bold mt-1 text-slate-900">
            {formatGbp(rows.reduce((sum, r) => sum + r.taxDue + r.vatDue, 0))}
          </p>
          <p className="text-xs text-slate-400 mt-1">Across next 12 months</p>
        </div>
      </div>

      {/* Visual Cash Trajectory */}
      <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Closing Cash Trajectory</h2>
            <p className="text-xs text-slate-500">
              Amber indicates closing cash below your {formatGbp(minCashBuffer)} buffer; red indicates negative cash.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-2 items-end h-44 pt-6 border-b border-slate-100 pb-2">
          {rows.map((r) => {
            const heightPct = Math.max(6, Math.round((Math.abs(r.closing) / maxAbsClosing) * 100));
            const barColor =
              r.closing < 0
                ? "bg-red-500"
                : r.closing < minCashBuffer
                ? "bg-amber-400"
                : "bg-indigo-600";

            return (
              <div key={r.monthIndex} className="flex flex-col items-center h-full justify-end group">
                <span className="text-[10px] font-semibold text-slate-600 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  £{Math.round(r.closing).toLocaleString("en-GB")}
                </span>
                <div
                  className={`w-full max-w-[34px] rounded-t-lg ${barColor} transition-all`}
                  style={{ height: `${heightPct}%` }}
                  title={`${r.label}: ${formatGbp(r.closing)}`}
                />
                <span className="text-[10px] text-slate-500 mt-2 truncate w-full text-center">
                  {r.label.slice(0, 3)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 12-Month Projection Table */}
      <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 overflow-x-auto">
        <h2 className="text-lg font-bold text-slate-900 mb-4">12-Month Projection</h2>
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2.5 pr-3">Month</th>
              <th className="py-2.5 px-2 text-right">Opening</th>
              <th className="py-2.5 px-2 text-right">+ Income</th>
              <th className="py-2.5 px-2 text-right">− Costs</th>
              <th className="py-2.5 px-2 text-right">− Payroll</th>
              <th className="py-2.5 px-2 text-right">− Dividends</th>
              <th className="py-2.5 px-2 text-right">− VAT</th>
              <th className="py-2.5 px-2 text-right">− Tax Due</th>
              <th className="py-2.5 px-2 text-right">± One-Offs</th>
              <th className="py-2.5 pl-2 text-right">Closing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const isBelowBuffer = r.closing < minCashBuffer;
              const isNegative = r.closing < 0;
              return (
                <tr
                  key={r.monthIndex}
                  className={isNegative ? "bg-red-50/50" : isBelowBuffer ? "bg-amber-50/40" : ""}
                >
                  <td className="py-2.5 pr-3 font-semibold text-slate-800 whitespace-nowrap">{r.label}</td>
                  <td className="py-2.5 px-2 text-right text-slate-600">{formatGbp(r.opening)}</td>
                  <td className="py-2.5 px-2 text-right text-emerald-700 font-medium">{formatGbp(r.income)}</td>
                  <td className="py-2.5 px-2 text-right text-slate-600">({formatGbp(r.costs)})</td>
                  <td className="py-2.5 px-2 text-right text-slate-600">
                    {r.payroll > 0 ? `(${formatGbp(r.payroll)})` : "—"}
                  </td>
                  <td className="py-2.5 px-2 text-right text-slate-600">
                    {r.dividends > 0 ? `(${formatGbp(r.dividends)})` : "—"}
                  </td>
                  <td className="py-2.5 px-2 text-right text-slate-600">
                    {r.vatDue > 0 ? `(${formatGbp(r.vatDue)})` : "—"}
                  </td>
                  <td className="py-2.5 px-2 text-right text-rose-700 font-medium">
                    {r.taxDue > 0 ? `(${formatGbp(r.taxDue)})` : "—"}
                  </td>
                  <td className={`py-2.5 px-2 text-right font-medium ${r.oneOffs > 0 ? "text-emerald-700" : r.oneOffs < 0 ? "text-rose-700" : "text-slate-400"}`}>
                    {r.oneOffs !== 0 ? formatGbp(r.oneOffs) : "—"}
                  </td>
                  <td className={`py-2.5 pl-2 text-right font-bold ${isNegative ? "text-red-600" : isBelowBuffer ? "text-amber-700" : "text-slate-900"}`}>
                    {formatGbp(r.closing)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Microforecasts / One-Off Cash Events */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Microforecasts &amp; One-Off Cash Items</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Model discrete hires, equipment buys, tax refunds, or lump-sum dividends and toggle them per scenario.
          </p>

          {forecast?.id ? (
            <>
              <form action={addMicroforecastAction} className="mt-4 grid gap-3 sm:grid-cols-5">
                <input type="hidden" name="forecast_id" value={forecast.id} />
                <input
                  name="title"
                  required
                  placeholder="e.g. New hire / Laptop / Tax refund"
                  className="sm:col-span-2 rounded-xl border border-slate-200 px-3 py-2 text-xs"
                />
                <select name="month_index" defaultValue="0" className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
                  {rows.map((r) => (
                    <option key={r.monthIndex} value={r.monthIndex}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  required
                  placeholder="-1200 or +2500"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
                >
                  + Add Event
                </button>
              </form>

              <div className="mt-4 space-y-2">
                {items.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    No microforecasts or one-off items added yet.
                  </p>
                ) : (
                  items.map((item) => {
                    const monthLabel = rows[item.month_index]?.label || `Month ${item.month_index + 1}`;
                    const enabledForCurrent =
                      activeScenario === "upside"
                        ? item.enabled_upside !== false
                        : activeScenario === "downside"
                        ? item.enabled_downside !== false
                        : item.enabled_base !== false;

                    return (
                      <div
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"
                      >
                        <div>
                          <p className="text-xs font-semibold text-slate-900">{item.title}</p>
                          <p className="text-[11px] text-slate-500">
                            {monthLabel} ·{" "}
                            <span className={Number(item.amount) >= 0 ? "text-emerald-700 font-semibold" : "text-rose-700 font-semibold"}>
                              {formatGbp(Number(item.amount))}
                            </span>
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <form
                            action={toggleMicroforecastScenarioAction.bind(
                              null,
                              item.id,
                              activeScenario,
                              enabledForCurrent
                            )}
                          >
                            <button
                              type="submit"
                              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border ${
                                enabledForCurrent
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-slate-100 text-slate-500 border-slate-200"
                              }`}
                            >
                              {enabledForCurrent ? `On (${activeScenario})` : `Off (${activeScenario})`}
                            </button>
                          </form>

                          <form action={deleteMicroforecastAction.bind(null, item.id)}>
                            <button
                              type="submit"
                              className="rounded-lg bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100"
                            >
                              Remove
                            </button>
                          </form>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-400 mt-4">
              Save initial forecast assumptions first to attach microforecasts.
            </p>
          )}
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Scenario Drivers</h3>
          <p className="text-xs text-slate-500">
            Adjust percentage shifts applied to base monthly income and fixed costs in Upside and Downside views.
          </p>
          <div className="rounded-xl bg-slate-50 p-3 text-xs space-y-1">
            <p className="font-semibold text-slate-800">Upside</p>
            <p className="text-slate-600">Income: {upsideIncomePct >= 0 ? `+${upsideIncomePct}%` : `${upsideIncomePct}%`} · Costs: {upsideCostPct >= 0 ? `+${upsideCostPct}%` : `${upsideCostPct}%`}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-xs space-y-1">
            <p className="font-semibold text-slate-800">Downside</p>
            <p className="text-slate-600">Income: {downsideIncomePct >= 0 ? `+${downsideIncomePct}%` : `${downsideIncomePct}%`} · Costs: {downsideCostPct >= 0 ? `+${downsideCostPct}%` : `${downsideCostPct}%`}</p>
          </div>
        </div>
      </div>

      {/* Assumptions, VAT/Payroll & Seasonality Form */}
      <form action={saveAssumptionsAction} className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 space-y-6">
        <input type="hidden" name="client_id" value={activeClientId} />
        <input type="hidden" name="forecast_id" value={forecast?.id || ""} />
        <input type="hidden" name="active_scenario" value={activeScenario} />

        <div>
          <h2 className="text-lg font-bold text-slate-900">Assumptions &amp; Cash Drivers</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Forecast Start Date</label>
              <input name="forecast_start_date" type="date" defaultValue={startDate} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Opening Cash Balance (£)</label>
              <input name="opening_cash_balance" type="number" step="0.01" defaultValue={openingCash} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Expected Monthly Income (£)</label>
              <input name="expected_monthly_income" type="number" step="0.01" defaultValue={baseMonthlyIncome} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Fixed Monthly Costs (£)</label>
              <input name="fixed_monthly_costs" type="number" step="0.01" defaultValue={baseFixedCosts} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Planned Monthly Dividends (£)</label>
              <input name="planned_monthly_dividend_drawings" type="number" step="0.01" defaultValue={monthlyDividends} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Monthly Payroll / PAYE (£)</label>
              <input name="monthly_payroll" type="number" step="0.01" defaultValue={monthlyPayroll} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Minimum Cash Buffer (£)</label>
              <input name="min_cash_buffer" type="number" step="0.01" defaultValue={minCashBuffer} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
              <input name="notes" defaultValue={forecast?.notes || ""} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
            </div>
          </div>
        </div>

        {/* VAT & Scenario Percentages */}
        <div className="border-t border-slate-100 pt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 sm:col-span-2">
            <input type="checkbox" name="vat_enabled" defaultChecked={vatEnabled} className="h-4 w-4 rounded border-slate-300" />
            <span>Model Quarterly VAT Cash Outflows</span>
          </label>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Est. Quarterly VAT (£)</label>
            <input name="quarterly_vat_estimate" type="number" step="0.01" defaultValue={quarterlyVatEstimate} className="w-full rounded-xl border border-slate-200 p-2 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">VAT Stagger</label>
            <select name="vat_stagger" defaultValue="3-6-9-12" className="w-full rounded-xl border border-slate-200 p-2 text-xs">
              <option value="3-6-9-12">Mar / Jun / Sep / Dec</option>
              <option value="1-4-7-10">Jan / Apr / Jul / Oct</option>
              <option value="2-5-8-11">Feb / May / Aug / Nov</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Upside Income %</label>
            <input name="upside_income_pct" type="number" step="1" defaultValue={upsideIncomePct} className="w-full rounded-xl border border-slate-200 p-2 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Downside Income %</label>
            <input name="downside_income_pct" type="number" step="1" defaultValue={downsideIncomePct} className="w-full rounded-xl border border-slate-200 p-2 text-xs" />
          </div>
          <input type="hidden" name="upside_cost_pct" value={upsideCostPct} />
          <input type="hidden" name="downside_cost_pct" value={downsideCostPct} />
        </div>

        {/* 12-Month Seasonality Weights */}
        <div className="border-t border-slate-100 pt-5">
          <h3 className="text-sm font-bold text-slate-900 mb-2">Monthly Seasonality Weight (%)</h3>
          <p className="text-xs text-slate-500 mb-3">100% is flat baseline; e.g. 120% models a busy month, 80% a quieter month.</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2">
            {rows.map((r) => (
              <div key={r.monthIndex}>
                <label className="block text-[11px] text-slate-500 mb-1">{r.label.slice(0, 3)}</label>
                <input
                  name={`season_${r.monthIndex}`}
                  type="number"
                  step="5"
                  min="0"
                  defaultValue={Math.round((seasonalWeights[r.monthIndex] ?? 1) * 100)}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                />
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
        >
          Save &amp; Recalculate
        </button>
      </form>
    </div>
  );
}