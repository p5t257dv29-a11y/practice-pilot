import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { calculateCorporationTax, applyLossRelief } from "../../corporation-tax/page";
import { calculateCapitalAllowances } from "../../fixed-assets/capital-allowances/page";
import { calculateS455 } from "../../directors-loan-account/page";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function approveComputation(token: string) {
  "use server";
  await supabase
    .from("corporation_tax_computations")
    .update({ status: "Approved", approved_at: new Date().toISOString() })
    .eq("token", token);
  revalidatePath(`/ct/${token}`);
}

async function queryComputation(token: string) {
  "use server";
  await supabase
    .from("corporation_tax_computations")
    .update({ status: "Queried", queried_at: new Date().toISOString() })
    .eq("token", token);
  revalidatePath(`/ct/${token}`);
}

export default async function PublicCTPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const { data: comp, error } = await supabase
    .from("corporation_tax_computations")
    .select("*, clients(client_name)")
    .eq("token", token)
    .single();

  if (error || !comp) notFound();

  const approveWithToken = approveComputation.bind(null, token);
  const queryWithToken = queryComputation.bind(null, token);

  const isApproved = comp.status === "Approved";
  const isQueried = comp.status === "Queried";
  const isResponded = isApproved || isQueried;

  const { data: assets } = await supabase.from("fixed_assets").select("*").eq("client_id", comp.client_id);
  const ca = calculateCapitalAllowances({
    assets: assets || [],
    periodStart: comp.period_start,
    periodEnd: comp.period_end,
    mainPoolBfwd: Number(comp.main_pool_bfwd),
    specialRatePoolBfwd: Number(comp.special_rate_pool_bfwd),
    jobId: comp.job_id,
  });
  const taxableProfitBeforeLosses =
    Number(comp.accounting_profit) + Number(comp.depreciation_addback) + Number(comp.disallowable_expenses) -
    ca.totalCapitalAllowances - Number(comp.other_allowable_deductions);
  const loss = applyLossRelief(taxableProfitBeforeLosses, Number(comp.brought_forward_losses));
  const ct = calculateCorporationTax({
    taxableProfit: loss.taxableProfitAfterLosses,
    periodStart: comp.period_start,
    periodEnd: comp.period_end,
    associatedCompanies: comp.associated_companies,
  });

  const { data: linkedDLAs } = await supabase.from("directors_loan_accounts").select("*").eq("corporation_tax_id", comp.id);
  const dlaResults = (linkedDLAs || []).map((dla) => ({
    dla,
    result: calculateS455({
      closingBalance: Number(dla.closing_balance),
      periodEnd: dla.period_end,
      repaidByDueDate: dla.repaid_by_due_date,
      s455Rate: Number(dla.s455_rate),
    }),
  }));
  const totalS455 = dlaResults.reduce((s, r) => s + r.result.s455Due, 0);
  const totalTaxPayable = ct.corporationTax + totalS455;

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const fmtDateTime = (d: string) =>
    `${new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} at ${new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-slate-900 text-white px-8 py-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">E&P Accountancy Services</h1>
            <p className="text-slate-400 text-sm mt-0.5">Practice Management</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-400">Corporation Tax</p>
            <p className="font-bold text-lg">Period Ended {fmtDate(comp.period_end)}</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-8">

        {/* Status Banner */}
        {isApproved && (
          <div className="mb-6 rounded-2xl bg-green-50 border border-green-200 p-4 text-center">
            <p className="text-green-700 font-bold text-lg">✓ Computation Approved</p>
            <p className="text-green-600 text-sm mt-1">
              Thank you! We'll proceed to file your return.
            </p>
            {comp.approved_at && (
              <p className="text-green-500 text-xs mt-2">Approved on {fmtDateTime(comp.approved_at)}</p>
            )}
          </div>
        )}

        {isQueried && (
          <div className="mb-6 rounded-2xl bg-yellow-50 border border-yellow-200 p-4 text-center">
            <p className="text-yellow-700 font-bold text-lg">Query Raised</p>
            <p className="text-yellow-600 text-sm mt-1">
              Thanks for letting us know. We'll be in touch to go through it with you.
            </p>
            {comp.queried_at && (
              <p className="text-yellow-500 text-xs mt-2">Raised on {fmtDateTime(comp.queried_at)}</p>
            )}
          </div>
        )}

        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden">

          {/* Client Info */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Prepared for</p>
            <p className="mt-1 font-bold text-slate-900 text-lg">
              {comp.clients?.client_name || "Client"}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Accounting period: {fmtDate(comp.period_start)} to {fmtDate(comp.period_end)}
            </p>
          </div>

          {/* Profit Summary */}
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Taxable Profit</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Accounting Profit</span><span className="font-medium">{fmt(Number(comp.accounting_profit))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Capital Allowances Claimed</span><span className="font-medium">({fmt(ca.totalCapitalAllowances)})</span></div>
              <div className="flex justify-between font-bold border-t border-slate-100 pt-2">
                <span>Taxable Profit</span>
                <span>{fmt(loss.taxableProfitAfterLosses)}</span>
              </div>
            </div>
          </div>

          {/* Tax Breakdown */}
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Tax Calculation</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Band</span><span className="font-medium">{ct.band}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Corporation Tax</span><span className="font-medium">{fmt(ct.corporationTax)}</span></div>
              {totalS455 > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">S455 (Loans to Participators)</span><span className="font-medium">{fmt(totalS455)}</span></div>
              )}
              <div className="flex justify-between font-bold border-t border-slate-100 pt-2">
                <span>Total Tax Payable</span>
                <span>{fmt(totalTaxPayable)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Already paid on account</span>
                <span>{fmt(Number(comp.tax_paid_on_account || 0))}</span>
              </div>
            </div>
          </div>

          {/* Payment Due */}
          <div className="p-6 bg-slate-50">
            <div className="flex justify-between font-bold text-base">
              <span>Balance Due</span>
              <span>{fmt(Math.max(0, totalTaxPayable - Number(comp.tax_paid_on_account || 0)))}</span>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Due nine months and one day after the end of the accounting period.
            </p>
          </div>
        </div>

        {/* Approve / Query Buttons */}
        {!isResponded && (
          <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900 text-center">
              Do these figures look correct?
            </h2>
            <p className="text-sm text-slate-500 text-center mt-1">
              Please approve below, or raise a query if anything needs checking.
            </p>

            <div className="mt-6 flex gap-4 justify-center">
              <form action={approveWithToken}>
                <button
                  type="submit"
                  className="rounded-xl bg-green-600 px-8 py-3 text-sm font-bold text-white hover:bg-green-700 transition-colors"
                >
                  ✓ Approve
                </button>
              </form>

              <form action={queryWithToken}>
                <button
                  type="submit"
                  className="rounded-xl bg-white border border-slate-200 px-8 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  I Have a Question
                </button>
              </form>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-6">
          This computation was prepared by E&P Accountancy Services · Period ended {fmtDate(comp.period_end)} · This is an estimate for approval purposes and does not constitute a filed return.
        </p>

      </div>
    </div>
  );
}
