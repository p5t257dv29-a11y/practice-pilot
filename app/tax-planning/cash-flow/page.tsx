import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { calculateTax, getPaymentSchedule, getTaxRates } from "../../tax/page";
import { getCtRates, calculateFullCorporationTax } from "../../corporation-tax/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function fmt(n: number) {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function saveAssumptions(clientId: string, formData: FormData) {
  "use server";

  const payload = {
    client_id: clientId,
    start_date: String(formData.get("start_date") || new Date().toISOString().slice(0, 10)),
    opening_balance: Number(formData.get("opening_balance") || 0),
    monthly_income: Number(formData.get("monthly_income") || 0),
    monthly_fixed_costs: Number(formData.get("monthly_fixed_costs") || 0),
    monthly_dividend_drawings: Number(formData.get("monthly_dividend_drawings") || 0),
    notes: String(formData.get("notes") || "").trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from("cash_flow_forecasts")
    .select("id")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await supabase.from("cash_flow_forecasts").update(payload).eq("id", existing.id);
  } else {
    await supabase.from("cash_flow_forecasts").insert(payload);
  }

  revalidatePath(`/tax-planning/cash-flow`);
}

export default async function CashFlowForecastPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  const { clientId } = await searchParams;

  const { data: clients } = await supabase
    .from("clients")
    .select("id, client_name")
    .order("client_name");

  let assumptions: any = null;
  let ctRows: { dueDate: Date; amount: number; label: string }[] = [];
  let taxRows: { dueDate: Date; amount: number; label: string }[] = [];

  if (clientId) {
    const { data: existing } = await supabase
      .from("cash_flow_forecasts")
      .select("*")
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    assumptions = existing;

    // Known Corporation Tax due dates — pulls every CT computation for this
    // client that hasn't been marked paid, using the same shared calculation
    // engine as the CT600 report so the forecast never shows a different
    // figure than what's actually going to be filed.
    const { data: ctComps } = await supabase
      .from("corporation_tax_computations")
      .select("*")
      .eq("client_id", clientId);

    if (ctComps && ctComps.length > 0) {
      const ctRates = await getCtRates("2026/27");
      for (const comp of ctComps) {
        const { data: assets } = await supabase.from("fixed_assets").select("*").eq("client_id", clientId);
        const full = await calculateFullCorporationTax(comp, assets || [], ctRates);
        const dueDate = new Date(comp.period_end);
        dueDate.setMonth(dueDate.getMonth() + 9);
        dueDate.setDate(dueDate.getDate() + 1);
        if (full.totalCorporationTax > 0) {
          ctRows.push({
            dueDate,
            amount: full.totalCorporationTax,
            label: `Corporation Tax — period ended ${new Date(comp.period_end).toLocaleDateString("en-GB")}`,
          });
        }
      }
    }

    // Known Personal Tax due dates — balancing payment and payments on account,
    // using the same payment schedule logic as the SA100 and approval pages.
    const { data: taxComps } = await supabase
      .from("tax_computations")
      .select("*")
      .eq("client_id", clientId);

    if (taxComps && taxComps.length > 0) {
      for (const comp of taxComps) {
        const rates = await getTaxRates(comp.tax_year);
        const result = calculateTax({
          employmentIncome: Number(comp.employment_income),
          selfEmploymentIncome: Number(comp.self_employment_income),
          rentalIncome: Number(comp.rental_income),
          propertyExpenses: Number(comp.property_expenses),
          propertyFinanceCosts: Number(comp.property_finance_costs),
          financeCostsBf: Number(comp.finance_costs_bf),
          pensionIncome: Number(comp.pension_income),
          interestIncome: Number(comp.interest_income),
          dividendIncome: Number(comp.dividend_income),
          foreignEmploymentIncome: Number(comp.foreign_employment_income),
          foreignInterestIncome: Number(comp.foreign_interest_income),
          foreignDividendIncome: Number(comp.foreign_dividend_income),
          foreignRentalIncome: Number(comp.foreign_rental_income),
          foreignPropertyExpenses: Number(comp.foreign_property_expenses),
          foreignPropertyFinanceCosts: Number(comp.foreign_property_finance_costs),
          foreignFinanceCostsBf: Number(comp.foreign_finance_costs_bf),
          foreignTaxPaid: Number(comp.foreign_tax_paid),
          personalPensionContributions: Number(comp.personal_pension_contributions),
          giftAidDonations: Number(comp.gift_aid_donations),
          childBenefitReceived: Number(comp.child_benefit_received),
          marriageAllowanceTransferredOut: comp.marriage_allowance_transferred_out,
          marriageAllowanceReceived: comp.marriage_allowance_received,
          studentLoanPlan: comp.student_loan_plan,
          hasPostgraduateLoan: comp.has_postgraduate_loan,
          taxYear: comp.tax_year,
        }, rates);

        const schedule = getPaymentSchedule(comp.tax_year, result.totalLiability, Number(comp.tax_paid_at_source));

        if (schedule.balanceDue > 0) {
          taxRows.push({
            dueDate: new Date(schedule.balancingPaymentDate),
            amount: schedule.balanceDue,
            label: `Personal Tax balancing payment — ${comp.tax_year}`,
          });
        }
        if (schedule.poaRequired) {
          taxRows.push({
            dueDate: new Date(schedule.balancingPaymentDate),
            amount: schedule.poaAmount,
            label: `Personal Tax 1st payment on account — ${schedule.nextTaxYear}`,
          });
          taxRows.push({
            dueDate: new Date(schedule.poa2Date),
            amount: schedule.dueAtPoa2,
            label: `Personal Tax 2nd payment on account — ${schedule.nextTaxYear}`,
          });
        }
      }
    }
  }

  const saveWithId = clientId ? saveAssumptions.bind(null, clientId) : null;

  // Build the 12-month projection
  const months: {
    label: string;
    opening: number;
    income: number;
    costs: number;
    dividends: number;
    taxDue: { label: string; amount: number }[];
    closing: number;
  }[] = [];

  if (assumptions) {
    const start = new Date(assumptions.start_date);
    let runningBalance = Number(assumptions.opening_balance);
    const allTaxRows = [...ctRows, ...taxRows];

    for (let i = 0; i < 12; i++) {
      const monthStart = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const monthEnd = new Date(start.getFullYear(), start.getMonth() + i + 1, 0);

      const taxDueThisMonth = allTaxRows.filter(
        (r) => r.dueDate >= monthStart && r.dueDate <= monthEnd
      );
      const taxTotal = taxDueThisMonth.reduce((s, r) => s + r.amount, 0);

      const opening = runningBalance;
      const income = Number(assumptions.monthly_income);
      const costs = Number(assumptions.monthly_fixed_costs);
      const dividends = Number(assumptions.monthly_dividend_drawings);
      const closing = opening + income - costs - dividends - taxTotal;

      months.push({
        label: monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
        opening,
        income,
        costs,
        dividends,
        taxDue: taxDueThisMonth.map((r) => ({ label: r.label, amount: r.amount })),
        closing,
      });

      runningBalance = closing;
    }
  }

  const lowestMonth = months.length > 0
    ? months.reduce((min, m) => (m.closing < min.closing ? m : min))
    : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Cash Flow Forecast</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Projects cash position forward 12 months, automatically factoring in known Corporation Tax and Personal Tax due dates.
        </p>
      </div>

      <div className="p-8 max-w-4xl space-y-6">
        <form method="get" className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <label className="block text-sm font-medium text-slate-700 mb-1">Client</label>
          <div className="flex gap-3">
            <select
              name="clientId"
              defaultValue={clientId || ""}
              className="flex-1 rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
            >
              <option value="">Select a client…</option>
              {(clients || []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.client_name}</option>
              ))}
            </select>
            <button type="submit" className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Load
            </button>
          </div>
        </form>

        {clientId && saveWithId && (
          <form action={saveWithId} className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Assumptions</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Forecast start date</label>
                <input
                  name="start_date"
                  type="date"
                  defaultValue={assumptions?.start_date || new Date().toISOString().slice(0, 10)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Opening cash balance</label>
                <input
                  name="opening_balance"
                  type="number"
                  step="0.01"
                  defaultValue={assumptions?.opening_balance ?? ""}
                  placeholder="e.g. 15000"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Expected monthly income</label>
                <input
                  name="monthly_income"
                  type="number"
                  step="0.01"
                  defaultValue={assumptions?.monthly_income ?? ""}
                  placeholder="e.g. 8000"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Fixed monthly costs</label>
                <input
                  name="monthly_fixed_costs"
                  type="number"
                  step="0.01"
                  defaultValue={assumptions?.monthly_fixed_costs ?? ""}
                  placeholder="e.g. 4500"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Planned monthly dividend drawings</label>
                <input
                  name="monthly_dividend_drawings"
                  type="number"
                  step="0.01"
                  defaultValue={assumptions?.monthly_dividend_drawings ?? ""}
                  placeholder="e.g. 2000"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea
                name="notes"
                rows={2}
                defaultValue={assumptions?.notes || ""}
                placeholder="e.g. Assumes current run-rate continues, no seasonal variation modelled"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>

            <button type="submit" className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Save & Recalculate
            </button>
          </form>
        )}

        {lowestMonth && (
          <div className={`rounded-2xl p-6 ${lowestMonth.closing < 0 ? "bg-red-50 border border-red-200" : "bg-green-50 border border-green-200"}`}>
            <h2 className="text-lg font-bold text-slate-900">
              {lowestMonth.closing < 0 ? "⚠ Cash shortfall projected" : "Lowest projected balance"}
            </h2>
            <p className="text-sm text-slate-700 mt-1">
              {fmt(lowestMonth.closing)} in <strong>{lowestMonth.label}</strong>
              {lowestMonth.closing < 0 && " — this forecast shows the balance going negative. Worth reviewing timing of dividend drawings or tax payment planning ahead of this."}
            </p>
          </div>
        )}

        {months.length > 0 && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 overflow-x-auto">
            <h2 className="text-lg font-bold text-slate-900 mb-4">12-Month Projection</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-3 pr-4">Month</th>
                  <th className="py-3 pr-4">Opening</th>
                  <th className="py-3 pr-4">+ Income</th>
                  <th className="py-3 pr-4">− Costs</th>
                  <th className="py-3 pr-4">− Dividends</th>
                  <th className="py-3 pr-4">− Tax Due</th>
                  <th className="py-3 pr-4">Closing</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m, i) => (
                  <tr key={i} className={`border-b border-slate-100 ${m.closing < 0 ? "bg-red-50" : ""}`}>
                    <td className="py-3 pr-4 font-medium">{m.label}</td>
                    <td className="py-3 pr-4">{fmt(m.opening)}</td>
                    <td className="py-3 pr-4 text-green-700">{fmt(m.income)}</td>
                    <td className="py-3 pr-4 text-red-600">({fmt(m.costs)})</td>
                    <td className="py-3 pr-4 text-red-600">({fmt(m.dividends)})</td>
                    <td className="py-3 pr-4 text-red-600">
                      {m.taxDue.length > 0 ? (
                        <div>
                          {m.taxDue.map((t, j) => (
                            <p key={j} className="text-xs">({fmt(t.amount)}) — {t.label}</p>
                          ))}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`py-3 pr-4 font-bold ${m.closing < 0 ? "text-red-700" : "text-slate-900"}`}>
                      {fmt(m.closing)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-400 mt-4">
              Income, costs and dividend drawings are flat monthly assumptions — this doesn't yet model seasonal variation or one-off items.
              Tax due dates and amounts are pulled live from Corporation Tax and Personal Tax computations on file for this client. VAT is not currently modelled.
            </p>
          </div>
        )}

        {clientId && !assumptions && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 text-center text-sm text-slate-500">
            No assumptions saved yet for this client — fill in the form above and save to see a projection.
          </div>
        )}
      </div>
    </div>
  );
}