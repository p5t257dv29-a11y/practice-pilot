import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { calculateTax, getPaymentSchedule, getTaxRates } from "../page";
import SendComputationButton from "./send-computation-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Recomputes every derived aggregate field on the tax_computations row from its
// itemised source tables, and writes them back. Called after every add/delete
// of a source row, so calculateTax() and any other page reading these columns
// directly keeps working unchanged — the itemisation is additive, not a
// replacement of the underlying calculation.
async function syncAggregatesFromSources(taxComputationId: string) {
  const [
    { data: employment },
    { data: dividends },
    { data: selfEmployment },
    { data: partnerships },
    { data: properties },
    { data: foreign },
  ] = await Promise.all([
    supabase.from("sa_employment_sources").select("*").eq("tax_computation_id", taxComputationId),
    supabase.from("sa_dividend_sources").select("*").eq("tax_computation_id", taxComputationId),
    supabase.from("sa_self_employment_sources").select("*").eq("tax_computation_id", taxComputationId),
    supabase.from("sa_partnership_sources").select("*").eq("tax_computation_id", taxComputationId),
    supabase.from("sa_property_sources").select("*").eq("tax_computation_id", taxComputationId),
    supabase.from("sa_foreign_sources").select("*").eq("tax_computation_id", taxComputationId),
  ]);

  const employmentIncome = (employment || []).reduce((s, e) => s + Number(e.pay), 0);
  const dividendIncome = (dividends || []).reduce((s, d) => s + Number(d.amount), 0);
  // A partner's share of partnership trading profit gets identical Income Tax
  // and Class 4 NI treatment to sole-trade profit, so it's folded into the
  // same aggregate here — kept as its own SA104 section on screen for clarity,
  // but combined for the actual calculation.
  const soleTradeProfitTotal = (selfEmployment || []).reduce((s, b) => s + (Number(b.turnover) - Number(b.expenses)), 0);
  const partnershipProfitTotal = (partnerships || []).reduce((s, p) => s + Number(p.share_of_profit), 0);
  const selfEmploymentIncome = soleTradeProfitTotal + partnershipProfitTotal;
  const rentalIncome = (properties || []).reduce((s, p) => s + Number(p.rental_income), 0);
  const propertyExpenses = (properties || []).reduce((s, p) => s + Number(p.expenses), 0);
  const propertyFinanceCosts = (properties || []).reduce((s, p) => s + Number(p.finance_costs), 0);

  const sumForeign = (type: string) => (foreign || []).filter((f) => f.income_type === type).reduce((s, f) => s + Number(f.amount), 0);
  const foreignEmploymentIncome = sumForeign("Employment");
  const foreignInterestIncome = sumForeign("Interest");
  const foreignDividendIncome = sumForeign("Dividend");
  const foreignRentalIncome = sumForeign("Rental Income");
  const foreignPropertyExpenses = sumForeign("Rental Expenses");
  const foreignPropertyFinanceCosts = sumForeign("Rental Finance Costs");
  const foreignTaxPaid = (foreign || []).reduce((s, f) => s + Number(f.foreign_tax_paid), 0);

  await supabase.from("tax_computations").update({
    employment_income: employmentIncome,
    dividend_income: dividendIncome,
    self_employment_income: selfEmploymentIncome,
    rental_income: rentalIncome,
    property_expenses: propertyExpenses,
    property_finance_costs: propertyFinanceCosts,
    foreign_employment_income: foreignEmploymentIncome,
    foreign_interest_income: foreignInterestIncome,
    foreign_dividend_income: foreignDividendIncome,
    foreign_rental_income: foreignRentalIncome,
    foreign_property_expenses: foreignPropertyExpenses,
    foreign_property_finance_costs: foreignPropertyFinanceCosts,
    foreign_tax_paid: foreignTaxPaid,
  }).eq("id", taxComputationId);
}

// --- Employment sources ---
async function addEmploymentSource(id: string, formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) || "").trim();
  await supabase.from("sa_employment_sources").insert({
    tax_computation_id: id,
    employer_name: get("employer_name"),
    paye_reference: get("paye_reference") || null,
    pay: parseFloat(get("pay")) || 0,
    tax_deducted: parseFloat(get("tax_deducted")) || 0,
    benefits_in_kind: parseFloat(get("benefits_in_kind")) || 0,
  });
  await syncAggregatesFromSources(id);
  revalidatePath(`/tax/${id}`);
}
async function deleteEmploymentSource(id: string, sourceId: string) {
  "use server";
  await supabase.from("sa_employment_sources").delete().eq("id", sourceId);
  await syncAggregatesFromSources(id);
  revalidatePath(`/tax/${id}`);
}

// --- Dividend sources ---
async function addDividendSource(id: string, formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) || "").trim();
  await supabase.from("sa_dividend_sources").insert({
    tax_computation_id: id,
    company_name: get("company_name"),
    amount: parseFloat(get("amount")) || 0,
    date_received: get("date_received") || null,
  });
  await syncAggregatesFromSources(id);
  revalidatePath(`/tax/${id}`);
}
async function deleteDividendSource(id: string, sourceId: string) {
  "use server";
  await supabase.from("sa_dividend_sources").delete().eq("id", sourceId);
  await syncAggregatesFromSources(id);
  revalidatePath(`/tax/${id}`);
}

// --- Self-employment sources ---
async function addSelfEmploymentSource(id: string, formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) || "").trim();
  await supabase.from("sa_self_employment_sources").insert({
    tax_computation_id: id,
    business_name: get("business_name"),
    turnover: parseFloat(get("turnover")) || 0,
    expenses: parseFloat(get("expenses")) || 0,
  });
  await syncAggregatesFromSources(id);
  revalidatePath(`/tax/${id}`);
}
async function deleteSelfEmploymentSource(id: string, sourceId: string) {
  "use server";
  await supabase.from("sa_self_employment_sources").delete().eq("id", sourceId);
  await syncAggregatesFromSources(id);
  revalidatePath(`/tax/${id}`);
}

// --- Partnership sources (SA104) ---
async function addPartnershipSource(id: string, formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) || "").trim();
  await supabase.from("sa_partnership_sources").insert({
    tax_computation_id: id,
    partnership_name: get("partnership_name"),
    utr: get("utr") || null,
    share_of_profit: parseFloat(get("share_of_profit")) || 0,
    tax_deducted: parseFloat(get("tax_deducted")) || 0,
  });
  await syncAggregatesFromSources(id);
  revalidatePath(`/tax/${id}`);
}
async function deletePartnershipSource(id: string, sourceId: string) {
  "use server";
  await supabase.from("sa_partnership_sources").delete().eq("id", sourceId);
  await syncAggregatesFromSources(id);
  revalidatePath(`/tax/${id}`);
}

// --- Property sources ---
async function addPropertySource(id: string, formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) || "").trim();
  await supabase.from("sa_property_sources").insert({
    tax_computation_id: id,
    property_address: get("property_address"),
    rental_income: parseFloat(get("rental_income")) || 0,
    expenses: parseFloat(get("expenses")) || 0,
    finance_costs: parseFloat(get("finance_costs")) || 0,
  });
  await syncAggregatesFromSources(id);
  revalidatePath(`/tax/${id}`);
}
async function deletePropertySource(id: string, sourceId: string) {
  "use server";
  await supabase.from("sa_property_sources").delete().eq("id", sourceId);
  await syncAggregatesFromSources(id);
  revalidatePath(`/tax/${id}`);
}

// --- Foreign sources ---
async function addForeignSource(id: string, formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) || "").trim();
  await supabase.from("sa_foreign_sources").insert({
    tax_computation_id: id,
    country: get("country"),
    income_type: get("income_type"),
    amount: parseFloat(get("amount")) || 0,
    foreign_tax_paid: parseFloat(get("foreign_tax_paid")) || 0,
  });
  await syncAggregatesFromSources(id);
  revalidatePath(`/tax/${id}`);
}
async function deleteForeignSource(id: string, sourceId: string) {
  "use server";
  await supabase.from("sa_foreign_sources").delete().eq("id", sourceId);
  await syncAggregatesFromSources(id);
  revalidatePath(`/tax/${id}`);
}

async function updateComputation(id: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  const { data: existing } = await supabase.from("tax_computations").select("tax_year, employment_income, dividend_income, self_employment_income, rental_income, property_expenses, foreign_employment_income, foreign_interest_income, foreign_dividend_income, foreign_rental_income, foreign_property_expenses, foreign_property_finance_costs, foreign_tax_paid, property_finance_costs").eq("id", id).single();

  // TR3 boxes 8–21 — combined into one total for calculateTax, same treatment
  // as the creation form. Each is still stored on its own column below.
  const statePensionIncome = num("state_pension_income");
  const statePensionLumpSum = num("state_pension_lump_sum");
  const taxTakenOffStatePensionLumpSum = num("tax_taken_off_state_pension_lump_sum");
  const otherUkPensionsIncome = num("other_uk_pensions_income");
  const taxTakenOffOtherPensions = num("tax_taken_off_other_pensions");
  const taxableIncapacityBenefit = num("taxable_incapacity_benefit");
  const taxTakenOffIncapacityBenefit = num("tax_taken_off_incapacity_benefit");
  const jobseekersAllowance = num("jobseekers_allowance");
  const otherStateBenefits = num("other_state_benefits");
  const otherUkIncome = num("other_uk_income");
  const otherUkIncomeExpenses = num("other_uk_income_expenses");
  const taxTakenOffOtherUkIncome = num("tax_taken_off_other_uk_income");
  const preOwnedAssetsBenefit = num("pre_owned_assets_benefit");
  const otherIncomeDescription = get("other_income_description");

  const combinedPensionAndOtherIncome =
    statePensionIncome + statePensionLumpSum + otherUkPensionsIncome +
    taxableIncapacityBenefit + jobseekersAllowance + otherStateBenefits +
    Math.max(0, otherUkIncome - otherUkIncomeExpenses) + preOwnedAssetsBenefit;

  const input = {
    // These five income totals are now derived from the itemised source tables
    // above, not entered here — kept as read-only figures for the calculation.
    employmentIncome: Number(existing?.employment_income || 0),
    selfEmploymentIncome: Number(existing?.self_employment_income || 0),
    rentalIncome: Number(existing?.rental_income || 0),
    propertyExpenses: Number(existing?.property_expenses || 0),
    propertyFinanceCosts: Number(existing?.property_finance_costs || 0),
    financeCostsBf: num("finance_costs_bf"),
    pensionIncome: combinedPensionAndOtherIncome,
    interestIncome: num("interest_income"),
    dividendIncome: Number(existing?.dividend_income || 0),
    foreignEmploymentIncome: Number(existing?.foreign_employment_income || 0),
    foreignInterestIncome: Number(existing?.foreign_interest_income || 0),
    foreignDividendIncome: Number(existing?.foreign_dividend_income || 0),
    foreignRentalIncome: Number(existing?.foreign_rental_income || 0),
    foreignPropertyExpenses: Number(existing?.foreign_property_expenses || 0),
    foreignPropertyFinanceCosts: Number(existing?.foreign_property_finance_costs || 0),
    foreignFinanceCostsBf: num("foreign_finance_costs_bf"),
    foreignTaxPaid: Number(existing?.foreign_tax_paid || 0),
    personalPensionContributions: num("personal_pension_contributions"),
    giftAidDonations: num("gift_aid_donations"),
    childBenefitReceived: num("child_benefit_received"),
    marriageAllowanceTransferredOut: formData.get("marriage_allowance_transferred_out") === "on",
    marriageAllowanceReceived: formData.get("marriage_allowance_received") === "on",
    blindPersonsAllowanceClaimed: formData.get("blind_persons_allowance") === "on",
    blindAllowanceTransferredIn: formData.get("blind_allowance_transferred_in") === "on",
    studentLoanPlan: get("student_loan_plan") || undefined,
    hasPostgraduateLoan: formData.get("has_postgraduate_loan") === "on",
    taxYear: existing?.tax_year || "2026/27",
  };

  const rates = await getTaxRates(input.taxYear);
  const result = calculateTax(input, rates);

  const { error: updateError } = await supabase.from("tax_computations").update({
    finance_costs_bf: input.financeCostsBf,
    finance_costs_cf: result.unusedFinanceCostsCf,
    state_pension_income: statePensionIncome,
    state_pension_lump_sum: statePensionLumpSum,
    tax_taken_off_state_pension_lump_sum: taxTakenOffStatePensionLumpSum,
    other_uk_pensions_income: otherUkPensionsIncome,
    tax_taken_off_other_pensions: taxTakenOffOtherPensions,
    taxable_incapacity_benefit: taxableIncapacityBenefit,
    tax_taken_off_incapacity_benefit: taxTakenOffIncapacityBenefit,
    jobseekers_allowance: jobseekersAllowance,
    other_state_benefits: otherStateBenefits,
    other_uk_income: otherUkIncome,
    other_uk_income_expenses: otherUkIncomeExpenses,
    tax_taken_off_other_uk_income: taxTakenOffOtherUkIncome,
    pre_owned_assets_benefit: preOwnedAssetsBenefit,
    other_income_description: otherIncomeDescription || null,
    interest_income: input.interestIncome,
    foreign_finance_costs_bf: input.foreignFinanceCostsBf,
    foreign_finance_costs_cf: result.unusedForeignFinanceCostsCf,
    personal_pension_contributions: input.personalPensionContributions,
    gift_aid_donations: input.giftAidDonations,
    child_benefit_received: input.childBenefitReceived,
    marriage_allowance_transferred_out: input.marriageAllowanceTransferredOut,
    marriage_allowance_received: input.marriageAllowanceReceived,
    marriage_allowance_spouse_name: get("marriage_allowance_spouse_name") || null,
    marriage_allowance_spouse_nino: get("marriage_allowance_spouse_nino") || null,
    marriage_allowance_spouse_dob: get("marriage_allowance_spouse_dob") || null,
    blind_persons_allowance: input.blindPersonsAllowanceClaimed,
    blind_person_local_authority: get("blind_person_local_authority") || null,
    blind_allowance_transferred_in: input.blindAllowanceTransferredIn,
    student_loan_plan: input.studentLoanPlan || null,
    has_postgraduate_loan: input.hasPostgraduateLoan,
    tax_paid_at_source: num("tax_paid_at_source"),
    notes: get("notes"),
  }).eq("id", id);

  if (updateError) {
    throw new Error(`Failed to save Personal Tax computation: ${updateError.message}`);
  }

  revalidatePath(`/tax/${id}`);
  revalidatePath("/tax");
}

export default async function TaxComputationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: comp, error } = await supabase
    .from("tax_computations")
    .select("*, clients(client_name, email, spouse_client_id)")
    .eq("id", id)
    .single();

  if (error || !comp) notFound();

  const [
    { data: employmentSources },
    { data: dividendSources },
    { data: selfEmploymentSources },
    { data: partnershipSources },
    { data: propertySources },
    { data: foreignSources },
  ] = await Promise.all([
    supabase.from("sa_employment_sources").select("*").eq("tax_computation_id", id).order("created_at", { ascending: true }),
    supabase.from("sa_dividend_sources").select("*").eq("tax_computation_id", id).order("created_at", { ascending: true }),
    supabase.from("sa_self_employment_sources").select("*").eq("tax_computation_id", id).order("created_at", { ascending: true }),
    supabase.from("sa_partnership_sources").select("*").eq("tax_computation_id", id).order("created_at", { ascending: true }),
    supabase.from("sa_property_sources").select("*").eq("tax_computation_id", id).order("created_at", { ascending: true }),
    supabase.from("sa_foreign_sources").select("*").eq("tax_computation_id", id).order("created_at", { ascending: true }),
  ]);

  const safeEmployment = employmentSources || [];
  const safeDividends = dividendSources || [];
  const safeSelfEmployment = selfEmploymentSources || [];
  const safePartnerships = partnershipSources || [];
  const safeProperties = propertySources || [];
  const safeForeign = foreignSources || [];

  const totalTaxDeductedAtSource = safeEmployment.reduce((s, e) => s + Number(e.tax_deducted), 0);
  const totalBenefitsInKind = safeEmployment.reduce((s, e) => s + Number(e.benefits_in_kind), 0);

  // --- Marriage Allowance spouse consistency check ---
  let spouseComp: any = null;
  let spouseName: string | null = null;
  const spouseClientId = (comp.clients as any)?.spouse_client_id;
  if (spouseClientId) {
    const { data: spouseClient } = await supabase
      .from("clients")
      .select("client_name")
      .eq("id", spouseClientId)
      .single();
    spouseName = spouseClient?.client_name || null;

    const { data: sc } = await supabase
      .from("tax_computations")
      .select("id, marriage_allowance_transferred_out, marriage_allowance_received")
      .eq("client_id", spouseClientId)
      .eq("tax_year", comp.tax_year)
      .maybeSingle();
    spouseComp = sc;
  }

  const rates = await getTaxRates(comp.tax_year);

  // Same TR3 combination used in updateComputation, so the displayed figures
  // always match what Save & Recalculate would produce.
  const combinedPensionAndOtherIncome =
    Number(comp.state_pension_income) + Number(comp.state_pension_lump_sum) + Number(comp.other_uk_pensions_income) +
    Number(comp.taxable_incapacity_benefit) + Number(comp.jobseekers_allowance) + Number(comp.other_state_benefits) +
    Math.max(0, Number(comp.other_uk_income) - Number(comp.other_uk_income_expenses)) + Number(comp.pre_owned_assets_benefit);

  const result = calculateTax({
    employmentIncome: Number(comp.employment_income),
    selfEmploymentIncome: Number(comp.self_employment_income),
    rentalIncome: Number(comp.rental_income),
    propertyExpenses: Number(comp.property_expenses),
    propertyFinanceCosts: Number(comp.property_finance_costs),
    financeCostsBf: Number(comp.finance_costs_bf),
    pensionIncome: combinedPensionAndOtherIncome,
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
    blindPersonsAllowanceClaimed: comp.blind_persons_allowance,
    blindAllowanceTransferredIn: comp.blind_allowance_transferred_in,
    studentLoanPlan: comp.student_loan_plan,
    hasPostgraduateLoan: comp.has_postgraduate_loan,
    taxYear: comp.tax_year,
  }, rates);

  const balanceDue = result.totalLiability - Number(comp.tax_paid_at_source);
  const schedule = getPaymentSchedule(comp.tax_year, result.totalLiability, Number(comp.tax_paid_at_source));
  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const hasForeignIncome = Number(comp.foreign_employment_income) > 0 || Number(comp.foreign_interest_income) > 0 ||
    Number(comp.foreign_dividend_income) > 0 || Number(comp.foreign_rental_income) > 0 || Number(comp.foreign_finance_costs_bf) > 0;
  const hasPropertyIncome = Number(comp.rental_income) > 0 || Number(comp.finance_costs_bf) > 0;
  const hasPensionOrGiftAid = Number(comp.personal_pension_contributions) > 0 || Number(comp.gift_aid_donations) > 0;
  const hasChildBenefit = Number(comp.child_benefit_received) > 0;

  const { count: linkedGainsCount } = await supabase
    .from("capital_gains_computations")
    .select("id", { count: "exact", head: true })
    .eq("linked_tax_computation_id", comp.id);
  const hasLinkedGains = (linkedGainsCount || 0) > 0;

  let marriageAllowanceWarning: string | null = null;
  if (comp.marriage_allowance_transferred_out) {
    if (!spouseClientId) {
      marriageAllowanceWarning = "This client is transferring Marriage Allowance, but no spouse/civil partner is linked on their client record — add the link on the Details tab so this can be checked.";
    } else if (!spouseComp?.marriage_allowance_received) {
      marriageAllowanceWarning = `This client is transferring Marriage Allowance, but ${spouseName || "their linked spouse"}'s ${comp.tax_year} computation doesn't show a matching "Receiving" claim — check this is correct before filing.`;
    }
  } else if (comp.marriage_allowance_received) {
    if (!spouseClientId) {
      marriageAllowanceWarning = "This client is receiving Marriage Allowance, but no spouse/civil partner is linked on their client record — add the link on the Details tab so this can be checked.";
    } else if (!spouseComp?.marriage_allowance_transferred_out) {
      marriageAllowanceWarning = `This client is receiving Marriage Allowance, but ${spouseName || "their linked spouse"}'s ${comp.tax_year} computation doesn't show a matching "Transferring" claim — check this is correct before filing.`;
    }
  }

  const addEmploymentWithId = addEmploymentSource.bind(null, id);
  const addDividendWithId = addDividendSource.bind(null, id);
  const addSelfEmploymentWithId = addSelfEmploymentSource.bind(null, id);
  const addPartnershipWithId = addPartnershipSource.bind(null, id);
  const addPropertyWithId = addPropertySource.bind(null, id);
  const addForeignWithId = addForeignSource.bind(null, id);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <a href="/tax" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
            ← Back to Tax
          </a>
          <div className="flex items-center gap-2">
            {hasLinkedGains && (
              <a href={`/tax/${id}/sa108`}
                className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                View SA108 (Capital Gains) →
              </a>
            )}
            <a href={`/tax/${id}/sa100`}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              View SA100 Summary →
            </a>
          </div>
        </div>
        <div className="mt-4">
          <h1 className="text-2xl font-bold text-slate-900">
            {comp.clients?.client_name || "No client"}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Tax Year {comp.tax_year}</p>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">

        {/* Left - breakdown */}
        <div className="lg:col-span-2 space-y-6">

          {marriageAllowanceWarning && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
              <p className="text-sm font-bold text-amber-800">⚠ Marriage Allowance may not be consistent</p>
              <p className="text-xs text-amber-700 mt-1">{marriageAllowanceWarning}</p>
            </div>
          )}

          {/* Employment Sources (SA102) */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Employment (SA102)</h2>
            <p className="text-xs text-slate-400 mt-1">One entry per employer or directorship this tax year.</p>

            <div className="mt-4 space-y-2">
              {safeEmployment.map((e) => (
                <div key={e.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{e.employer_name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {e.paye_reference && `PAYE Ref: ${e.paye_reference} · `}
                      Pay {fmt(Number(e.pay))} · Tax deducted {fmt(Number(e.tax_deducted))}
                      {Number(e.benefits_in_kind) > 0 && ` · Benefits ${fmt(Number(e.benefits_in_kind))}`}
                    </p>
                  </div>
                  <form action={deleteEmploymentSource.bind(null, id, e.id)}>
                    <button className="text-xs font-semibold text-red-500 hover:text-red-700 transition-colors">Remove</button>
                  </form>
                </div>
              ))}
              {safeEmployment.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-3">No employment sources added yet.</p>
              )}
            </div>

            <form action={addEmploymentWithId} className="mt-4 pt-4 border-t border-slate-100 grid gap-2 md:grid-cols-2">
              <input name="employer_name" required placeholder="Employer name *"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="paye_reference" placeholder="PAYE reference"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="pay" type="number" step="0.01" min="0" placeholder="Pay (£)"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="tax_deducted" type="number" step="0.01" min="0" placeholder="Tax deducted (£)"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="benefits_in_kind" type="number" step="0.01" min="0" placeholder="Benefits in kind (£)"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <button type="submit"
                className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                + Add Employer
              </button>
            </form>
          </div>

          {/* Dividend Sources */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Dividends</h2>
            <p className="text-xs text-slate-400 mt-1">One entry per company paying dividends this tax year.</p>

            <div className="mt-4 space-y-2">
              {safeDividends.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{d.company_name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {fmt(Number(d.amount))}{d.date_received && ` · ${new Date(d.date_received).toLocaleDateString("en-GB")}`}
                    </p>
                  </div>
                  <form action={deleteDividendSource.bind(null, id, d.id)}>
                    <button className="text-xs font-semibold text-red-500 hover:text-red-700 transition-colors">Remove</button>
                  </form>
                </div>
              ))}
              {safeDividends.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-3">No dividend sources added yet.</p>
              )}
            </div>

            <form action={addDividendWithId} className="mt-4 pt-4 border-t border-slate-100 grid gap-2 md:grid-cols-3">
              <input name="company_name" required placeholder="Company name *"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="amount" type="number" step="0.01" min="0" placeholder="Amount (£)"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="date_received" type="date"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <button type="submit"
                className="md:col-span-3 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                + Add Dividend
              </button>
            </form>
          </div>

          {/* Self-Employment Sources (SA103) */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Self-Employment (SA103)</h2>
            <p className="text-xs text-slate-400 mt-1">
              One entry per self-employed business. Use SA103S if turnover is below £85,000, SA103F otherwise — check this separately when filing.
            </p>

            <div className="mt-4 space-y-2">
              {safeSelfEmployment.map((b) => {
                const profit = Number(b.turnover) - Number(b.expenses);
                return (
                  <div key={b.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {b.business_name}
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${Number(b.turnover) < 85000 ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-700"}`}>
                          {Number(b.turnover) < 85000 ? "SA103S" : "SA103F"}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Turnover {fmt(Number(b.turnover))} · Expenses {fmt(Number(b.expenses))} · Profit {fmt(profit)}
                      </p>
                    </div>
                    <form action={deleteSelfEmploymentSource.bind(null, id, b.id)}>
                      <button className="text-xs font-semibold text-red-500 hover:text-red-700 transition-colors">Remove</button>
                    </form>
                  </div>
                );
              })}
              {safeSelfEmployment.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-3">No self-employment businesses added yet.</p>
              )}
            </div>

            <form action={addSelfEmploymentWithId} className="mt-4 pt-4 border-t border-slate-100 grid gap-2 md:grid-cols-3">
              <input name="business_name" required placeholder="Business name *"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="turnover" type="number" step="0.01" min="0" placeholder="Turnover (£)"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="expenses" type="number" step="0.01" min="0" placeholder="Expenses (£)"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <button type="submit"
                className="md:col-span-3 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                + Add Business
              </button>
            </form>
          </div>

          {/* Partnership Sources (SA104) */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Partnership (SA104)</h2>
            <p className="text-xs text-slate-400 mt-1">
              This client's own share of profit from each partnership — the partnership's own return is prepared separately. Combined with self-employment profit above for Income Tax and Class 4 NI, since both get identical treatment.
            </p>

            <div className="mt-4 space-y-2">
              {safePartnerships.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{p.partnership_name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {p.utr && `UTR: ${p.utr} · `}Share of profit {fmt(Number(p.share_of_profit))}
                      {Number(p.tax_deducted) > 0 && ` · Tax deducted ${fmt(Number(p.tax_deducted))}`}
                    </p>
                  </div>
                  <form action={deletePartnershipSource.bind(null, id, p.id)}>
                    <button className="text-xs font-semibold text-red-500 hover:text-red-700 transition-colors">Remove</button>
                  </form>
                </div>
              ))}
              {safePartnerships.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-3">No partnerships added yet.</p>
              )}
            </div>

            <form action={addPartnershipWithId} className="mt-4 pt-4 border-t border-slate-100 grid gap-2 md:grid-cols-2">
              <input name="partnership_name" required placeholder="Partnership name *"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="utr" placeholder="Partnership UTR"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="share_of_profit" type="number" step="0.01" placeholder="Share of profit (£)"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="tax_deducted" type="number" step="0.01" min="0" placeholder="Tax deducted (£)"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <button type="submit"
                className="md:col-span-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                + Add Partnership
              </button>
            </form>
          </div>

          {/* Property Sources (SA105) */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">UK Property (SA105)</h2>
            <p className="text-xs text-slate-400 mt-1">One entry per rental property. Finance costs b/f and c/f are still tracked as a single pooled figure below, not per property.</p>

            <div className="mt-4 space-y-2">
              {safeProperties.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{p.property_address}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Rent {fmt(Number(p.rental_income))} · Expenses {fmt(Number(p.expenses))} · Finance costs {fmt(Number(p.finance_costs))}
                    </p>
                  </div>
                  <form action={deletePropertySource.bind(null, id, p.id)}>
                    <button className="text-xs font-semibold text-red-500 hover:text-red-700 transition-colors">Remove</button>
                  </form>
                </div>
              ))}
              {safeProperties.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-3">No properties added yet.</p>
              )}
            </div>

            <form action={addPropertyWithId} className="mt-4 pt-4 border-t border-slate-100 grid gap-2 md:grid-cols-2">
              <input name="property_address" required placeholder="Property address *"
                className="md:col-span-2 rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="rental_income" type="number" step="0.01" min="0" placeholder="Rental income (£)"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="expenses" type="number" step="0.01" min="0" placeholder="Expenses (£)"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="finance_costs" type="number" step="0.01" min="0" placeholder="Finance costs (£)"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <button type="submit"
                className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                + Add Property
              </button>
            </form>
          </div>

          {/* Foreign Sources (SA106) */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Foreign Income (SA106)</h2>
            <p className="text-xs text-slate-400 mt-1">One entry per country/income type combination.</p>

            <div className="mt-4 space-y-2">
              {safeForeign.map((f) => (
                <div key={f.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{f.country} — {f.income_type}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {fmt(Number(f.amount))}{Number(f.foreign_tax_paid) > 0 && ` · Foreign tax paid ${fmt(Number(f.foreign_tax_paid))}`}
                    </p>
                  </div>
                  <form action={deleteForeignSource.bind(null, id, f.id)}>
                    <button className="text-xs font-semibold text-red-500 hover:text-red-700 transition-colors">Remove</button>
                  </form>
                </div>
              ))}
              {safeForeign.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-3">No foreign sources added yet.</p>
              )}
            </div>

            <form action={addForeignWithId} className="mt-4 pt-4 border-t border-slate-100 grid gap-2 md:grid-cols-2">
              <input name="country" required placeholder="Country *"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <select name="income_type" required defaultValue=""
                className="rounded-xl border border-slate-200 p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="" disabled>Income type *</option>
                <option>Employment</option>
                <option>Interest</option>
                <option>Dividend</option>
                <option>Rental Income</option>
                <option>Rental Expenses</option>
                <option>Rental Finance Costs</option>
              </select>
              <input name="amount" type="number" step="0.01" min="0" placeholder="Amount (£)"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <input name="foreign_tax_paid" type="number" step="0.01" min="0" placeholder="Foreign tax paid (£)"
                className="rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <button type="submit"
                className="md:col-span-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                + Add Foreign Source
              </button>
            </form>
          </div>

          {/* Income Summary */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Income Summary</h2>
            <p className="text-xs text-slate-400 mt-1">Totals below are the sum of the itemised sources above.</p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Employment Income</span><span className="font-medium">{fmt(Number(comp.employment_income))}</span></div>
              {totalTaxDeductedAtSource > 0 && (
                <div className="flex justify-between text-xs text-slate-400"><span>— of which PAYE tax deducted</span><span>{fmt(totalTaxDeductedAtSource)}</span></div>
              )}
              {totalBenefitsInKind > 0 && (
                <div className="flex justify-between text-xs text-slate-400"><span>— of which benefits in kind</span><span>{fmt(totalBenefitsInKind)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-slate-500">Self-Employment Profit (incl. partnerships)</span><span className="font-medium">{fmt(Number(comp.self_employment_income))}</span></div>
              {safePartnerships.length > 0 && (
                <div className="flex justify-between text-xs text-slate-400">
                  <span>— of which partnership share</span>
                  <span>{fmt(safePartnerships.reduce((s, p) => s + Number(p.share_of_profit), 0))}</span>
                </div>
              )}
              <div className="flex justify-between"><span className="text-slate-500">Rental Property Profit</span><span className="font-medium">{fmt(result.propertyProfit)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">State Pension, Other Pensions & Benefits</span><span className="font-medium">{fmt(combinedPensionAndOtherIncome)}</span></div>
              {Number(comp.state_pension_income) > 0 && (
                <div className="flex justify-between text-xs text-slate-400"><span>— State Pension</span><span>{fmt(Number(comp.state_pension_income))}</span></div>
              )}
              {Number(comp.state_pension_lump_sum) > 0 && (
                <div className="flex justify-between text-xs text-slate-400"><span>— State Pension lump sum</span><span>{fmt(Number(comp.state_pension_lump_sum))}</span></div>
              )}
              {Number(comp.other_uk_pensions_income) > 0 && (
                <div className="flex justify-between text-xs text-slate-400"><span>— Other UK pensions/annuities</span><span>{fmt(Number(comp.other_uk_pensions_income))}</span></div>
              )}
              {Number(comp.taxable_incapacity_benefit) > 0 && (
                <div className="flex justify-between text-xs text-slate-400"><span>— Taxable Incapacity Benefit/ESA</span><span>{fmt(Number(comp.taxable_incapacity_benefit))}</span></div>
              )}
              {Number(comp.jobseekers_allowance) > 0 && (
                <div className="flex justify-between text-xs text-slate-400"><span>— Jobseeker's Allowance</span><span>{fmt(Number(comp.jobseekers_allowance))}</span></div>
              )}
              {Number(comp.other_state_benefits) > 0 && (
                <div className="flex justify-between text-xs text-slate-400"><span>— Other state benefits</span><span>{fmt(Number(comp.other_state_benefits))}</span></div>
              )}
              {(Number(comp.other_uk_income) > 0 || Number(comp.pre_owned_assets_benefit) > 0) && (
                <div className="flex justify-between text-xs text-slate-400"><span>— Other UK income{comp.other_income_description ? ` (${comp.other_income_description})` : ""}</span><span>{fmt(Math.max(0, Number(comp.other_uk_income) - Number(comp.other_uk_income_expenses)) + Number(comp.pre_owned_assets_benefit))}</span></div>
              )}
              <div className="flex justify-between"><span className="text-slate-500">Interest Received</span><span className="font-medium">{fmt(Number(comp.interest_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Dividend Income</span><span className="font-medium">{fmt(Number(comp.dividend_income))}</span></div>
              {hasForeignIncome && (
                <>
                  <div className="flex justify-between"><span className="text-slate-500">Foreign Employment Income</span><span className="font-medium">{fmt(Number(comp.foreign_employment_income))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Foreign Rental Property Profit</span><span className="font-medium">{fmt(result.foreignPropertyProfit)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Foreign Interest</span><span className="font-medium">{fmt(Number(comp.foreign_interest_income))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Foreign Dividends</span><span className="font-medium">{fmt(Number(comp.foreign_dividend_income))}</span></div>
                </>
              )}
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                <span>Total Gross Income</span>
                <span>{fmt(result.nonDividendIncome + Number(comp.interest_income) + Number(comp.foreign_interest_income) + Number(comp.dividend_income) + Number(comp.foreign_dividend_income))}</span>
              </div>
            </div>
          </div>

          {/* Pension Contributions & Gift Aid */}
          {hasPensionOrGiftAid && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Pension Contributions & Gift Aid</h2>
              <p className="text-xs text-slate-400 mt-1">
                Basic-rate relief on these is already claimed at source by the pension provider or charity. Higher/additional-rate relief is given by extending the basic and higher-rate bands below by the grossed-up amount, and adjusted net income (used for the Personal Allowance taper and High Income Child Benefit Charge) is reduced by the same amount.
              </p>
              <div className="mt-4 space-y-2 text-sm">
                {Number(comp.personal_pension_contributions) > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Personal pension contributions paid (net)</span><span className="font-medium">{fmt(Number(comp.personal_pension_contributions))}</span></div>
                )}
                {Number(comp.gift_aid_donations) > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Gift Aid donations paid (net)</span><span className="font-medium">{fmt(Number(comp.gift_aid_donations))}</span></div>
                )}
                <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                  <span>Total Grossed Up</span>
                  <span>{fmt(result.reliefExtension)}</span>
                </div>
                <div className="flex justify-between text-slate-500 pt-1">
                  <span>Extended basic-rate band limit</span>
                  <span>{fmt(result.effectiveBasicRateLimit)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Extended higher-rate threshold</span>
                  <span>{fmt(result.effectiveAdditionalRateThreshold)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Adjusted net income (for PA taper & HICBC)</span>
                  <span>{fmt(result.adjustedNetIncome)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Student Loan Repayments */}
          {comp.student_loan_plan || comp.has_postgraduate_loan ? (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Student Loan Repayments</h2>
              <p className="text-xs text-slate-400 mt-1">
                Calculated on total income of {fmt(result.totalIncome)} — not reduced by pension/Gift Aid relief, unlike the Personal Allowance taper.
              </p>
              <div className="mt-4 space-y-2 text-sm">
                {comp.student_loan_plan && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">{comp.student_loan_plan.replace("Plan", "Plan ")} repayment (9%)</span>
                    <span className="font-medium">{fmt(result.undergraduateStudentLoanRepayment)}</span>
                  </div>
                )}
                {comp.has_postgraduate_loan && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Postgraduate Loan repayment (6%)</span>
                    <span className="font-medium">{fmt(result.postgraduateStudentLoanRepayment)}</span>
                  </div>
                )}
                <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-base">
                  <span>Total Student Loan Repayment</span>
                  <span>{fmt(result.totalStudentLoanRepayment)}</span>
                </div>
              </div>
            </div>
          ) : null}

          {/* High Income Child Benefit Charge */}
          {hasChildBenefit && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">High Income Child Benefit Charge</h2>
              <p className="text-xs text-slate-400 mt-1">
                Based on this client's own adjusted net income — not household income — so only enter Child Benefit received here if this client is the higher-earning parent. Fully clawed back once adjusted net income reaches £{rates.hicbcFullClawbackAt?.toLocaleString("en-GB") || "80,000"}.
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Adjusted net income</span><span className="font-medium">{fmt(result.adjustedNetIncome)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Child Benefit received</span><span className="font-medium">{fmt(Number(comp.child_benefit_received))}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Charge percentage</span><span className="font-medium">{(result.hicbcChargePercentage * 100).toFixed(1)}%</span></div>
                <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-base">
                  <span>HICBC Due</span>
                  <span>{fmt(result.hicbcCharge)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Property Income & Finance Costs */}
          {hasPropertyIncome && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Rental Property & Finance Costs</h2>
              <p className="text-xs text-slate-400 mt-1">
                Finance costs don't reduce property profit — they generate a 20% tax reducer, capped by the lower of finance costs, property profit, and adjusted total income.
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Gross Rental Income</span><span className="font-medium">{fmt(Number(comp.rental_income))}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Allowable Property Expenses</span><span className="font-medium">({fmt(Number(comp.property_expenses))})</span></div>
                <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                  <span>Property Profit</span>
                  <span>{fmt(result.propertyProfit)}</span>
                </div>

                <div className="border-t border-slate-100 pt-3 mt-3">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Finance Cost Relief</p>
                  <div className="flex justify-between"><span className="text-slate-500">Finance costs for the year</span><span className="font-medium">{fmt(Number(comp.property_finance_costs))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Unused finance costs b/f</span><span className="font-medium">{fmt(Number(comp.finance_costs_bf))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Total available</span><span className="font-medium">{fmt(result.totalFinanceCostsAvailable)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Adjusted total income (cap)</span><span className="font-medium">{fmt(result.adjustedTotalIncome)}</span></div>
                  <div className="flex justify-between font-medium"><span className="text-slate-700">Relief given (lower of the above, x property profit)</span><span>{fmt(result.financeCostReliefCap)}</span></div>
                  <div className="flex justify-between font-bold text-green-600">
                    <span>Tax reducer (20%)</span>
                    <span>−{fmt(result.financeCostTaxReducer)}</span>
                  </div>
                </div>

                {result.unusedFinanceCostsCf > 0 && (
                  <div className="mt-3 rounded-xl bg-amber-50 border border-amber-100 p-3">
                    <p className="text-sm font-bold text-amber-800">
                      {fmt(result.unusedFinanceCostsCf)} unused finance costs carried forward to {(() => {
                        const y = parseInt(comp.tax_year.split("/")[0], 10);
                        return `${y + 1}/${String(y + 2).slice(-2)}`;
                      })()}
                    </p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      This will be picked up automatically if next year's computation is started for this client from the New Computation screen.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Foreign Rental Property & Finance Costs */}
          {(Number(comp.foreign_rental_income) > 0 || Number(comp.foreign_finance_costs_bf) > 0) && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Foreign Rental Property & Finance Costs</h2>
              <p className="text-xs text-slate-400 mt-1">
                Kept as a separate business from UK property, but the same finance cost restriction and carry-forward mechanism applies.
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Gross Foreign Rental Income</span><span className="font-medium">{fmt(Number(comp.foreign_rental_income))}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Allowable Property Expenses</span><span className="font-medium">({fmt(Number(comp.foreign_property_expenses))})</span></div>
                <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                  <span>Foreign Property Profit</span>
                  <span>{fmt(result.foreignPropertyProfit)}</span>
                </div>

                <div className="border-t border-slate-100 pt-3 mt-3">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Finance Cost Relief</p>
                  <div className="flex justify-between"><span className="text-slate-500">Finance costs for the year</span><span className="font-medium">{fmt(Number(comp.foreign_property_finance_costs))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Unused finance costs b/f</span><span className="font-medium">{fmt(Number(comp.foreign_finance_costs_bf))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Total available</span><span className="font-medium">{fmt(result.totalForeignFinanceCostsAvailable)}</span></div>
                  <div className="flex justify-between font-medium"><span className="text-slate-700">Relief given</span><span>{fmt(result.foreignFinanceCostReliefCap)}</span></div>
                  <div className="flex justify-between font-bold text-green-600">
                    <span>Tax reducer (20%)</span>
                    <span>−{fmt(result.foreignFinanceCostTaxReducer)}</span>
                  </div>
                </div>

                {result.unusedForeignFinanceCostsCf > 0 && (
                  <div className="mt-3 rounded-xl bg-amber-50 border border-amber-100 p-3">
                    <p className="text-sm font-bold text-amber-800">
                      {fmt(result.unusedForeignFinanceCostsCf)} unused foreign finance costs carried forward
                    </p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Picked up automatically when next year's computation is started for this client.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Foreign Tax Credit Relief */}
          {Number(comp.foreign_tax_paid) > 0 && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Foreign Tax Credit Relief</h2>
              <p className="text-xs text-slate-400 mt-1">
                Relief for foreign tax already paid is capped at the lower of the foreign tax suffered and the UK tax attributable to the foreign income (estimated by comparing the computation with and without the foreign income).
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Foreign tax paid</span><span className="font-medium">{fmt(Number(comp.foreign_tax_paid))}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">UK tax attributable to foreign income</span><span className="font-medium">{fmt(result.ukTaxOnForeignIncome)}</span></div>
                <div className="flex justify-between font-bold text-green-600 border-t border-slate-100 pt-2">
                  <span>Credit relief given</span>
                  <span>−{fmt(result.foreignTaxCreditRelief)}</span>
                </div>
                {result.unusedForeignTaxCredit > 0 && (
                  <p className="text-xs text-amber-700 mt-1">
                    £{result.unusedForeignTaxCredit.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} of foreign tax paid exceeds the UK tax due on that income and cannot be relieved (not carried forward under UK rules).
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Income Tax Breakdown */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Income Tax Breakdown</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Personal Allowance {result.personalAllowance < 12570 ? (comp.marriage_allowance_transferred_out ? "(reduced — Marriage Allowance transferred out, and/or tapered)" : "(tapered)") : ""}</span><span className="font-medium">{fmt(result.personalAllowance)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Taxable Non-Dividend Income</span><span className="font-medium">{fmt(result.taxableNonDividend)}</span></div>

              <div className="border-t border-slate-100 pt-2 mt-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Non-Dividend Income Tax</p>
                {result.bands.basicBandNonDiv > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Basic rate (20%) on {fmt(result.bands.basicBandNonDiv)}</span><span className="font-medium">{fmt(result.bands.basicBandNonDiv * 0.20)}</span></div>
                )}
                {result.bands.higherBandNonDiv > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Higher rate (40%) on {fmt(result.bands.higherBandNonDiv)}</span><span className="font-medium">{fmt(result.bands.higherBandNonDiv * 0.40)}</span></div>
                )}
                {result.bands.additionalBandNonDiv > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Additional rate (45%) on {fmt(result.bands.additionalBandNonDiv)}</span><span className="font-medium">{fmt(result.bands.additionalBandNonDiv * 0.45)}</span></div>
                )}
                {result.financeCostTaxReducer > 0 && (
                  <div className="flex justify-between text-green-600 font-medium"><span>Less: UK property finance cost tax reducer</span><span>−{fmt(result.financeCostTaxReducer)}</span></div>
                )}
                {result.foreignFinanceCostTaxReducer > 0 && (
                  <div className="flex justify-between text-green-600 font-medium"><span>Less: foreign property finance cost tax reducer</span><span>−{fmt(result.foreignFinanceCostTaxReducer)}</span></div>
                )}
                {result.marriageAllowanceReducer > 0 && (
                  <div className="flex justify-between text-green-600 font-medium"><span>Less: Marriage Allowance tax reducer</span><span>−{fmt(result.marriageAllowanceReducer)}</span></div>
                )}
                <div className="flex justify-between font-medium border-t border-slate-50 pt-1 mt-1">
                  <span>Non-dividend tax after reducer{result.foreignTaxCreditRelief > 0 ? "s" : ""}</span>
                  <span>{fmt(result.nonDividendTax)}</span>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-2 mt-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Savings (Interest) Tax</p>
                {result.startingRateUsed > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Starting rate (0%) on {fmt(result.startingRateUsed)}</span><span className="font-medium">{fmt(0)}</span></div>
                )}
                {result.psaUsed > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Personal Savings Allowance used</span><span className="font-medium">{fmt(result.psaUsed)}</span></div>
                )}
                {result.bands.savingsBasic > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Basic rate (20%) on {fmt(result.bands.savingsBasic)}</span><span className="font-medium">{fmt(result.bands.savingsBasic * 0.20)}</span></div>
                )}
                {result.bands.savingsHigher > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Higher rate (40%) on {fmt(result.bands.savingsHigher)}</span><span className="font-medium">{fmt(result.bands.savingsHigher * 0.40)}</span></div>
                )}
                {result.bands.savingsAdditional > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Additional rate (45%) on {fmt(result.bands.savingsAdditional)}</span><span className="font-medium">{fmt(result.bands.savingsAdditional * 0.45)}</span></div>
                )}
                {Number(comp.interest_income) === 0 && Number(comp.foreign_interest_income) === 0 && (
                  <p className="text-xs text-slate-400">No interest received.</p>
                )}
              </div>

              <div className="border-t border-slate-100 pt-2 mt-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Dividend Tax</p>
                <div className="flex justify-between"><span className="text-slate-500">Dividend allowance used</span><span className="font-medium">{fmt(result.dividendAllowanceUsed)}</span></div>
                {result.bands.divBasic > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Basic rate (10.75%) on {fmt(result.bands.divBasic)}</span><span className="font-medium">{fmt(result.bands.divBasic * 0.1075)}</span></div>
                )}
                {result.bands.divHigher > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Higher rate (35.75%) on {fmt(result.bands.divHigher)}</span><span className="font-medium">{fmt(result.bands.divHigher * 0.3575)}</span></div>
                )}
                {result.bands.divAdditional > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Additional rate (39.35%) on {fmt(result.bands.divAdditional)}</span><span className="font-medium">{fmt(result.bands.divAdditional * 0.3935)}</span></div>
                )}
              </div>

              {result.foreignTaxCreditRelief > 0 && (
                <div className="border-t border-slate-100 pt-2 mt-2 flex justify-between text-green-600 font-medium">
                  <span>Less: Foreign Tax Credit Relief</span>
                  <span>−{fmt(result.foreignTaxCreditRelief)}</span>
                </div>
              )}

              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                <span>Total Income Tax</span>
                <span>{fmt(result.totalIncomeTax)}</span>
              </div>
            </div>
          </div>

          {/* Class 4 NI */}
          {Number(comp.self_employment_income) > 0 && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Class 4 National Insurance</h2>
              <p className="text-xs text-slate-400 mt-1">
                Calculated on self-employment profit only (6% between £12,570–£50,270, 2% above).
              </p>
              <div className="mt-4 flex justify-between text-sm font-bold">
                <span>Class 4 NI Due</span>
                <span>{fmt(result.class4NI)}</span>
              </div>
            </div>
          )}

          {comp.notes && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Notes</h2>
              <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{comp.notes}</p>
            </div>
          )}
        </div>

        {/* Right - totals */}
        <div className="space-y-6">
          <div className="rounded-2xl bg-slate-900 p-6 shadow-sm text-white">
            <h2 className="text-lg font-bold">Total Liability</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-300">Income Tax</span><span>{fmt(result.totalIncomeTax)}</span></div>
              <div className="flex justify-between"><span className="text-slate-300">Class 4 NI</span><span>{fmt(result.class4NI)}</span></div>
              {result.hicbcCharge > 0 && (
                <div className="flex justify-between"><span className="text-slate-300">High Income Child Benefit Charge</span><span>{fmt(result.hicbcCharge)}</span></div>
              )}
              {result.totalStudentLoanRepayment > 0 && (
                <div className="flex justify-between"><span className="text-slate-300">Student Loan Repayment</span><span>{fmt(result.totalStudentLoanRepayment)}</span></div>
              )}
              <div className="border-t border-slate-700 pt-2 flex justify-between font-bold text-base">
                <span>Total Due</span>
                <span>{fmt(result.totalLiability)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Balance</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Total Liability</span><span className="font-medium">{fmt(result.totalLiability)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Already Paid (PAYE)</span><span className="font-medium">{fmt(Number(comp.tax_paid_at_source))}</span></div>
              <div className={`border-t border-slate-100 pt-2 flex justify-between font-bold ${balanceDue >= 0 ? "text-slate-900" : "text-green-600"}`}>
                <span>{balanceDue >= 0 ? "Balance Due" : "Refund Due"}</span>
                <span>{fmt(Math.abs(balanceDue))}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Send to Client</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Send this computation by email for digital approval.
            </p>
            <div className="mt-4">
              <SendComputationButton
                computationId={id}
                defaultEmail={comp.client_email || comp.clients?.email || ""}
                computationToken={comp.token}
                status={comp.status}
                approvedAt={comp.approved_at}
                queriedAt={comp.queried_at}
              />
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Payment Schedule</h2>
            <p className="text-xs text-slate-400 mt-1">
              {schedule.poaRequired
                ? `Payments on account towards ${schedule.nextTaxYear} are required (SA bill over £1,000 and less than 80% collected at source).`
                : "No payments on account required for the following year."}
            </p>

            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-slate-100 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {fmtDate(schedule.balancingPaymentDate)}
                </p>
                <div className="mt-1 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Balancing payment ({comp.tax_year})</span>
                    <span className="font-medium">{fmt(schedule.balanceDue)}</span>
                  </div>
                  {schedule.poaRequired && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">1st payment on account ({schedule.nextTaxYear})</span>
                      <span className="font-medium">{fmt(schedule.poaAmount)}</span>
                    </div>
                  )}
                  <div className="border-t border-slate-100 pt-1 flex justify-between font-bold">
                    <span>Total due</span>
                    <span>{fmt(schedule.dueAtBalancingPayment)}</span>
                  </div>
                </div>
              </div>

              {schedule.poaRequired && (
                <div className="rounded-xl border border-slate-100 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {fmtDate(schedule.poa2Date)}
                  </p>
                  <div className="mt-1 flex justify-between text-sm font-bold">
                    <span>2nd payment on account ({schedule.nextTaxYear})</span>
                    <span>{fmt(schedule.dueAtPoa2)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
            <p className="text-xs text-yellow-800">
              This is an estimate based on {comp.tax_year} rates for England, Wales & Northern Ireland. It does not account for property income losses or Scottish tax rates. Always verify before filing.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Edit Computation</h2>
            <p className="text-sm text-slate-500 mt-0.5">Employment, dividends, self-employment, property, and foreign income are now managed via the itemised sections on the left. Everything else can be edited here.</p>
            <form action={updateComputation.bind(null, id)} className="mt-4 space-y-4">
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">State Pension, Other Pensions & Benefits (TR3)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">State Pension (£)</label>
                    <input name="state_pension_income" type="number" step="0.01" min="0" defaultValue={comp.state_pension_income}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div></div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">State Pension Lump Sum (£)</label>
                    <input name="state_pension_lump_sum" type="number" step="0.01" min="0" defaultValue={comp.state_pension_lump_sum}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Tax Taken Off Lump Sum (£)</label>
                    <input name="tax_taken_off_state_pension_lump_sum" type="number" step="0.01" min="0" defaultValue={comp.tax_taken_off_state_pension_lump_sum}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Other UK Pensions & Annuities (£)</label>
                    <input name="other_uk_pensions_income" type="number" step="0.01" min="0" defaultValue={comp.other_uk_pensions_income}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Tax Taken Off (£)</label>
                    <input name="tax_taken_off_other_pensions" type="number" step="0.01" min="0" defaultValue={comp.tax_taken_off_other_pensions}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Taxable Incapacity Benefit / ESA (£)</label>
                    <input name="taxable_incapacity_benefit" type="number" step="0.01" min="0" defaultValue={comp.taxable_incapacity_benefit}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Tax Taken Off (£)</label>
                    <input name="tax_taken_off_incapacity_benefit" type="number" step="0.01" min="0" defaultValue={comp.tax_taken_off_incapacity_benefit}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Jobseeker's Allowance (£)</label>
                    <input name="jobseekers_allowance" type="number" step="0.01" min="0" defaultValue={comp.jobseekers_allowance}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Other State Pensions/Benefits (£)</label>
                    <input name="other_state_benefits" type="number" step="0.01" min="0" defaultValue={comp.other_state_benefits}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Other UK Income Not on Supplementary Pages (TR3)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Other Taxable Income (£)</label>
                    <input name="other_uk_income" type="number" step="0.01" min="0" defaultValue={comp.other_uk_income}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Allowable Expenses (£)</label>
                    <input name="other_uk_income_expenses" type="number" step="0.01" min="0" defaultValue={comp.other_uk_income_expenses}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Tax Taken Off (£)</label>
                    <input name="tax_taken_off_other_uk_income" type="number" step="0.01" min="0" defaultValue={comp.tax_taken_off_other_uk_income}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Pre-Owned Assets Benefit (£)</label>
                    <input name="pre_owned_assets_benefit" type="number" step="0.01" min="0" defaultValue={comp.pre_owned_assets_benefit}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Description of Income</label>
                    <input name="other_income_description" defaultValue={comp.other_income_description || ""}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Interest Received (£)</label>
                <input name="interest_income" type="number" step="0.01" min="0" defaultValue={comp.interest_income}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-2">Pension Contributions & Gift Aid</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Personal Pension Contributions Paid (£)</label>
                    <input name="personal_pension_contributions" type="number" step="0.01" min="0" defaultValue={comp.personal_pension_contributions || 0}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    <p className="text-xs text-slate-400 mt-1">Net amount paid, relief at source — not workplace contributions already deducted from Employment Income.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Gift Aid Donations Paid (£)</label>
                    <input name="gift_aid_donations" type="number" step="0.01" min="0" defaultValue={comp.gift_aid_donations || 0}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Student Loan Repayments</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Undergraduate Plan</label>
                    <select name="student_loan_plan" defaultValue={comp.student_loan_plan || ""}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                      <option value="">None</option>
                      <option value="Plan1">Plan 1 (threshold £26,900)</option>
                      <option value="Plan2">Plan 2 (threshold £29,385)</option>
                      <option value="Plan4">Plan 4 — Scotland (threshold £33,795)</option>
                      <option value="Plan5">Plan 5 (threshold £25,000)</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input name="has_postgraduate_loan" type="checkbox" defaultChecked={comp.has_postgraduate_loan} className="w-4 h-4 rounded" />
                    <span className="text-sm font-medium text-slate-700">Also has a Postgraduate Loan (threshold £21,000)</span>
                  </label>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Marriage Allowance</p>
                <p className="text-xs text-slate-400 mb-2">Only valid if neither party is a higher/additional rate taxpayer. Tick at most one.</p>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input name="marriage_allowance_transferred_out" type="checkbox" defaultChecked={comp.marriage_allowance_transferred_out} className="w-4 h-4 rounded" />
                    <span className="text-sm font-medium text-slate-700">Transferring £1,260 of PA to spouse/civil partner</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input name="marriage_allowance_received" type="checkbox" defaultChecked={comp.marriage_allowance_received} className="w-4 h-4 rounded" />
                    <span className="text-sm font-medium text-slate-700">Receiving Marriage Allowance from spouse/civil partner</span>
                  </label>
                </div>
                <div className="mt-3 space-y-2">
                  <input name="marriage_allowance_spouse_name" defaultValue={comp.marriage_allowance_spouse_name || ""} placeholder="Spouse/civil partner's name"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <input name="marriage_allowance_spouse_nino" defaultValue={comp.marriage_allowance_spouse_nino || ""} placeholder="Spouse/civil partner's NINO"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <input name="marriage_allowance_spouse_dob" type="date" defaultValue={comp.marriage_allowance_spouse_dob || ""}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Blind Person's Allowance (TR4)</p>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input name="blind_persons_allowance" type="checkbox" defaultChecked={comp.blind_persons_allowance} className="w-4 h-4 rounded" />
                    <span className="text-sm font-medium text-slate-700">Claiming Blind Person's Allowance</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input name="blind_allowance_transferred_in" type="checkbox" defaultChecked={comp.blind_allowance_transferred_in} className="w-4 h-4 rounded" />
                    <span className="text-sm font-medium text-slate-700">Spouse's unused allowance transferred in (doubles it)</span>
                  </label>
                </div>
                <input name="blind_person_local_authority" defaultValue={comp.blind_person_local_authority || ""} placeholder="Local authority/register where certified"
                  className="w-full mt-2 rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">High Income Child Benefit Charge</p>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Child Benefit Received This Tax Year (£)</label>
                  <input name="child_benefit_received" type="number" step="0.01" min="0" defaultValue={comp.child_benefit_received || 0}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <p className="text-xs text-slate-400 mt-1">Only if this client is the higher-earning parent.</p>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Property — Finance Costs Brought Forward</p>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Unused Finance Costs B/F (£)</label>
                  <input name="finance_costs_bf" type="number" step="0.01" min="0" defaultValue={comp.finance_costs_bf}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <p className="text-xs text-slate-400 mt-1">Pooled across all UK properties — carried forward from last year's computation.</p>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Foreign — Finance Costs Brought Forward</p>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Foreign Finance Costs B/F (£)</label>
                  <input name="foreign_finance_costs_bf" type="number" step="0.01" min="0" defaultValue={comp.foreign_finance_costs_bf}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tax Paid at Source / PAYE (£)</label>
                <input name="tax_paid_at_source" type="number" step="0.01" min="0" defaultValue={comp.tax_paid_at_source}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                <p className="text-xs text-slate-400 mt-1">If left as entered here rather than derived from employer PAYE deductions above, make sure it's not double-counted.</p>
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