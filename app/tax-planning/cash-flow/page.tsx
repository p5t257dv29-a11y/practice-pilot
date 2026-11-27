import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { calculateTax, getPaymentSchedule, getTaxRates } from "../../tax/page";
import { getCtRates, calculateFullCorporationTax } from "../../corporation-tax/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type ScenarioKey = "base" | "upside" | "downside";
type MainTab = "pnl-inputs" | "bs-inputs" | "report-pack";
type DepreciationMethod = "straight_line" | "reducing_balance";

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

interface FixedAssetAddition {
  id: string;
  forecast_id: string;
  title: string;
  month_index: number;
  cost: number;
  depreciation_rate_pct: number;
  depreciation_method?: DepreciationMethod;
  enabled_base: boolean;
  enabled_upside: boolean;
  enabled_downside: boolean;
}

interface FinanceAddition {
  id: string;
  forecast_id: string;
  title: string;
  month_index: number;
  principal: number;
  interest_rate_pct: number;
  term_months: number;
  enabled_base: boolean;
  enabled_upside: boolean;
  enabled_downside: boolean;
}

interface CashFlowSnapshot {
  id: string;
  snapshot_name: string;
  scenario: string;
  lowest_cash: number;
  closing_cash_12m: number;
  net_profit_12m: number;
  created_at: string;
}

interface ScheduledPayment {
  dueDate: Date;
  dueDateIso: string;
  amount: number;
  label: string;
  kind: "CT" | "VAT" | "SA";
}

interface MonthProjection {
  index: number;
  label: string;
  monthEndLabel: string;
  opening: number;
  income: number;
  cashCollectedFromSales: number;
  wages: number;
  onCosts: number;
  rent: number;
  utilities: number;
  software: number;
  marketing: number;
  legal: number;
  accountancy: number;
  insurance: number;
  bankCharges: number;
  otherCosts: number;
  totalCosts: number;
  cashPaidForCosts: number;
  financeDrawdown: number;
  financeInterest: number;
  financePrincipalPaid: number;
  financeTotalPayment: number;
  assetCapexOutflow: number;
  dividends: number;
  vatDue: number;
  vatDueDates: string[];
  taxDue: { label: string; amount: number }[];
  oneOffs: { title: string; amount: number }[];
  closing: number;
  rolling12mTurnover: number;
  vatRegisteredThisMonth: boolean;
  // P&L
  ebitda: number;
  depreciation: number;
  operatingProfit: number;
  profitBeforeTax: number;
  ctChargeAccrued: number;
  netProfitAfterTax: number;
  // Balance Sheet (month-end)
  fixedAssetsCost: number;
  accumulatedDepreciation: number;
  fixedAssetsNbv: number;
  debtors: number;
  totalAssets: number;
  loanHpBalance: number;
  vatCreditor: number;
  ctCreditor: number;
  tradeCreditors: number;
  totalLiabilities: number;
  netAssets: number;
  shareCapital: number;
  retainedEarningsBf: number;
  ytdNetProfit: number;
  ytdDividends: number;
  ytdOneOffs: number;
  equity: number;
}

interface ScenarioSummary {
  key: ScenarioKey;
  label: string;
  lowestCash: number;
  lowestMonthLabel: string;
  closingCash12m: number;
  operatingProfit12m: number;
  netProfit12m: number;
  bufferBreaches: number;
  months: MonthProjection[];
}

interface ActiveLoanState {
  id: string;
  balance: number;
  monthlyRate: number;
  monthlyPayment: number;
  startMonthIndex: number;
}

function fmt(n: number) {
  const num = Number(n || 0);
  const abs = Math.abs(num).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return num < 0 ? `−£${abs}` : `£${abs}`;
}

function formatShortDate(d: Date) {
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function parseWeights(raw: unknown): number[] {
  if (Array.isArray(raw) && raw.length === 12) {
    return raw.map((v) => {
      const num = Number(v);
      return Number.isFinite(num) && num >= 0 ? num : 1;
    });
  }
  return Array(12).fill(1);
}

function parseOverrides(raw: unknown): number[] {
  if (Array.isArray(raw) && raw.length === 12) {
    return raw.map((v) => {
      const num = Number(v);
      return Number.isFinite(num) && num > 0 ? num : 0;
    });
  }
  return Array(12).fill(0);
}

function parseQuarterEnds(raw: unknown): number[] {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .map((v) => Number(v))
      .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
  }
  return [3, 6, 9, 12];
}

function getVatDueDateForQuarterEnd(year: number, quarterEndMonth: number): Date {
  const quarterEndDate = new Date(year, quarterEndMonth, 0);
  return new Date(
    quarterEndDate.getFullYear(),
    quarterEndDate.getMonth() + 1,
    quarterEndDate.getDate() + 7
  );
}

function getCtDueDateForPeriodEnd(periodEndRaw: string): Date {
  const d = new Date(periodEndRaw);
  d.setMonth(d.getMonth() + 9);
  d.setDate(d.getDate() + 1);
  return d;
}

function calcMonthlyRepayment(principal: number, annualRatePct: number, termMonths: number): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  if (r <= 0) return principal / termMonths;
  const factor = Math.pow(1 + r, termMonths);
  return (principal * (r * factor)) / (factor - 1);
}

function isEnabledForScenario(
  row: { enabled_base?: boolean; enabled_upside?: boolean; enabled_downside?: boolean },
  scenario: ScenarioKey
) {
  if (scenario === "upside") return row.enabled_upside !== false;
  if (scenario === "downside") return row.enabled_downside !== false;
  return row.enabled_base !== false;
}

function runScenarioModel(params: {
  scenario: ScenarioKey;
  assumptions: any;
  items: CashFlowItem[];
  assetAdditions: FixedAssetAddition[];
  financeAdditions: FinanceAddition[];
  ctPayments: ScheduledPayment[];
  saPayments: ScheduledPayment[];
}): ScenarioSummary {
  const {
    scenario,
    assumptions,
    items,
    assetAdditions,
    financeAdditions,
    ctPayments,
    saPayments,
  } = params;

  const upsideIncomePct = Number(assumptions?.upside_income_pct ?? 15);
  const upsideCostPct = Number(assumptions?.upside_cost_pct ?? 0);
  const downsideIncomePct = Number(assumptions?.downside_income_pct ?? -15);
  const downsideCostPct = Number(assumptions?.downside_cost_pct ?? 10);

  const incomeMult =
    scenario === "upside"
      ? 1 + upsideIncomePct / 100
      : scenario === "downside"
      ? 1 + downsideIncomePct / 100
      : 1;

  const costMult =
    scenario === "upside"
      ? 1 + upsideCostPct / 100
      : scenario === "downside"
      ? 1 + downsideCostPct / 100
      : 1;

  const seasonalWeights = parseWeights(assumptions?.seasonal_weights);
  const incomeOverrides = parseOverrides(assumptions?.month_income_overrides);
  const costOverrides = parseOverrides(assumptions?.month_cost_overrides);

  const rawWages = Number(assumptions?.monthly_wages ?? assumptions?.monthly_payroll ?? 0);
  const rawOnCosts = Number(assumptions?.employer_ni_pension ?? 0);
  const rawRent = Number(assumptions?.monthly_rent ?? 0);
  const rawUtilities = Number(assumptions?.monthly_utilities ?? 0);
  const rawSoftware = Number(assumptions?.monthly_software ?? 0);
  const rawMarketing = Number(assumptions?.monthly_marketing ?? 0);
  const rawLegal = Number(assumptions?.monthly_legal ?? 0);
  const rawAccountancy = Number(assumptions?.monthly_accountancy ?? 0);
  const rawInsurance = Number(assumptions?.monthly_insurance ?? 0);
  const rawBankCharges = Number(assumptions?.monthly_bank_charges ?? 0);
  const rawOtherCosts = Number(assumptions?.monthly_fixed_costs ?? 0);

  const wageRisePct = Number(assumptions?.wage_increase_pct ?? 0);
  const wageRiseMonthIndex = Math.min(
    11,
    Math.max(0, (Number(assumptions?.wage_increase_month ?? 6) || 6) - 1)
  );

  // Opening / Legacy Loan & HP (active from Month 1 / index 0)
  const openingLoanHp = Number(assumptions?.opening_loan_hp ?? 0);
  const financeRatePct = Number(assumptions?.finance_interest_rate ?? 6.5);
  const financeTermMonths = Math.max(1, Number(assumptions?.finance_term_months ?? 36));
  const openingMonthlyRate = financeRatePct / 100 / 12;

  const loanStates: ActiveLoanState[] = [];
  if (openingLoanHp > 0) {
    loanStates.push({
      id: "opening-loan",
      balance: openingLoanHp,
      monthlyRate: openingMonthlyRate,
      monthlyPayment: calcMonthlyRepayment(openingLoanHp, financeRatePct, financeTermMonths),
      startMonthIndex: 0,
    });
  }

  // Mid-year Finance / HP agreements (active ONLY from their own month_index onwards)
  const activeFinanceItems = financeAdditions.filter((f) => isEnabledForScenario(f, scenario));
  for (const f of activeFinanceItems) {
    const p = Number(f.principal || 0);
    const rate = Number(f.interest_rate_pct ?? financeRatePct);
    const term = Math.max(1, Number(f.term_months || financeTermMonths));
    const startIdx = Math.min(11, Math.max(0, Number(f.month_index || 0)));
    if (p > 0) {
      loanStates.push({
        id: f.id,
        balance: p,
        monthlyRate: rate / 100 / 12,
        monthlyPayment: calcMonthlyRepayment(p, rate, term),
        startMonthIndex: startIdx,
      });
    }
  }

  const minCashBuffer = Number(assumptions?.min_cash_buffer ?? 0);
  const prior12mTurnover = Number(assumptions?.prior_12m_turnover ?? 0);
  const vatThreshold = Number(assumptions?.vat_auto_threshold ?? 90000);
  const vatAlreadyRegistered = Boolean(assumptions?.vat_already_registered);
  const vatOutputRate = Number(assumptions?.vat_output_rate ?? 20) / 100;
  const vatInputRate = Number(assumptions?.vat_input_rate ?? 20) / 100;
  const vatEnabled = Boolean(assumptions?.vat_enabled ?? true);
  const quarterlyVatManualOverride = Number(assumptions?.quarterly_vat_estimate ?? 0);
  const vatQuarterEndMonths = parseQuarterEnds(assumptions?.vat_quarter_end_months);

  const defaultDepMethod: DepreciationMethod =
    assumptions?.depreciation_method === "reducing_balance"
      ? "reducing_balance"
      : "straight_line";

  const openingCash = Number(assumptions?.opening_balance ?? 0);
  const openingFixedAssets = Number(assumptions?.opening_fixed_assets ?? 0);
  const openingDepreciationRatePct = Number(assumptions?.opening_depreciation_rate_pct ?? 20);
  const manualMonthlyDepreciation = Number(assumptions?.monthly_depreciation ?? 0);

  let openingAssetNbv = openingFixedAssets;
  const openingStraightLineDep =
    openingFixedAssets > 0 && openingDepreciationRatePct > 0
      ? (openingFixedAssets * (openingDepreciationRatePct / 100)) / 12
      : manualMonthlyDepreciation;

  const activeAssets = assetAdditions.filter((a) => isEnabledForScenario(a, scenario));
  const additionNbvMap = new Map<string, number>();
  for (const a of activeAssets) {
    additionNbvMap.set(a.id, Number(a.cost || 0));
  }

  const openingDebtors = Number(assumptions?.opening_debtors ?? 0);
  const openingCreditors = Number(assumptions?.opening_creditors ?? 0);
  const debtorDays = Math.max(0, Number(assumptions?.debtor_days ?? 0));
  const creditorDays = Math.max(0, Number(assumptions?.creditor_days ?? 0));
  const estimatedCtRate = Number(assumptions?.estimated_ct_rate ?? 19) / 100;
  const shareCapital = Number(assumptions?.share_capital ?? 100);

  const start = new Date(assumptions.start_date);
  let runningCash = openingCash;
  let runningFixedAssetsCost = openingFixedAssets;
  let runningAccumulatedDep = 0;
  let runningDebtors = openingDebtors;
  let runningCreditors = openingCreditors;
  let runningCtLiability = ctPayments.reduce((s, p) => s + p.amount, 0);
  let runningVatLiability = 0;

  // Opening Retained Earnings balances the opening Balance Sheet if not explicitly set
  const impliedOpeningRetained =
    openingCash +
    openingDebtors +
    openingFixedAssets -
    runningCtLiability -
    openingCreditors -
    openingLoanHp -
    shareCapital;

  const retainedEarningsBf =
    assumptions?.opening_retained_earnings !== undefined &&
    assumptions?.opening_retained_earnings !== null &&
    Number(assumptions?.opening_retained_earnings) !== 0
      ? Number(assumptions.opening_retained_earnings)
      : impliedOpeningRetained;

  let ytdNetProfit = 0;
  let ytdDividends = 0;
  let ytdOneOffs = 0;

  const turnoverWindow: number[] = Array.from({ length: 11 }, () => prior12mTurnover / 11);
  let isVatRegistered = vatAlreadyRegistered;
  let accruedQuarterNetVat = 0;
  let vatEffectiveMonthIndex: number | null = null;

  const paymentsByDueMonth = new Map<string, ScheduledPayment[]>();
  for (const p of [...ctPayments, ...saPayments]) {
    const key = `${p.dueDate.getFullYear()}-${String(p.dueDate.getMonth() + 1).padStart(2, "0")}`;
    const list = paymentsByDueMonth.get(key) || [];
    list.push(p);
    paymentsByDueMonth.set(key, list);
  }

  const months: MonthProjection[] = [];

  for (let i = 0; i < 12; i++) {
    const monthStart = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + i + 1, 0);
    const monthNumber = monthStart.getMonth() + 1;
    const year = monthStart.getFullYear();
    const monthKey = `${year}-${String(monthNumber).padStart(2, "0")}`;

    const weight = seasonalWeights[i] ?? 1;
    const wageFactor = i >= wageRiseMonthIndex && wageRisePct !== 0 ? 1 + wageRisePct / 100 : 1;

    const baseIncome =
      incomeOverrides[i] > 0
        ? incomeOverrides[i]
        : Number(assumptions.monthly_income) * weight;
    const income = baseIncome * incomeMult;

    const wages = rawWages * wageFactor * costMult;
    const onCosts = rawOnCosts * wageFactor * costMult;
    const rent = rawRent * costMult;
    const utilities = rawUtilities * costMult;
    const software = rawSoftware * costMult;
    const marketing = rawMarketing * costMult;
    const legal = rawLegal * costMult;
    const accountancy = rawAccountancy * costMult;
    const insurance = rawInsurance * costMult;
    const bankCharges = rawBankCharges * costMult;
    const otherCosts =
      costOverrides[i] > 0
        ? costOverrides[i] * costMult
        : rawOtherCosts * weight * costMult;

    const totalCosts =
      wages +
      onCosts +
      rent +
      utilities +
      software +
      marketing +
      legal +
      accountancy +
      insurance +
      bankCharges +
      otherCosts;

    // Working capital (Debtors & Creditors driven by Debtor Days & Creditor Days; 0 = cash basis)
    const targetDebtors = debtorDays > 0 ? income * (debtorDays / 30) : openingDebtors;
    const cashCollectedFromSales = Math.max(0, runningDebtors + income - targetDebtors);
    runningDebtors = Math.max(0, runningDebtors + income - cashCollectedFromSales);

    // Non-payroll overheads subject to supplier credit terms
    const creditEligibleCosts =
      rent + utilities + software + marketing + legal + accountancy + insurance + otherCosts;
    const immediatePayrollAndBank = wages + onCosts + bankCharges;
    const targetCreditors =
      creditorDays > 0 ? creditEligibleCosts * (creditorDays / 30) : openingCreditors;
    const cashPaidToSuppliers = Math.max(
      0,
      runningCreditors + creditEligibleCosts - targetCreditors
    );
    runningCreditors = Math.max(0, runningCreditors + creditEligibleCosts - cashPaidToSuppliers);
    const cashPaidForCosts = immediatePayrollAndBank + cashPaidToSuppliers;

    // Mid-year Fixed Assets & Depreciation
    const boughtThisMonth = activeAssets.filter((a) => a.month_index === i);
    const assetCapexOutflow = boughtThisMonth.reduce((s, a) => s + Number(a.cost || 0), 0);

    let openingDepThisMonth = 0;
    if (defaultDepMethod === "reducing_balance") {
      openingDepThisMonth =
        openingAssetNbv > 0 && openingDepreciationRatePct > 0
          ? (openingAssetNbv * (openingDepreciationRatePct / 100)) / 12
          : manualMonthlyDepreciation;
      openingAssetNbv = Math.max(0, openingAssetNbv - openingDepThisMonth);
    } else {
      openingDepThisMonth = openingStraightLineDep;
    }

    let additionsDepThisMonth = 0;
    for (const a of activeAssets) {
      if (a.month_index <= i) {
        const rate = Number(a.depreciation_rate_pct || 0) / 100;
        const assetMethod: DepreciationMethod =
          a.depreciation_method === "reducing_balance" || a.depreciation_method === "straight_line"
            ? a.depreciation_method
            : defaultDepMethod;
        const currentNbv = additionNbvMap.get(a.id) ?? Number(a.cost || 0);
        const basis = assetMethod === "reducing_balance" ? currentNbv : Number(a.cost || 0);
        const depAmt = rate > 0 ? (basis * rate) / 12 : 0;
        additionsDepThisMonth += depAmt;
        additionNbvMap.set(a.id, Math.max(0, currentNbv - depAmt));
      }
    }

    const depreciation = openingDepThisMonth + additionsDepThisMonth;

    // Loans & HP
    let financeDrawdown = 0;
    let financeInterest = 0;
    let financePrincipalPaid = 0;
    let totalLoanHpBalance = 0;

    for (const loan of loanStates) {
      if (i < loan.startMonthIndex) continue;
      if (loan.id !== "opening-loan" && i === loan.startMonthIndex) {
        financeDrawdown += loan.balance;
      }
      if (loan.balance > 0) {
        const interest = loan.balance * loan.monthlyRate;
        const principalPaid = Math.min(
          loan.balance,
          Math.max(0, loan.monthlyPayment - interest)
        );
        loan.balance = Math.max(0, loan.balance - principalPaid);
        financeInterest += interest;
        financePrincipalPaid += principalPaid;
      }
      totalLoanHpBalance += loan.balance;
    }

    const financeTotalPayment = financeInterest + financePrincipalPaid;
    const dividends = Number(assumptions.monthly_dividend_drawings || 0);

    // VAT
    turnoverWindow.push(income);
    if (turnoverWindow.length > 12) turnoverWindow.shift();
    const rolling12mTurnover = turnoverWindow.reduce((s, v) => s + v, 0);

    if (!isVatRegistered && rolling12mTurnover > vatThreshold && vatEffectiveMonthIndex === null) {
      vatEffectiveMonthIndex = i + 2;
    }
    if (vatEffectiveMonthIndex !== null && i >= vatEffectiveMonthIndex) {
      isVatRegistered = true;
    }

    const monthlyNetVatAccrual =
      vatEnabled && isVatRegistered
        ? quarterlyVatManualOverride > 0
          ? quarterlyVatManualOverride / 3
          : Math.max(0, income * vatOutputRate - creditEligibleCosts * vatInputRate)
        : 0;

    if (vatEnabled && isVatRegistered) {
      accruedQuarterNetVat += monthlyNetVatAccrual;
    }

    if (vatEnabled && isVatRegistered && vatQuarterEndMonths.includes(monthNumber)) {
      const dueDate = getVatDueDateForQuarterEnd(year, monthNumber);
      const payable = Math.max(0, accruedQuarterNetVat);
      if (payable > 0) {
        const dueKey = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}`;
        const list = paymentsByDueMonth.get(dueKey) || [];
        list.push({
          dueDate,
          dueDateIso: dueDate.toISOString().slice(0, 10),
          amount: payable,
          label: `VAT due ${formatShortDate(dueDate)} (Q-end ${monthStart.toLocaleDateString("en-GB", { month: "short" })})`,
          kind: "VAT",
        });
        paymentsByDueMonth.set(dueKey, list);
      }
      accruedQuarterNetVat = 0;
    }

    const monthDueItems = paymentsByDueMonth.get(monthKey) || [];
    const vatDue = monthDueItems.filter((p) => p.kind === "VAT").reduce((s, p) => s + p.amount, 0);
    const vatDueDates = monthDueItems.filter((p) => p.kind === "VAT").map((p) => p.label);

    const taxDueItems = monthDueItems.filter((p) => p.kind === "CT" || p.kind === "SA");
    const taxCashPaid = taxDueItems.reduce((s, p) => s + p.amount, 0);

    const monthOneOffs = items.filter(
      (item) => item.month_index === i && isEnabledForScenario(item, scenario)
    );
    const oneOffTotal = monthOneOffs.reduce((s, item) => s + Number(item.amount || 0), 0);

    // Cash Flow
    const opening = runningCash;
    const closing =
      opening +
      cashCollectedFromSales +
      financeDrawdown -
      cashPaidForCosts -
      financeTotalPayment -
      assetCapexOutflow -
      dividends -
      vatDue -
      taxCashPaid +
      oneOffTotal;

    // P&L
    const ebitda = income - totalCosts;
    const operatingProfit = ebitda - depreciation;
    const profitBeforeTax = operatingProfit - financeInterest;
    const ctChargeAccrued = profitBeforeTax > 0 ? profitBeforeTax * estimatedCtRate : 0;
    const netProfitAfterTax = profitBeforeTax - ctChargeAccrued;

    // Balance Sheet
    runningFixedAssetsCost += assetCapexOutflow;
    runningAccumulatedDep += depreciation;
    const fixedAssetsNbv = Math.max(0, runningFixedAssetsCost - runningAccumulatedDep);

    runningVatLiability = Math.max(0, runningVatLiability + monthlyNetVatAccrual - vatDue);
    runningCtLiability = Math.max(0, runningCtLiability + ctChargeAccrued - taxCashPaid);

    const totalAssets = closing + runningDebtors + fixedAssetsNbv;
    const totalLiabilities =
      runningVatLiability + runningCtLiability + runningCreditors + totalLoanHpBalance;
    const netAssets = totalAssets - totalLiabilities;

    ytdNetProfit += netProfitAfterTax;
    ytdDividends += dividends;
    ytdOneOffs += oneOffTotal;
    const equity = shareCapital + retainedEarningsBf + ytdNetProfit - ytdDividends + ytdOneOffs;

    months.push({
      index: i,
      label: monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
      monthEndLabel: formatShortDate(monthEnd),
      opening,
      income,
      cashCollectedFromSales,
      wages,
      onCosts,
      rent,
      utilities,
      software,
      marketing,
      legal,
      accountancy,
      insurance,
      bankCharges,
      otherCosts,
      totalCosts,
      cashPaidForCosts,
      financeDrawdown,
      financeInterest,
      financePrincipalPaid,
      financeTotalPayment,
      assetCapexOutflow,
      dividends,
      vatDue,
      vatDueDates,
      taxDue: taxDueItems.map((t) => ({ label: t.label, amount: t.amount })),
      oneOffs: monthOneOffs.map((m) => ({ title: m.title, amount: Number(m.amount) })),
      closing,
      rolling12mTurnover,
      vatRegisteredThisMonth: isVatRegistered,
      ebitda,
      depreciation,
      operatingProfit,
      profitBeforeTax,
      ctChargeAccrued,
      netProfitAfterTax,
      fixedAssetsCost: runningFixedAssetsCost,
      accumulatedDepreciation: runningAccumulatedDep,
      fixedAssetsNbv,
      debtors: runningDebtors,
      totalAssets,
      loanHpBalance: totalLoanHpBalance,
      vatCreditor: runningVatLiability,
      ctCreditor: runningCtLiability,
      tradeCreditors: runningCreditors,
      totalLiabilities,
      netAssets,
      shareCapital,
      retainedEarningsBf,
      ytdNetProfit,
      ytdDividends,
      ytdOneOffs,
      equity,
    });

    runningCash = closing;
  }

  const lowestMonth = months.reduce((min, m) => (m.closing < min.closing ? m : min), months[0]);
  const finalMonth = months[months.length - 1];

  return {
    key: scenario,
    label: scenario === "base" ? "Base" : scenario === "upside" ? "Upside" : "Downside",
    lowestCash: lowestMonth.closing,
    lowestMonthLabel: lowestMonth.label,
    closingCash12m: finalMonth.closing,
    operatingProfit12m: months.reduce((s, m) => s + m.operatingProfit, 0),
    netProfit12m: months.reduce((s, m) => s + m.netProfitAfterTax, 0),
    bufferBreaches: months.filter((m) => m.closing < minCashBuffer).length,
    months,
  };
}

async function savePnlAssumptions(clientId: string, formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) || "").trim();

  const seasonalWeights = Array.from({ length: 12 }, (_, idx) => {
    const pct = parseFloat(get(`season_${idx}`));
    return Number.isFinite(pct) && pct >= 0 ? pct / 100 : 1;
  });

  const monthIncomeOverrides = Array.from({ length: 12 }, (_, idx) => {
    const val = parseFloat(get(`inc_ovr_${idx}`));
    return Number.isFinite(val) && val > 0 ? val : 0;
  });

  const monthCostOverrides = Array.from({ length: 12 }, (_, idx) => {
    const val = parseFloat(get(`cost_ovr_${idx}`));
    return Number.isFinite(val) && val > 0 ? val : 0;
  });

  const stagger = get("vat_stagger") || "3-6-9-12";
  const vatQuarterEndMonths = stagger
    .split("-")
    .map((s) => parseInt(s, 10))
    .filter(Boolean);

  const payload = {
    client_id: clientId,
    start_date: get("start_date") || new Date().toISOString().slice(0, 10),
    monthly_income: Number(get("monthly_income") || 0),
    monthly_wages: Number(get("monthly_wages") || 0),
    monthly_payroll: Number(get("monthly_wages") || 0),
    employer_ni_pension: Number(get("employer_ni_pension") || 0),
    wage_increase_pct: Number(get("wage_increase_pct") || 0),
    wage_increase_month: Number(get("wage_increase_month") || 6),
    monthly_rent: Number(get("monthly_rent") || 0),
    monthly_utilities: Number(get("monthly_utilities") || 0),
    monthly_software: Number(get("monthly_software") || 0),
    monthly_marketing: Number(get("monthly_marketing") || 0),
    monthly_legal: Number(get("monthly_legal") || 0),
    monthly_accountancy: Number(get("monthly_accountancy") || 0),
    monthly_insurance: Number(get("monthly_insurance") || 0),
    monthly_bank_charges: Number(get("monthly_bank_charges") || 0),
    monthly_fixed_costs: Number(get("monthly_fixed_costs") || 0),
    prior_12m_turnover: Number(get("prior_12m_turnover") || 0),
    vat_enabled: formData.get("vat_enabled") === "on",
    vat_already_registered: formData.get("vat_already_registered") === "on",
    vat_auto_threshold: Number(get("vat_auto_threshold") || 90000),
    quarterly_vat_estimate: Number(get("quarterly_vat_estimate") || 0),
    vat_quarter_end_months: vatQuarterEndMonths,
    estimated_ct_rate: Number(get("estimated_ct_rate") ?? 19),
    upside_income_pct: Number(get("upside_income_pct") ?? 15),
    downside_income_pct: Number(get("downside_income_pct") ?? -15),
    upside_cost_pct: Number(get("upside_cost_pct") ?? 0),
    downside_cost_pct: Number(get("downside_cost_pct") ?? 10),
    seasonal_weights: seasonalWeights,
    month_income_overrides: monthIncomeOverrides,
    month_cost_overrides: monthCostOverrides,
    notes: get("notes") || null,
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

  revalidatePath("/tax-planning/cash-flow");
}

async function saveBalanceSheetAssumptions(clientId: string, formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) || "").trim();
  const depMethod: DepreciationMethod =
    get("depreciation_method") === "reducing_balance"
      ? "reducing_balance"
      : "straight_line";

  const payload = {
    client_id: clientId,
    opening_balance: Number(get("opening_balance") || 0),
    min_cash_buffer: Number(get("min_cash_buffer") || 0),
    monthly_dividend_drawings: Number(get("monthly_dividend_drawings") || 0),
    opening_fixed_assets: Number(get("opening_fixed_assets") || 0),
    depreciation_method: depMethod,
    opening_depreciation_rate_pct: Number(get("opening_depreciation_rate_pct") ?? 20),
    monthly_depreciation: Number(get("monthly_depreciation") || 0),
    opening_debtors: Number(get("opening_debtors") || 0),
    opening_creditors: Number(get("opening_creditors") || 0),
    debtor_days: Math.max(0, parseInt(get("debtor_days"), 10) || 0),
    creditor_days: Math.max(0, parseInt(get("creditor_days"), 10) || 0),
    share_capital: Number(get("share_capital") || 100),
    opening_retained_earnings: Number(get("opening_retained_earnings") || 0),
    opening_loan_hp: Number(get("opening_loan_hp") || 0),
    finance_interest_rate: Number(get("finance_interest_rate") ?? 6.5),
    finance_term_months: Number(get("finance_term_months") || 36),
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
    await supabase.from("cash_flow_forecasts").insert({
      start_date: new Date().toISOString().slice(0, 10),
      monthly_income: 0,
      monthly_fixed_costs: 0,
      ...payload,
    });
  }

  revalidatePath("/tax-planning/cash-flow");
}

async function addFinanceAddition(forecastId: string, formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) || "").trim();
  const title = get("title");
  const monthIndex = Math.min(11, Math.max(0, parseInt(get("month_index"), 10) || 0));
  const principal = Math.max(0, parseFloat(get("principal")) || 0);
  const rate = Math.max(0, parseFloat(get("interest_rate_pct")) || 6.5);
  const term = Math.max(1, parseInt(get("term_months"), 10) || 36);

  if (!forecastId || !title || principal <= 0) return;

  await supabase.from("cash_flow_finance_items").insert({
    forecast_id: forecastId,
    title,
    month_index: monthIndex,
    principal,
    interest_rate_pct: rate,
    term_months: term,
    enabled_base: true,
    enabled_upside: true,
    enabled_downside: true,
  });

  revalidatePath("/tax-planning/cash-flow");
}

async function toggleFinanceAddition(
  financeId: string,
  scenario: ScenarioKey,
  currentEnabled: boolean
) {
  "use server";
  const col =
    scenario === "upside"
      ? "enabled_upside"
      : scenario === "downside"
      ? "enabled_downside"
      : "enabled_base";

  await supabase.from("cash_flow_finance_items").update({ [col]: !currentEnabled }).eq("id", financeId);
  revalidatePath("/tax-planning/cash-flow");
}

async function deleteFinanceAddition(financeId: string) {
  "use server";
  await supabase.from("cash_flow_finance_items").delete().eq("id", financeId);
  revalidatePath("/tax-planning/cash-flow");
}

async function addFixedAssetAddition(forecastId: string, formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) || "").trim();
  const title = get("title");
  const monthIndex = Math.min(11, Math.max(0, parseInt(get("month_index"), 10) || 0));
  const cost = Math.max(0, parseFloat(get("cost")) || 0);
  const depRate = Math.max(0, parseFloat(get("depreciation_rate_pct")) || 20);
  const depMethod: DepreciationMethod =
    get("depreciation_method") === "reducing_balance"
      ? "reducing_balance"
      : "straight_line";

  if (!forecastId || !title || cost <= 0) return;

  await supabase.from("cash_flow_fixed_assets").insert({
    forecast_id: forecastId,
    title,
    month_index: monthIndex,
    cost,
    depreciation_rate_pct: depRate,
    depreciation_method: depMethod,
    enabled_base: true,
    enabled_upside: true,
    enabled_downside: true,
  });

  revalidatePath("/tax-planning/cash-flow");
}

async function toggleFixedAssetAddition(
  assetId: string,
  scenario: ScenarioKey,
  currentEnabled: boolean
) {
  "use server";
  const col =
    scenario === "upside"
      ? "enabled_upside"
      : scenario === "downside"
      ? "enabled_downside"
      : "enabled_base";

  await supabase.from("cash_flow_fixed_assets").update({ [col]: !currentEnabled }).eq("id", assetId);
  revalidatePath("/tax-planning/cash-flow");
}

async function deleteFixedAssetAddition(assetId: string) {
  "use server";
  await supabase.from("cash_flow_fixed_assets").delete().eq("id", assetId);
  revalidatePath("/tax-planning/cash-flow");
}

async function prefillFromPracticePilot(clientId: string) {
  "use server";
  if (!clientId) return;

  const [{ data: assets }, { data: invoices }] = await Promise.all([
    supabase.from("fixed_assets").select("*").eq("client_id", clientId),
    supabase.from("invoices").select("*").eq("client_id", clientId),
  ]);

  const assetTotal = (assets || []).reduce((sum: number, a: any) => {
    const val = Number(a.net_book_value ?? a.cost ?? a.amount ?? 0);
    return sum + (Number.isFinite(val) ? val : 0);
  }, 0);

  const suggestedMonthlyDep = Number(((assetTotal * 0.2) / 12).toFixed(2));
  const invoiceTotal = (invoices || []).reduce((sum: number, inv: any) => {
    const amt = Number(inv.total ?? inv.subtotal ?? inv.amount ?? 0);
    return sum + (Number.isFinite(amt) ? amt : 0);
  }, 0);

  const suggestedMonthlyIncome =
    invoiceTotal > 0 ? Number((invoiceTotal / 12).toFixed(2)) : undefined;

  const { data: existing } = await supabase
    .from("cash_flow_forecasts")
    .select("id, monthly_income")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const patch: Record<string, unknown> = {
    opening_fixed_assets: Number(assetTotal.toFixed(2)),
    opening_depreciation_rate_pct: 20,
    monthly_depreciation: suggestedMonthlyDep,
    updated_at: new Date().toISOString(),
  };

  if (invoiceTotal > 0) {
    patch.prior_12m_turnover = Number(invoiceTotal.toFixed(2));
    if (!Number(existing?.monthly_income) && suggestedMonthlyIncome) {
      patch.monthly_income = suggestedMonthlyIncome;
    }
  }

  if (existing) {
    await supabase.from("cash_flow_forecasts").update(patch).eq("id", existing.id);
  } else {
    await supabase.from("cash_flow_forecasts").insert({
      client_id: clientId,
      start_date: new Date().toISOString().slice(0, 10),
      opening_balance: 0,
      monthly_income: suggestedMonthlyIncome ?? 0,
      monthly_fixed_costs: 0,
      monthly_dividend_drawings: 0,
      ...patch,
    });
  }

  revalidatePath("/tax-planning/cash-flow");
}

async function applyWhatIfPreset(
  forecastId: string,
  preset: "hire_2800" | "rev_dip_20" | "capex_5000" | "div_stress"
) {
  "use server";
  if (!forecastId) return;

  const { data: fc } = await supabase
    .from("cash_flow_forecasts")
    .select("*")
    .eq("id", forecastId)
    .single();
  if (!fc) return;

  if (preset === "hire_2800") {
    await supabase.from("cash_flow_items").insert({
      forecast_id: forecastId,
      title: "What-If: New Hire (£2,800/mo)",
      category: "What-If",
      month_index: 1,
      amount: -2800,
      enabled_base: true,
      enabled_upside: true,
      enabled_downside: true,
    });
  } else if (preset === "rev_dip_20") {
    await supabase
      .from("cash_flow_forecasts")
      .update({
        downside_income_pct: -20,
        active_scenario: "downside",
        updated_at: new Date().toISOString(),
      })
      .eq("id", forecastId);
  } else if (preset === "capex_5000") {
    await supabase.from("cash_flow_fixed_assets").insert({
      forecast_id: forecastId,
      title: "What-If: Equipment Buy (£5,000)",
      month_index: 2,
      cost: 5000,
      depreciation_rate_pct: 20,
      depreciation_method: "straight_line",
      enabled_base: true,
      enabled_upside: true,
      enabled_downside: true,
    });
  } else if (preset === "div_stress") {
    const currentDiv = Number(fc.monthly_dividend_drawings || 0);
    await supabase
      .from("cash_flow_forecasts")
      .update({
        monthly_dividend_drawings: Number((currentDiv * 1.25).toFixed(2)),
        updated_at: new Date().toISOString(),
      })
      .eq("id", forecastId);
  }

  revalidatePath("/tax-planning/cash-flow");
}

async function saveSnapshot(
  clientId: string,
  forecastId: string,
  scenario: ScenarioKey,
  lowestCash: number,
  closingCash12m: number,
  netProfit12m: number,
  formData: FormData
) {
  "use server";
  const name =
    String(formData.get("snapshot_name") || "").trim() ||
    `${scenario.toUpperCase()} Pack — ${new Date().toLocaleDateString("en-GB")}`;

  await supabase.from("cash_flow_snapshots").insert({
    client_id: clientId,
    forecast_id: forecastId,
    snapshot_name: name,
    scenario,
    lowest_cash: lowestCash,
    closing_cash_12m: closingCash12m,
    net_profit_12m: netProfit12m,
  });

  revalidatePath("/tax-planning/cash-flow");
}

async function setScenario(forecastId: string, scenario: ScenarioKey) {
  "use server";
  if (!forecastId) return;
  await supabase
    .from("cash_flow_forecasts")
    .update({ active_scenario: scenario, updated_at: new Date().toISOString() })
    .eq("id", forecastId);
  revalidatePath("/tax-planning/cash-flow");
}

async function addMicroforecast(forecastId: string, formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) || "").trim();
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

  revalidatePath("/tax-planning/cash-flow");
}

async function toggleMicroforecast(
  itemId: string,
  scenario: ScenarioKey,
  currentEnabled: boolean
) {
  "use server";
  const col =
    scenario === "upside"
      ? "enabled_upside"
      : scenario === "downside"
      ? "enabled_downside"
      : "enabled_base";

  await supabase.from("cash_flow_items").update({ [col]: !currentEnabled }).eq("id", itemId);
  revalidatePath("/tax-planning/cash-flow");
}

async function deleteMicroforecast(itemId: string) {
  "use server";
  await supabase.from("cash_flow_items").delete().eq("id", itemId);
  revalidatePath("/tax-planning/cash-flow");
}

export default async function CashFlowForecastPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; scenario?: string; tab?: string }>;
}) {
  const { clientId, scenario: scenarioQuery, tab: tabQuery } = await searchParams;

  const activeTab: MainTab =
    tabQuery === "pnl-inputs" || tabQuery === "bs-inputs" || tabQuery === "report-pack"
      ? tabQuery
      : "report-pack";

  const { data: clients } = await supabase
    .from("clients")
    .select("id, client_name")
    .order("client_name");

  const activeClientName =
    (clients || []).find((c: any) => c.id === clientId)?.client_name || "";

  let assumptions: any = null;
  let items: CashFlowItem[] = [];
  let assetAdditions: FixedAssetAddition[] = [];
  let financeAdditions: FinanceAddition[] = [];
  let snapshots: CashFlowSnapshot[] = [];
  let ctPayments: ScheduledPayment[] = [];
  let saPayments: ScheduledPayment[] = [];

  if (clientId) {
    const { data: existing } = await supabase
      .from("cash_flow_forecasts")
      .select("*")
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    assumptions = existing;

    if (existing?.id) {
      const [itemRes, assetRes, finRes, snapRes] = await Promise.all([
        supabase
          .from("cash_flow_items")
          .select("*")
          .eq("forecast_id", existing.id)
          .order("month_index", { ascending: true }),
        supabase
          .from("cash_flow_fixed_assets")
          .select("*")
          .eq("forecast_id", existing.id)
          .order("month_index", { ascending: true }),
        supabase
          .from("cash_flow_finance_items")
          .select("*")
          .eq("forecast_id", existing.id)
          .order("month_index", { ascending: true }),
        supabase
          .from("cash_flow_snapshots")
          .select("*")
          .eq("forecast_id", existing.id)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      items = (itemRes.data || []) as CashFlowItem[];
      assetAdditions = (assetRes.data || []) as FixedAssetAddition[];
      financeAdditions = (finRes.data || []) as FinanceAddition[];
      snapshots = (snapRes.data || []) as CashFlowSnapshot[];
    }

    const { data: ctComps } = await supabase
      .from("corporation_tax_computations")
      .select("*")
      .eq("client_id", clientId);

    if (ctComps && ctComps.length > 0) {
      const ctRates = await getCtRates("2026/27");
      for (const comp of ctComps) {
        const { data: assets } = await supabase
          .from("fixed_assets")
          .select("*")
          .eq("client_id", clientId);
        const full = await calculateFullCorporationTax(comp, assets || [], ctRates);
        const dueDate = getCtDueDateForPeriodEnd(comp.period_end);
        if (full.totalCorporationTax > 0) {
          ctPayments.push({
            dueDate,
            dueDateIso: dueDate.toISOString().slice(0, 10),
            amount: full.totalCorporationTax,
            label: `CT due ${formatShortDate(dueDate)} (period end ${new Date(
              comp.period_end
            ).toLocaleDateString("en-GB")})`,
            kind: "CT",
          });
        }
      }
    }

    const { data: taxComps } = await supabase
      .from("tax_computations")
      .select("*")
      .eq("client_id", clientId);

    if (taxComps && taxComps.length > 0) {
      for (const comp of taxComps) {
        const rates = await getTaxRates(comp.tax_year);
        const result = calculateTax(
          {
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
          },
          rates
        );

        const schedule = getPaymentSchedule(
          comp.tax_year,
          result.totalLiability,
          Number(comp.tax_paid_at_source)
        );

        if (schedule.balanceDue > 0) {
          const d = new Date(schedule.balancingPaymentDate);
          saPayments.push({
            dueDate: d,
            dueDateIso: d.toISOString().slice(0, 10),
            amount: schedule.balanceDue,
            label: `SA balancing due ${formatShortDate(d)} (${comp.tax_year})`,
            kind: "SA",
          });
        }
        if (schedule.poaRequired) {
          const d1 = new Date(schedule.balancingPaymentDate);
          const d2 = new Date(schedule.poa2Date);
          saPayments.push({
            dueDate: d1,
            dueDateIso: d1.toISOString().slice(0, 10),
            amount: schedule.poaAmount,
            label: `SA 1st POA due ${formatShortDate(d1)} (${schedule.nextTaxYear})`,
            kind: "SA",
          });
          saPayments.push({
            dueDate: d2,
            dueDateIso: d2.toISOString().slice(0, 10),
            amount: schedule.dueAtPoa2,
            label: `SA 2nd POA due ${formatShortDate(d2)} (${schedule.nextTaxYear})`,
            kind: "SA",
          });
        }
      }
    }
  }

  const activeScenario: ScenarioKey =
    scenarioQuery === "upside" || scenarioQuery === "downside" || scenarioQuery === "base"
      ? scenarioQuery
      : assumptions?.active_scenario === "upside" || assumptions?.active_scenario === "downside"
      ? assumptions.active_scenario
      : "base";

  const scenarioSummaries: Record<ScenarioKey, ScenarioSummary> | null = assumptions
    ? {
        base: runScenarioModel({
          scenario: "base",
          assumptions,
          items,
          assetAdditions,
          financeAdditions,
          ctPayments,
          saPayments,
        }),
        upside: runScenarioModel({
          scenario: "upside",
          assumptions,
          items,
          assetAdditions,
          financeAdditions,
          ctPayments,
          saPayments,
        }),
        downside: runScenarioModel({
          scenario: "downside",
          assumptions,
          items,
          assetAdditions,
          financeAdditions,
          ctPayments,
          saPayments,
        }),
      }
    : null;

  const currentSummary = scenarioSummaries ? scenarioSummaries[activeScenario] : null;
  const months = currentSummary?.months || [];

  const vatThreshold = Number(assumptions?.vat_auto_threshold ?? 90000);
  const vatAlreadyRegistered = Boolean(assumptions?.vat_already_registered);
  const estimatedCtRate = Number(assumptions?.estimated_ct_rate ?? 19) / 100;
  const minCashBuffer = Number(assumptions?.min_cash_buffer ?? 0);

  const breachMonth = months.find((m) => m.rolling12mTurnover > vatThreshold);
  const effectiveVatMonth = months.find((m) => m.vatRegisteredThisMonth);

  const totalRevenue12m = months.reduce((s, m) => s + m.income, 0);
  const totalEbitda12m = months.reduce((s, m) => s + m.ebitda, 0);
  const totalOpProfit12m = months.reduce((s, m) => s + m.operatingProfit, 0);
  const totalFinanceInterest12m = months.reduce((s, m) => s + m.financeInterest, 0);
  const totalPbt12m = months.reduce((s, m) => s + m.profitBeforeTax, 0);
  const totalCtCharge12m = months.reduce((s, m) => s + m.ctChargeAccrued, 0);
  const totalNetProfit12m = months.reduce((s, m) => s + m.netProfitAfterTax, 0);
  const opMarginPct = totalRevenue12m > 0 ? (totalOpProfit12m / totalRevenue12m) * 100 : 0;

  const avgMonthlyNetCash =
    months.length > 0
      ? (months[months.length - 1].closing - Number(assumptions?.opening_balance || 0)) /
        months.length
      : 0;

  const monthsAboveBuffer = months.filter((m) => m.closing >= minCashBuffer).length;
  const maxAbsClosing = Math.max(
    1,
    ...months.map((m) => Math.abs(m.closing)),
    Math.abs(minCashBuffer)
  );

  const savePnlWithId = clientId ? savePnlAssumptions.bind(null, clientId) : null;
  const saveBsWithId = clientId ? saveBalanceSheetAssumptions.bind(null, clientId) : null;
  const prefillWithId = clientId ? prefillFromPracticePilot.bind(null, clientId) : null;

  const tabHref = (t: MainTab) =>
    `/tax-planning/cash-flow?${clientId ? `clientId=${clientId}&` : ""}scenario=${activeScenario}&tab=${t}`;

  const incOverrides = parseOverrides(assumptions?.month_income_overrides);
  const costOverrides = parseOverrides(assumptions?.month_cost_overrides);
  const currentDepMethod: DepreciationMethod =
    assumptions?.depreciation_method === "reducing_balance"
      ? "reducing_balance"
      : "straight_line";

  const pnlRows: {
    label: string;
    getter: (m: MonthProjection) => number;
    total: number;
    kind: "income" | "cost" | "subtotal" | "highlight";
  }[] = [
    { label: "Turnover", getter: (m) => m.income, total: totalRevenue12m, kind: "income" },
    {
      label: "Wages & Salaries",
      getter: (m) => -m.wages,
      total: -months.reduce((s, m) => s + m.wages, 0),
      kind: "cost",
    },
    {
      label: "Employer NI & Pension",
      getter: (m) => -m.onCosts,
      total: -months.reduce((s, m) => s + m.onCosts, 0),
      kind: "cost",
    },
    {
      label: "Rent & Premises",
      getter: (m) => -m.rent,
      total: -months.reduce((s, m) => s + m.rent, 0),
      kind: "cost",
    },
    {
      label: "Utilities",
      getter: (m) => -m.utilities,
      total: -months.reduce((s, m) => s + m.utilities, 0),
      kind: "cost",
    },
    {
      label: "Software & IT",
      getter: (m) => -m.software,
      total: -months.reduce((s, m) => s + m.software, 0),
      kind: "cost",
    },
    {
      label: "Marketing & Ads",
      getter: (m) => -m.marketing,
      total: -months.reduce((s, m) => s + m.marketing, 0),
      kind: "cost",
    },
    {
      label: "Legal & Professional",
      getter: (m) => -m.legal,
      total: -months.reduce((s, m) => s + m.legal, 0),
      kind: "cost",
    },
    {
      label: "Accountancy Fees",
      getter: (m) => -m.accountancy,
      total: -months.reduce((s, m) => s + m.accountancy, 0),
      kind: "cost",
    },
    {
      label: "Insurance",
      getter: (m) => -m.insurance,
      total: -months.reduce((s, m) => s + m.insurance, 0),
      kind: "cost",
    },
    {
      label: "Bank Charges",
      getter: (m) => -m.bankCharges,
      total: -months.reduce((s, m) => s + m.bankCharges, 0),
      kind: "cost",
    },
    {
      label: "Other Overheads",
      getter: (m) => -m.otherCosts,
      total: -months.reduce((s, m) => s + m.otherCosts, 0),
      kind: "cost",
    },
    { label: "EBITDA", getter: (m) => m.ebitda, total: totalEbitda12m, kind: "subtotal" },
    {
      label: `Depreciation (${currentDepMethod === "reducing_balance" ? "Red. Bal." : "Straight-Line"})`,
      getter: (m) => -m.depreciation,
      total: -months.reduce((s, m) => s + m.depreciation, 0),
      kind: "cost",
    },
    {
      label: "Operating Profit",
      getter: (m) => m.operatingProfit,
      total: totalOpProfit12m,
      kind: "subtotal",
    },
    {
      label: "Loan / HP Interest",
      getter: (m) => -m.financeInterest,
      total: -totalFinanceInterest12m,
      kind: "cost",
    },
    {
      label: "Profit Before Tax",
      getter: (m) => m.profitBeforeTax,
      total: totalPbt12m,
      kind: "subtotal",
    },
    {
      label: "Est. CT Charge",
      getter: (m) => -m.ctChargeAccrued,
      total: -totalCtCharge12m,
      kind: "cost",
    },
    {
      label: "Profit After Tax (PAT)",
      getter: (m) => m.netProfitAfterTax,
      total: totalNetProfit12m,
      kind: "highlight",
    },
  ];

  const finalM = months[months.length - 1];

  return (
    <div
      id="top"
      className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-emerald-50/20 print:bg-white"
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-8 py-7 flex flex-wrap items-center justify-between gap-4 print:bg-white print:text-slate-900 print:border-b print:border-slate-200">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-indigo-500/20 border border-indigo-400/30 px-3 py-0.5 text-[11px] font-semibold text-indigo-200 mb-2 print:hidden">
            <span>PracticePilot Advisory Suite</span>
            <span>·</span>
            <span className="uppercase">{activeScenario} Scenario</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Management Forecasting Pack{activeClientName ? ` — ${activeClientName}` : ""}
          </h1>
          <p className="text-sm text-slate-300 mt-0.5 print:text-slate-600">
            Configure P&amp;L assumptions, Balance Sheet &amp; Finance items, and generate the 12-month Advisory Report Pack.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {(["base", "upside", "downside"] as ScenarioKey[]).map((sc) => {
            const label = sc === "base" ? "Base" : sc === "upside" ? "Upside" : "Downside";
            const active = activeScenario === sc;
            return assumptions?.id ? (
              <form key={sc} action={setScenario.bind(null, assumptions.id, sc)}>
                <button
                  type="submit"
                  className={`rounded-xl px-4 py-2 text-xs font-semibold border transition-colors cursor-pointer ${
                    active
                      ? "bg-white text-slate-900 border-white shadow-sm"
                      : "bg-white/10 text-slate-200 border-white/15 hover:bg-white/20"
                  }`}
                >
                  {label}
                </button>
              </form>
            ) : (
              <a
                key={sc}
                href={`/tax-planning/cash-flow?${clientId ? `clientId=${clientId}&` : ""}scenario=${sc}&tab=${activeTab}`}
                className={`rounded-xl px-4 py-2 text-xs font-semibold border transition-colors ${
                  active
                    ? "bg-white text-slate-900 border-white"
                    : "bg-white/10 text-slate-200 border-white/15 hover:bg-white/20"
                }`}
              >
                {label}
              </a>
            );
          })}

          {prefillWithId && (
            <form action={prefillWithId}>
              <button
                type="submit"
                className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 transition-colors cursor-pointer"
              >
                Prefill from PracticePilot
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="p-8 max-w-6xl space-y-6">
        {/* Client Selector */}
        <form
          method="get"
          className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200/80 print:hidden"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Active Client
              </label>
              <select
                name="clientId"
                defaultValue={clientId || ""}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
              >
                <option value="">Select a client…</option>
                {(clients || []).map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.client_name}
                  </option>
                ))}
              </select>
            </div>
            <input type="hidden" name="scenario" value={activeScenario} />
            <input type="hidden" name="tab" value={activeTab} />
            <button
              type="submit"
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors cursor-pointer"
            >
              Load Client
            </button>
          </div>
        </form>

        {/* Clean 3-Tab Navigation */}
        {clientId && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3 print:hidden">
            {(
              [
                { id: "pnl-inputs", label: "1. P&L Inputs" },
                { id: "bs-inputs", label: "2. Balance Sheet & Finance" },
                { id: "report-pack", label: "3. Report Pack" },
              ] as { id: MainTab; label: string }[]
            ).map((t) => (
              <a
                key={t.id}
                href={tabHref(t.id)}
                className={`rounded-xl px-5 py-2.5 text-xs font-bold tracking-wide border transition-all ${
                  activeTab === t.id
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {t.label}
              </a>
            ))}
          </div>
        )}

        {!clientId && (
          <div className="rounded-2xl bg-white p-8 shadow-sm border border-slate-200/80 text-center text-sm text-slate-500">
            Select a client above to configure their P&amp;L inputs, Balance Sheet &amp; Finance items, and generate their Advisory Report Pack.
          </div>
        )}

        {/* =========================================================
            TAB 1: P&L INPUTS
           ========================================================= */}
        {clientId && activeTab === "pnl-inputs" && savePnlWithId && (
          <form
            action={savePnlWithId}
            className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200/80 space-y-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Profit &amp; Loss Revenue, Expenditure &amp; Tax Settings
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure recurring monthly turnover, itemized overheads, wage escalators, VAT threshold rules, and monthly overrides.
                </p>
              </div>
              <button
                type="submit"
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors cursor-pointer"
              >
                Save P&amp;L Inputs
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Forecast Start Date
                </label>
                <input
                  name="start_date"
                  type="date"
                  defaultValue={assumptions?.start_date || new Date().toISOString().slice(0, 10)}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Expected Monthly Turnover (£)
                </label>
                <input
                  name="monthly_income"
                  type="number"
                  step="0.01"
                  defaultValue={assumptions?.monthly_income ?? ""}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Estimated Corp Tax Rate (%)
                </label>
                <input
                  name="estimated_ct_rate"
                  type="number"
                  step="0.5"
                  defaultValue={estimatedCtRate * 100}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                />
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">
                Monthly Expenditure Lines (£ / month)
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Wages (£)</label>
                  <input
                    name="monthly_wages"
                    type="number"
                    step="0.01"
                    defaultValue={Number(
                      assumptions?.monthly_wages ?? assumptions?.monthly_payroll ?? 0
                    )}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    NI &amp; Pension (£)
                  </label>
                  <input
                    name="employer_ni_pension"
                    type="number"
                    step="0.01"
                    defaultValue={Number(assumptions?.employer_ni_pension ?? 0)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Rent (£)</label>
                  <input
                    name="monthly_rent"
                    type="number"
                    step="0.01"
                    defaultValue={Number(assumptions?.monthly_rent ?? 0)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Utilities (£)
                  </label>
                  <input
                    name="monthly_utilities"
                    type="number"
                    step="0.01"
                    defaultValue={Number(assumptions?.monthly_utilities ?? 0)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Software/IT (£)
                  </label>
                  <input
                    name="monthly_software"
                    type="number"
                    step="0.01"
                    defaultValue={Number(assumptions?.monthly_software ?? 0)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Marketing (£)
                  </label>
                  <input
                    name="monthly_marketing"
                    type="number"
                    step="0.01"
                    defaultValue={Number(assumptions?.monthly_marketing ?? 0)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Legal (£)</label>
                  <input
                    name="monthly_legal"
                    type="number"
                    step="0.01"
                    defaultValue={Number(assumptions?.monthly_legal ?? 0)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Accountancy (£)
                  </label>
                  <input
                    name="monthly_accountancy"
                    type="number"
                    step="0.01"
                    defaultValue={Number(assumptions?.monthly_accountancy ?? 0)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Insurance (£)
                  </label>
                  <input
                    name="monthly_insurance"
                    type="number"
                    step="0.01"
                    defaultValue={Number(assumptions?.monthly_insurance ?? 0)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Bank Charges (£)
                  </label>
                  <input
                    name="monthly_bank_charges"
                    type="number"
                    step="0.01"
                    defaultValue={Number(assumptions?.monthly_bank_charges ?? 0)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Other Overheads (£)
                  </label>
                  <input
                    name="monthly_fixed_costs"
                    type="number"
                    step="0.01"
                    defaultValue={Number(assumptions?.monthly_fixed_costs ?? 0)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Annual Wage Increase (%)
                  </label>
                  <input
                    name="wage_increase_pct"
                    type="number"
                    step="0.5"
                    defaultValue={Number(assumptions?.wage_increase_pct ?? 0)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Wage Rise Effective Month (1–12)
                  </label>
                  <input
                    name="wage_increase_month"
                    type="number"
                    min="1"
                    max="12"
                    defaultValue={Number(assumptions?.wage_increase_month ?? 6)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
                VAT Registration &amp; Return Stagger
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6 items-end">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    name="vat_enabled"
                    defaultChecked={Boolean(assumptions?.vat_enabled ?? true)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span>Calculate VAT</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    name="vat_already_registered"
                    defaultChecked={vatAlreadyRegistered}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span>VAT Registered</span>
                </label>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Prior 12m Turnover (£)
                  </label>
                  <input
                    name="prior_12m_turnover"
                    type="number"
                    step="0.01"
                    defaultValue={Number(assumptions?.prior_12m_turnover ?? 0)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    VAT Threshold (£)
                  </label>
                  <input
                    name="vat_auto_threshold"
                    type="number"
                    step="100"
                    defaultValue={vatThreshold}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    VAT Quarter Stagger
                  </label>
                  <select
                    name="vat_stagger"
                    defaultValue="3-6-9-12"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs bg-white"
                  >
                    <option value="3-6-9-12">Mar / Jun / Sep / Dec</option>
                    <option value="1-4-7-10">Jan / Apr / Jul / Oct</option>
                    <option value="2-5-8-11">Feb / May / Aug / Nov</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Quarterly VAT Override (£)
                  </label>
                  <input
                    name="quarterly_vat_estimate"
                    type="number"
                    step="0.01"
                    defaultValue={Number(assumptions?.quarterly_vat_estimate ?? 0)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Upside / Downside Revenue %
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    name="upside_income_pct"
                    type="number"
                    step="1"
                    defaultValue={Number(assumptions?.upside_income_pct ?? 15)}
                    className="rounded-xl border border-slate-200 p-2 text-xs"
                  />
                  <input
                    name="downside_income_pct"
                    type="number"
                    step="1"
                    defaultValue={Number(assumptions?.downside_income_pct ?? -15)}
                    className="rounded-xl border border-slate-200 p-2 text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Upside / Downside Cost %
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    name="upside_cost_pct"
                    type="number"
                    step="1"
                    defaultValue={Number(assumptions?.upside_cost_pct ?? 0)}
                    className="rounded-xl border border-slate-200 p-2 text-xs"
                  />
                  <input
                    name="downside_cost_pct"
                    type="number"
                    step="1"
                    defaultValue={Number(assumptions?.downside_cost_pct ?? 10)}
                    className="rounded-xl border border-slate-200 p-2 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-3">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                Seasonality Weights (% of base) &amp; Exact Monthly Overrides
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2">
                {Array.from({ length: 12 }, (_, idx) => (
                  <div key={idx}>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      {months[idx] ? months[idx].label.slice(0, 3) : `M${idx + 1}`} %
                    </label>
                    <input
                      name={`season_${idx}`}
                      type="number"
                      step="5"
                      min="0"
                      defaultValue={Math.round(
                        (parseWeights(assumptions?.seasonal_weights)[idx] ?? 1) * 100
                      )}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    />
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-[11px] font-medium text-emerald-800 mb-1">
                  Income Override (£ per month — 0 uses formula)
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2">
                  {Array.from({ length: 12 }, (_, idx) => (
                    <div key={idx}>
                      <label className="block text-[10px] text-slate-400 mb-0.5">
                        {months[idx] ? months[idx].label.slice(0, 3) : `M${idx + 1}`}
                      </label>
                      <input
                        name={`inc_ovr_${idx}`}
                        type="number"
                        step="50"
                        min="0"
                        defaultValue={incOverrides[idx] ?? 0}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-rose-800 mb-1">
                  Other Overhead Override (£ per month — 0 uses formula)
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2">
                  {Array.from({ length: 12 }, (_, idx) => (
                    <div key={idx}>
                      <label className="block text-[10px] text-slate-400 mb-0.5">
                        {months[idx] ? months[idx].label.slice(0, 3) : `M${idx + 1}`}
                      </label>
                      <input
                        name={`cost_ovr_${idx}`}
                        type="number"
                        step="50"
                        min="0"
                        defaultValue={costOverrides[idx] ?? 0}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Advisory Notes</label>
              <textarea
                name="notes"
                rows={2}
                defaultValue={assumptions?.notes || ""}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="submit"
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors cursor-pointer"
              >
                Save P&amp;L Inputs
              </button>
              <a
                href={tabHref("bs-inputs")}
                className="text-xs font-semibold text-indigo-700 hover:underline"
              >
                Next: Balance Sheet &amp; Finance →
              </a>
            </div>
          </form>
        )}

        {/* =========================================================
            TAB 2: BALANCE SHEET & FINANCE
           ========================================================= */}
        {clientId && activeTab === "bs-inputs" && saveBsWithId && (
          <div className="space-y-6">
            <form
              action={saveBsWithId}
              className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200/80 space-y-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Opening Balance Sheet, Depreciation Method, Working Capital &amp; Equity
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Set opening cash, fixed assets, depreciation policy, debtor/creditor days (0 = cash basis), share capital, retained earnings, dividends, and Month 1 loans/HP.
                  </p>
                </div>
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors cursor-pointer"
                >
                  Save Balance Sheet Drivers
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Opening Cash at Bank (£)
                  </label>
                  <input
                    name="opening_balance"
                    type="number"
                    step="0.01"
                    defaultValue={assumptions?.opening_balance ?? 0}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Minimum Cash Buffer (£)
                  </label>
                  <input
                    name="min_cash_buffer"
                    type="number"
                    step="0.01"
                    defaultValue={assumptions?.min_cash_buffer ?? 0}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Monthly Dividend Drawings (£)
                  </label>
                  <input
                    name="monthly_dividend_drawings"
                    type="number"
                    step="0.01"
                    defaultValue={Number(assumptions?.monthly_dividend_drawings ?? 0)}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">
                  Opening Fixed Assets &amp; Depreciation Policy
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Opening Fixed Assets Cost/NBV (£)
                    </label>
                    <input
                      name="opening_fixed_assets"
                      type="number"
                      step="0.01"
                      defaultValue={Number(assumptions?.opening_fixed_assets ?? 0)}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Depreciation Method
                    </label>
                    <select
                      name="depreciation_method"
                      defaultValue={currentDepMethod}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs bg-white font-semibold"
                    >
                      <option value="straight_line">Straight-Line</option>
                      <option value="reducing_balance">Reducing Balance</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Opening Dep Rate (% p.a.)
                    </label>
                    <input
                      name="opening_depreciation_rate_pct"
                      type="number"
                      step="1"
                      defaultValue={Number(assumptions?.opening_depreciation_rate_pct ?? 20)}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Fallback Monthly Dep (£)
                    </label>
                    <input
                      name="monthly_depreciation"
                      type="number"
                      step="0.01"
                      defaultValue={Number(assumptions?.monthly_depreciation ?? 0)}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Working Capital (Debtors &amp; Creditors) &amp; Capital / Reserves
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Opening Debtors (£)
                    </label>
                    <input
                      name="opening_debtors"
                      type="number"
                      step="0.01"
                      defaultValue={Number(assumptions?.opening_debtors ?? 0)}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Debtor Days (0 = Cash)
                    </label>
                    <input
                      name="debtor_days"
                      type="number"
                      min="0"
                      max="180"
                      defaultValue={Number(assumptions?.debtor_days ?? 0)}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Opening Creditors (£)
                    </label>
                    <input
                      name="opening_creditors"
                      type="number"
                      step="0.01"
                      defaultValue={Number(assumptions?.opening_creditors ?? 0)}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Creditor Days (0 = Cash)
                    </label>
                    <input
                      name="creditor_days"
                      type="number"
                      min="0"
                      max="180"
                      defaultValue={Number(assumptions?.creditor_days ?? 0)}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Share Capital (£)
                    </label>
                    <input
                      name="share_capital"
                      type="number"
                      step="0.01"
                      defaultValue={Number(assumptions?.share_capital ?? 100)}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Retained Earnings B/F (£)
                    </label>
                    <input
                      name="opening_retained_earnings"
                      type="number"
                      step="0.01"
                      defaultValue={Number(assumptions?.opening_retained_earnings ?? 0)}
                      placeholder="Auto-balances if 0"
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-violet-700">
                  Existing Opening Loan / HP (Active From Month 1)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Opening Loan/HP (£)
                    </label>
                    <input
                      name="opening_loan_hp"
                      type="number"
                      step="0.01"
                      defaultValue={Number(assumptions?.opening_loan_hp ?? 0)}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Opening Rate (% p.a.)
                    </label>
                    <input
                      name="finance_interest_rate"
                      type="number"
                      step="0.1"
                      defaultValue={Number(assumptions?.finance_interest_rate ?? 6.5)}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Remaining Term (mos)
                    </label>
                    <input
                      name="finance_term_months"
                      type="number"
                      min="1"
                      max="120"
                      defaultValue={Number(assumptions?.finance_term_months ?? 36)}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs"
                    />
                  </div>
                </div>
              </div>
            </form>

            {assumptions?.id ? (
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Mid-Year Fixed Assets */}
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200/80 space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Mid-Year Fixed Asset Additions
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Purchase month, cost (£), annual depreciation rate (%), and Straight-Line or Reducing Balance method.
                    </p>
                  </div>

                  <form
                    action={addFixedAssetAddition.bind(null, assumptions.id)}
                    className="space-y-3"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        name="title"
                        required
                        placeholder="Asset title (e.g. Van / Laptops)"
                        className="rounded-xl border border-slate-200 p-2.5 text-xs"
                      />
                      <select
                        name="month_index"
                        defaultValue="3"
                        className="rounded-xl border border-slate-200 p-2.5 text-xs bg-white"
                      >
                        {months.map((m) => (
                          <option key={m.index} value={m.index}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <input
                        name="cost"
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        placeholder="Cost (£)"
                        className="rounded-xl border border-slate-200 p-2.5 text-xs"
                      />
                      <input
                        name="depreciation_rate_pct"
                        type="number"
                        step="1"
                        min="0"
                        max="100"
                        defaultValue="20"
                        placeholder="Dep % p.a."
                        className="rounded-xl border border-slate-200 p-2.5 text-xs"
                      />
                      <select
                        name="depreciation_method"
                        defaultValue={currentDepMethod}
                        className="rounded-xl border border-slate-200 p-2.5 text-xs bg-white"
                      >
                        <option value="straight_line">Straight-Line</option>
                        <option value="reducing_balance">Reducing Bal.</option>
                      </select>
                    </div>

                    <button
                      type="submit"
                      className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 cursor-pointer"
                    >
                      + Add Fixed Asset
                    </button>
                  </form>

                  <div className="space-y-2">
                    {assetAdditions.map((asset) => {
                      const enabled = isEnabledForScenario(asset, activeScenario);
                      const m1Dep =
                        (Number(asset.cost || 0) * (Number(asset.depreciation_rate_pct || 0) / 100)) /
                        12;
                      const mLabel =
                        (asset.depreciation_method || currentDepMethod) === "reducing_balance"
                          ? "Red. Bal."
                          : "Straight-Line";
                      return (
                        <div
                          key={asset.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 p-2.5 text-xs"
                        >
                          <div>
                            <span className="font-semibold text-slate-900">{asset.title}</span>
                            <span className="text-slate-500">
                              {" "}
                              · {months[asset.month_index]?.label || `M${asset.month_index + 1}`} ·{" "}
                            </span>
                            <span className="font-semibold text-slate-800">
                              {fmt(Number(asset.cost))}
                            </span>
                            <span className="text-slate-500">
                              {" "}
                              · {Number(asset.depreciation_rate_pct)}% {mLabel} (~{fmt(m1Dep)}/mo)
                            </span>
                          </div>
                          <div className="flex gap-1.5">
                            <form
                              action={toggleFixedAssetAddition.bind(
                                null,
                                asset.id,
                                activeScenario,
                                enabled
                              )}
                            >
                              <button
                                type="submit"
                                className="rounded-lg border border-slate-200 px-2 py-1 font-semibold text-slate-700 cursor-pointer"
                              >
                                {enabled ? `On (${activeScenario})` : `Off (${activeScenario})`}
                              </button>
                            </form>
                            <form action={deleteFixedAssetAddition.bind(null, asset.id)}>
                              <button
                                type="submit"
                                className="rounded-lg bg-rose-50 px-2 py-1 font-semibold text-rose-600 cursor-pointer"
                              >
                                Delete
                              </button>
                            </form>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Mid-Year Loans & HP Agreements */}
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200/80 space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Mid-Year Loans &amp; HP Agreements
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Draws down cash in the chosen month and calculates interest &amp; principal repayments from that month onwards.
                    </p>
                  </div>

                  <form
                    action={addFinanceAddition.bind(null, assumptions.id)}
                    className="space-y-3"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        name="title"
                        required
                        placeholder="Finance title (e.g. Van HP / Loan)"
                        className="rounded-xl border border-slate-200 p-2.5 text-xs"
                      />
                      <select
                        name="month_index"
                        defaultValue="3"
                        className="rounded-xl border border-slate-200 p-2.5 text-xs bg-white"
                      >
                        {months.map((m) => (
                          <option key={m.index} value={m.index}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <input
                        name="principal"
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        placeholder="Principal (£)"
                        className="rounded-xl border border-slate-200 p-2.5 text-xs"
                      />
                      <input
                        name="interest_rate_pct"
                        type="number"
                        step="0.1"
                        min="0"
                        defaultValue="6.5"
                        placeholder="Rate % p.a."
                        className="rounded-xl border border-slate-200 p-2.5 text-xs"
                      />
                      <input
                        name="term_months"
                        type="number"
                        step="1"
                        min="1"
                        max="120"
                        defaultValue="36"
                        placeholder="Term (mos)"
                        className="rounded-xl border border-slate-200 p-2.5 text-xs"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-violet-700 cursor-pointer"
                    >
                      + Add Finance / HP
                    </button>
                  </form>

                  <div className="space-y-2">
                    {financeAdditions.map((fin) => {
                      const enabled = isEnabledForScenario(fin, activeScenario);
                      const estMoPmt = calcMonthlyRepayment(
                        Number(fin.principal || 0),
                        Number(fin.interest_rate_pct || 0),
                        Number(fin.term_months || 36)
                      );
                      return (
                        <div
                          key={fin.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 p-2.5 text-xs"
                        >
                          <div>
                            <span className="font-semibold text-slate-900">{fin.title}</span>
                            <span className="text-slate-500">
                              {" "}
                              · From {months[fin.month_index]?.label || `M${fin.month_index + 1}`} ·{" "}
                            </span>
                            <span className="font-semibold text-violet-800">
                              {fmt(Number(fin.principal))}
                            </span>
                            <span className="text-slate-500">
                              {" "}
                              · {Number(fin.interest_rate_pct)}% / {fin.term_months}m ({fmt(estMoPmt)}
                              /mo)
                            </span>
                          </div>
                          <div className="flex gap-1.5">
                            <form
                              action={toggleFinanceAddition.bind(
                                null,
                                fin.id,
                                activeScenario,
                                enabled
                              )}
                            >
                              <button
                                type="submit"
                                className="rounded-lg border border-slate-200 px-2 py-1 font-semibold text-slate-700 cursor-pointer"
                              >
                                {enabled ? `On (${activeScenario})` : `Off (${activeScenario})`}
                              </button>
                            </form>
                            <form action={deleteFinanceAddition.bind(null, fin.id)}>
                              <button
                                type="submit"
                                className="rounded-lg bg-rose-50 px-2 py-1 font-semibold text-rose-600 cursor-pointer"
                              >
                                Delete
                              </button>
                            </form>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-amber-50 p-4 border border-amber-200 text-xs text-amber-900">
                Click <strong>Save Balance Sheet Drivers</strong> above first to unlock Mid-Year Fixed Assets, Loans/HP, and One-Off Cash Events.
              </div>
            )}

            {/* Microforecasts & One-Off Cash Events */}
            {assumptions?.id && (
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200/80 space-y-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Microforecasts &amp; One-Off Cash Events
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Add non-asset one-off cash inflows (+2000) or outflows (-1500) in any month.
                  </p>
                </div>

                <form
                  action={addMicroforecast.bind(null, assumptions.id)}
                  className="grid gap-2 sm:grid-cols-4"
                >
                  <input
                    name="title"
                    required
                    placeholder="Item title"
                    className="sm:col-span-2 rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                  <select
                    name="month_index"
                    defaultValue="0"
                    className="rounded-xl border border-slate-200 p-2.5 text-xs bg-white"
                  >
                    {months.map((m) => (
                      <option key={m.index} value={m.index}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    required
                    placeholder="-1500 or +2000"
                    className="rounded-xl border border-slate-200 p-2.5 text-xs"
                  />
                  <button
                    type="submit"
                    className="sm:col-span-4 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 cursor-pointer"
                  >
                    + Add Cash Event
                  </button>
                </form>

                <div className="space-y-2">
                  {items.map((item) => {
                    const enabled = isEnabledForScenario(item, activeScenario);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 p-2.5 text-xs"
                      >
                        <div>
                          <span className="font-semibold text-slate-900">{item.title}</span>
                          <span className="text-slate-500">
                            {" "}
                            · {months[item.month_index]?.label || `M${item.month_index + 1}`} ·{" "}
                          </span>
                          <span
                            className={
                              Number(item.amount) >= 0
                                ? "text-emerald-700 font-semibold"
                                : "text-rose-600 font-semibold"
                            }
                          >
                            {fmt(Number(item.amount))}
                          </span>
                        </div>
                        <div className="flex gap-1.5">
                          <form
                            action={toggleMicroforecast.bind(null, item.id, activeScenario, enabled)}
                          >
                            <button
                              type="submit"
                              className="rounded-lg border border-slate-200 px-2 py-1 font-semibold text-slate-700 cursor-pointer"
                            >
                              {enabled ? `On (${activeScenario})` : `Off (${activeScenario})`}
                            </button>
                          </form>
                          <form action={deleteMicroforecast.bind(null, item.id)}>
                            <button
                              type="submit"
                              className="rounded-lg bg-rose-50 px-2 py-1 font-semibold text-rose-600 cursor-pointer"
                            >
                              Delete
                            </button>
                          </form>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <a
                href={tabHref("pnl-inputs")}
                className="text-xs font-semibold text-slate-600 hover:underline"
              >
                ← Back to P&amp;L Inputs
              </a>
              <a
                href={tabHref("report-pack")}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
              >
                Generate Report Pack →
              </a>
            </div>
          </div>
        )}

        {/* =========================================================
            TAB 3: REPORT PACK (KPIs, Scenarios, Cash Flow, P&L, BS)
           ========================================================= */}
        {clientId && activeTab === "report-pack" && (
          <div className="space-y-6">
            {!assumptions && (
              <div className="rounded-2xl bg-white p-8 shadow-sm border border-slate-200/80 text-center space-y-3">
                <p className="text-sm text-slate-600">
                  No forecast assumptions saved yet for <strong>{activeClientName}</strong>.
                </p>
                <div className="flex justify-center gap-3">
                  <a
                    href={tabHref("pnl-inputs")}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    Enter P&amp;L Inputs
                  </a>
                  {prefillWithId && (
                    <form action={prefillWithId}>
                      <button
                        type="submit"
                        className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                      >
                        Prefill from PracticePilot
                      </button>
                    </form>
                  )}
                </div>
              </div>
            )}

            {currentSummary && finalM && (
              <>
                {/* KPI Cards */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div
                    className={`rounded-2xl p-5 shadow-sm border ${
                      currentSummary.lowestCash < 0
                        ? "bg-gradient-to-br from-rose-50 to-red-100/70 border-rose-200"
                        : currentSummary.lowestCash < minCashBuffer
                        ? "bg-gradient-to-br from-amber-50 to-yellow-100/70 border-amber-200"
                        : "bg-gradient-to-br from-emerald-50 to-teal-100/70 border-emerald-200"
                    }`}
                  >
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      Lowest Cash Balance
                    </p>
                    <p className="text-2xl font-extrabold text-slate-900 mt-1">
                      {fmt(currentSummary.lowestCash)}
                    </p>
                    <p className="text-xs text-slate-700 mt-1">
                      In <strong>{currentSummary.lowestMonthLabel}</strong>
                    </p>
                  </div>

                  <div className="rounded-2xl bg-gradient-to-br from-indigo-50 to-blue-100/60 p-5 shadow-sm border border-indigo-200/80">
                    <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">
                      Operating Margin (12M)
                    </p>
                    <p className="text-2xl font-extrabold text-slate-900 mt-1">
                      {opMarginPct.toFixed(1)}%
                    </p>
                    <p className="text-xs text-slate-700 mt-1">
                      PAT: <strong className="text-emerald-800">{fmt(totalNetProfit12m)}</strong>
                    </p>
                  </div>

                  <div className="rounded-2xl bg-gradient-to-br from-violet-50 to-purple-100/60 p-5 shadow-sm border border-violet-200/80">
                    <p className="text-xs font-bold uppercase tracking-wider text-violet-700">
                      Avg Monthly Cash Delta
                    </p>
                    <p
                      className={`text-2xl font-extrabold mt-1 ${
                        avgMonthlyNetCash < 0 ? "text-rose-700" : "text-slate-900"
                      }`}
                    >
                      {fmt(avgMonthlyNetCash)}
                    </p>
                    <p className="text-xs text-slate-700 mt-1">
                      Closing: <strong>{fmt(currentSummary.closingCash12m)}</strong>
                    </p>
                  </div>

                  <div className="rounded-2xl bg-gradient-to-br from-cyan-50 to-sky-100/60 p-5 shadow-sm border border-cyan-200/80">
                    <p className="text-xs font-bold uppercase tracking-wider text-cyan-800">
                      Buffer Runway
                    </p>
                    <p className="text-2xl font-extrabold text-slate-900 mt-1">
                      {monthsAboveBuffer} / 12 mos
                    </p>
                    <p className="text-xs text-slate-700 mt-1">
                      At or above {fmt(minCashBuffer)} buffer
                    </p>
                  </div>
                </div>

                {/* Scenario Comparison */}
                {scenarioSummaries && (
                  <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200/80 overflow-x-auto">
                    <h2 className="text-base font-bold text-slate-900 mb-3">
                      Scenario Comparison (Base vs. Upside vs. Downside)
                    </h2>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-slate-500 border-b border-slate-200">
                          <th className="py-2.5 pr-4">Scenario</th>
                          <th className="py-2.5 pr-4">Lowest Cash</th>
                          <th className="py-2.5 pr-4">12M Closing Cash</th>
                          <th className="py-2.5 pr-4">12M Operating Profit</th>
                          <th className="py-2.5 pr-4">12M Profit After Tax</th>
                          <th className="py-2.5 pr-4">Months Below Buffer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(["base", "upside", "downside"] as ScenarioKey[]).map((key) => {
                          const s = scenarioSummaries[key];
                          return (
                            <tr
                              key={key}
                              className={`border-b border-slate-100 ${
                                activeScenario === key ? "bg-indigo-50/50 font-medium" : ""
                              }`}
                            >
                              <td className="py-2.5 pr-4 font-bold text-slate-900">{s.label}</td>
                              <td
                                className={`py-2.5 pr-4 ${
                                  s.lowestCash < 0 ? "text-rose-600 font-semibold" : "text-slate-800"
                                }`}
                              >
                                {fmt(s.lowestCash)} ({s.lowestMonthLabel.slice(0, 3)})
                              </td>
                              <td
                                className={`py-2.5 pr-4 font-semibold ${
                                  s.closingCash12m < 0 ? "text-rose-600" : "text-emerald-700"
                                }`}
                              >
                                {fmt(s.closingCash12m)}
                              </td>
                              <td className="py-2.5 pr-4">{fmt(s.operatingProfit12m)}</td>
                              <td className="py-2.5 pr-4">{fmt(s.netProfit12m)}</td>
                              <td className="py-2.5 pr-4">{s.bufferBreaches}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* VAT Alert + Quick Levers */}
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl bg-white p-5 shadow-sm border border-indigo-100">
                    <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                      VAT Registration Threshold ({fmt(vatThreshold)})
                    </p>
                    {vatAlreadyRegistered ? (
                      <p className="text-sm text-slate-800 mt-1.5">
                        Client is <strong className="text-indigo-700">VAT-registered</strong> across
                        the projection.
                      </p>
                    ) : breachMonth ? (
                      <p className="text-sm text-slate-800 mt-1.5">
                        Breaches <strong className="text-rose-600">{fmt(vatThreshold)}</strong> in{" "}
                        <strong>{breachMonth.label}</strong>; VAT registration effective from{" "}
                        <strong className="text-indigo-700">
                          {effectiveVatMonth?.label || "2 months post-breach"}
                        </strong>
                        .
                      </p>
                    ) : (
                      <p className="text-sm text-slate-600 mt-1.5">
                        Does not breach <strong>{fmt(vatThreshold)}</strong> rolling 12m turnover
                        within the next 12 months.
                      </p>
                    )}
                  </div>

                  <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200/80 print:hidden">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                      Quick What-If Advisory Levers
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <form action={applyWhatIfPreset.bind(null, assumptions.id, "hire_2800")}>
                        <button
                          type="submit"
                          className="rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 cursor-pointer"
                        >
                          + New Hire (−£2.8k/mo)
                        </button>
                      </form>
                      <form action={applyWhatIfPreset.bind(null, assumptions.id, "rev_dip_20")}>
                        <button
                          type="submit"
                          className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 cursor-pointer"
                        >
                          −20% Revenue Stress
                        </button>
                      </form>
                      <form action={applyWhatIfPreset.bind(null, assumptions.id, "capex_5000")}>
                        <button
                          type="submit"
                          className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 cursor-pointer"
                        >
                          + £5k Asset (20% Dep)
                        </button>
                      </form>
                      <form action={applyWhatIfPreset.bind(null, assumptions.id, "div_stress")}>
                        <button
                          type="submit"
                          className="rounded-lg bg-violet-50 border border-violet-200 px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-100 cursor-pointer"
                        >
                          +25% Dividend Draw
                        </button>
                      </form>
                    </div>
                  </div>
                </div>

                {/* Cash Trajectory Chart */}
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200/80">
                  <h2 className="text-base font-bold text-slate-900">
                    12-Month Closing Cash Trajectory
                  </h2>
                  <div className="mt-5 grid grid-cols-12 gap-2 items-end h-44 border-b border-slate-100 pb-2">
                    {months.map((m) => {
                      const heightPct = Math.max(
                        6,
                        Math.round((Math.abs(m.closing) / maxAbsClosing) * 100)
                      );
                      const barClass =
                        m.closing < 0
                          ? "bg-rose-500"
                          : m.closing < minCashBuffer
                          ? "bg-amber-400"
                          : "bg-indigo-600";
                      return (
                        <div key={m.index} className="flex flex-col items-center h-full justify-end">
                          <span className="text-[10px] font-semibold text-slate-600 mb-1">
                            {Math.round(m.closing).toLocaleString("en-GB")}
                          </span>
                          <div
                            className={`w-full max-w-[34px] rounded-t-lg ${barClass}`}
                            style={{ height: `${heightPct}%` }}
                            title={`${m.label}: ${fmt(m.closing)}`}
                          />
                          <span className="text-[10px] text-slate-500 mt-2 truncate w-full text-center">
                            {m.label.slice(0, 3)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Statement 1: 12-Month Cash Flow */}
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200/80 overflow-x-auto">
                  <h2 className="text-lg font-bold text-slate-900 mb-4">
                    1. 12-Month Cash Flow Projection
                  </h2>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="py-3 pr-4">Month</th>
                        <th className="py-3 pr-4">Opening</th>
                        <th className="py-3 pr-4">+ Receipts / Loan</th>
                        <th className="py-3 pr-4">− Costs, HP &amp; CapEx</th>
                        <th className="py-3 pr-4">− Dividends</th>
                        <th className="py-3 pr-4">− VAT Due</th>
                        <th className="py-3 pr-4">− Tax Due</th>
                        <th className="py-3 pr-4">± One-Offs</th>
                        <th className="py-3 pr-4">Closing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {months.map((m) => {
                        const oneOffSum = m.oneOffs.reduce((s, o) => s + o.amount, 0);
                        const totalInflows = m.cashCollectedFromSales + m.financeDrawdown;
                        const totalOutflows =
                          m.cashPaidForCosts + m.financeTotalPayment + m.assetCapexOutflow;
                        return (
                          <tr
                            key={m.index}
                            className={`border-b border-slate-100 ${
                              m.closing < 0 ? "bg-rose-50/70" : ""
                            }`}
                          >
                            <td className="py-3 pr-4 font-medium whitespace-nowrap">
                              <div>{m.label}</div>
                              <div className="text-[11px] text-slate-400">
                                Rolling 12m: {fmt(m.rolling12mTurnover)}
                                {m.vatRegisteredThisMonth ? " · VAT Reg" : ""}
                              </div>
                            </td>
                            <td className="py-3 pr-4">{fmt(m.opening)}</td>
                            <td className="py-3 pr-4 text-emerald-700 font-medium">
                              <div>{fmt(totalInflows)}</div>
                              {m.financeDrawdown > 0 && (
                                <div className="text-[11px] text-indigo-600">
                                  Incl. loan {fmt(m.financeDrawdown)}
                                </div>
                              )}
                            </td>
                            <td className="py-3 pr-4 text-rose-600">
                              <div>({fmt(totalOutflows)})</div>
                              {m.assetCapexOutflow > 0 && (
                                <div className="text-[11px] text-amber-700">
                                  CapEx: {fmt(m.assetCapexOutflow)}
                                </div>
                              )}
                              {m.financeTotalPayment > 0 && (
                                <div className="text-[11px] text-slate-500">
                                  HP/Loan: {fmt(m.financeTotalPayment)}
                                </div>
                              )}
                            </td>
                            <td className="py-3 pr-4 text-rose-600">
                              {m.dividends > 0 ? `(${fmt(m.dividends)})` : "—"}
                            </td>
                            <td className="py-3 pr-4 text-rose-600">
                              {m.vatDue > 0 ? (
                                <div>
                                  <p>({fmt(m.vatDue)})</p>
                                  {m.vatDueDates.map((d, j) => (
                                    <p key={j} className="text-[11px] text-slate-500">
                                      {d}
                                    </p>
                                  ))}
                                </div>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-3 pr-4 text-rose-600">
                              {m.taxDue.length > 0 ? (
                                <div>
                                  {m.taxDue.map((t, j) => (
                                    <p key={j} className="text-xs">
                                      ({fmt(t.amount)}) — {t.label}
                                    </p>
                                  ))}
                                </div>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td
                              className={`py-3 pr-4 text-xs font-medium ${
                                oneOffSum > 0
                                  ? "text-emerald-700"
                                  : oneOffSum < 0
                                  ? "text-rose-600"
                                  : "text-slate-400"
                              }`}
                            >
                              {oneOffSum !== 0 ? (
                                <div>
                                  <p>{fmt(oneOffSum)}</p>
                                  {m.oneOffs.map((o, idx) => (
                                    <p key={idx} className="text-[11px] text-slate-500">
                                      {o.title}
                                    </p>
                                  ))}
                                </div>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td
                              className={`py-3 pr-4 font-bold ${
                                m.closing < 0 ? "text-rose-700" : "text-slate-900"
                              }`}
                            >
                              {fmt(m.closing)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Statement 2: Detailed 12-Month Profit & Loss */}
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200/80 overflow-x-auto">
                  <h2 className="text-lg font-bold text-slate-900 mb-1">
                    2. Detailed 12-Month Profit &amp; Loss
                  </h2>
                  <p className="text-xs text-slate-500 mb-4">
                    Full itemized expenditure, depreciation, and loan/HP interest.
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="py-3 pr-4">Line</th>
                        {months.map((m) => (
                          <th key={m.index} className="py-3 pr-4 whitespace-nowrap">
                            {m.label.slice(0, 3)}
                          </th>
                        ))}
                        <th className="py-3 pr-4 font-bold text-slate-900">12M Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pnlRows.map((row, rIdx) => {
                        const rowCls =
                          row.kind === "income"
                            ? "border-b border-slate-100 bg-emerald-50/30"
                            : row.kind === "subtotal"
                            ? "border-b border-slate-100 bg-indigo-50/30"
                            : row.kind === "highlight"
                            ? "bg-emerald-50/70"
                            : "border-b border-slate-100";

                        const labelCls =
                          row.kind === "income"
                            ? "py-2.5 pr-4 font-semibold text-emerald-900 whitespace-nowrap"
                            : row.kind === "subtotal"
                            ? "py-2.5 pr-4 font-bold text-slate-900 whitespace-nowrap"
                            : row.kind === "highlight"
                            ? "py-3 pr-4 font-extrabold text-emerald-950 whitespace-nowrap"
                            : "py-2.5 pr-4 text-slate-700 whitespace-nowrap";

                        return (
                          <tr key={rIdx} className={rowCls}>
                            <td className={labelCls}>{row.label}</td>
                            {months.map((m) => {
                              const val = row.getter(m);
                              const formatted =
                                val === 0 ? "—" : val < 0 ? `(${fmt(Math.abs(val))})` : fmt(val);
                              const cellCls =
                                row.kind === "highlight"
                                  ? `py-3 pr-4 font-bold ${
                                      val < 0 ? "text-rose-700" : "text-emerald-800"
                                    }`
                                  : row.kind === "subtotal"
                                  ? `py-2.5 pr-4 font-semibold ${
                                      val < 0 ? "text-rose-600" : "text-slate-900"
                                    }`
                                  : val < 0
                                  ? "py-2.5 pr-4 text-rose-600"
                                  : "py-2.5 pr-4 text-emerald-700 font-medium";

                              return (
                                <td key={m.index} className={cellCls}>
                                  {formatted}
                                </td>
                              );
                            })}
                            <td
                              className={`py-2.5 pr-4 font-bold ${
                                row.total < 0
                                  ? "text-rose-700"
                                  : row.kind === "highlight"
                                  ? "text-emerald-900 font-extrabold"
                                  : "text-slate-900"
                              }`}
                            >
                              {row.total < 0 ? `(${fmt(Math.abs(row.total))})` : fmt(row.total)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Statement 3: Expanded 12-Month Balance Sheet */}
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200/80 overflow-x-auto">
                  <h2 className="text-lg font-bold text-slate-900 mb-1">
                    3. Detailed 12-Month Balance Sheet
                  </h2>
                  <p className="text-xs text-slate-500 mb-4">
                    Fixed Assets (Cost, Accumulated Depreciation, NBV), Current Assets, Liabilities, and Capital &amp; Reserves (Share Capital, Retained Earnings, PAT, Dividends).
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="py-3 pr-4">Line</th>
                        {months.map((m) => (
                          <th key={m.index} className="py-3 pr-4 whitespace-nowrap">
                            {m.label.slice(0, 3)}
                          </th>
                        ))}
                        <th className="py-3 pr-4 font-bold text-slate-900">12M End</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* FIXED ASSETS */}
                      <tr className="bg-slate-50/80 border-b border-slate-200">
                        <td
                          colSpan={14}
                          className="py-1.5 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-500"
                        >
                          Fixed Assets
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 pr-4 text-slate-700 whitespace-nowrap">
                          Fixed Assets — Cost
                        </td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2 pr-4 text-slate-700">
                            {fmt(m.fixedAssetsCost)}
                          </td>
                        ))}
                        <td className="py-2 pr-4 font-semibold text-slate-800">
                          {fmt(finalM.fixedAssetsCost)}
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 pr-4 text-rose-600 whitespace-nowrap">
                          Less: Accumulated Depreciation
                        </td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2 pr-4 text-rose-600">
                            {m.accumulatedDepreciation > 0
                              ? `(${fmt(m.accumulatedDepreciation)})`
                              : "—"}
                          </td>
                        ))}
                        <td className="py-2 pr-4 font-semibold text-rose-700">
                          {finalM.accumulatedDepreciation > 0
                            ? `(${fmt(finalM.accumulatedDepreciation)})`
                            : "—"}
                        </td>
                      </tr>
                      <tr className="border-b border-slate-200 bg-slate-50/40">
                        <td className="py-2.5 pr-4 font-semibold text-slate-900 whitespace-nowrap">
                          Fixed Assets — Net Book Value (NBV)
                        </td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2.5 pr-4 font-semibold text-slate-900">
                            {fmt(m.fixedAssetsNbv)}
                          </td>
                        ))}
                        <td className="py-2.5 pr-4 font-bold text-slate-900">
                          {fmt(finalM.fixedAssetsNbv)}
                        </td>
                      </tr>

                      {/* CURRENT ASSETS */}
                      <tr className="bg-slate-50/80 border-b border-slate-200">
                        <td
                          colSpan={14}
                          className="py-1.5 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-500"
                        >
                          Current Assets
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 pr-4 font-medium text-slate-800 whitespace-nowrap">
                          Cash at Bank
                        </td>
                        {months.map((m) => (
                          <td
                            key={m.index}
                            className={`py-2 pr-4 ${
                              m.closing < 0 ? "text-rose-600 font-semibold" : "text-slate-900"
                            }`}
                          >
                            {fmt(m.closing)}
                          </td>
                        ))}
                        <td className="py-2 pr-4 font-bold text-slate-900">{fmt(finalM.closing)}</td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 pr-4 text-slate-700 whitespace-nowrap">Trade Debtors</td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2 pr-4 text-slate-700">
                            {fmt(m.debtors)}
                          </td>
                        ))}
                        <td className="py-2 pr-4 font-semibold text-slate-800">
                          {fmt(finalM.debtors)}
                        </td>
                      </tr>
                      <tr className="border-b border-slate-200 bg-indigo-50/40">
                        <td className="py-2.5 pr-4 font-bold text-indigo-950 whitespace-nowrap">
                          Total Assets
                        </td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2.5 pr-4 font-bold text-indigo-950">
                            {fmt(m.totalAssets)}
                          </td>
                        ))}
                        <td className="py-2.5 pr-4 font-extrabold text-indigo-950">
                          {fmt(finalM.totalAssets)}
                        </td>
                      </tr>

                      {/* LIABILITIES */}
                      <tr className="bg-slate-50/80 border-b border-slate-200">
                        <td
                          colSpan={14}
                          className="py-1.5 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-500"
                        >
                          Liabilities
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 pr-4 text-rose-700 font-medium whitespace-nowrap">
                          Loans &amp; HP Finance
                        </td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2 pr-4 text-rose-700">
                            {m.loanHpBalance > 0 ? fmt(m.loanHpBalance) : "—"}
                          </td>
                        ))}
                        <td className="py-2 pr-4 font-semibold text-rose-800">
                          {fmt(finalM.loanHpBalance)}
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 pr-4 text-slate-700 whitespace-nowrap">VAT Creditor</td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2 pr-4 text-slate-700">
                            {fmt(m.vatCreditor)}
                          </td>
                        ))}
                        <td className="py-2 pr-4 font-semibold text-slate-800">
                          {fmt(finalM.vatCreditor)}
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 pr-4 text-slate-700 whitespace-nowrap">CT Creditor</td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2 pr-4 text-slate-700">
                            {fmt(m.ctCreditor)}
                          </td>
                        ))}
                        <td className="py-2 pr-4 font-semibold text-slate-800">
                          {fmt(finalM.ctCreditor)}
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 pr-4 text-slate-700 whitespace-nowrap">
                          Trade Creditors
                        </td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2 pr-4 text-slate-700">
                            {fmt(m.tradeCreditors)}
                          </td>
                        ))}
                        <td className="py-2 pr-4 font-semibold text-slate-800">
                          {fmt(finalM.tradeCreditors)}
                        </td>
                      </tr>
                      <tr className="border-b border-slate-200 bg-rose-50/30">
                        <td className="py-2.5 pr-4 font-semibold text-rose-900 whitespace-nowrap">
                          Total Liabilities
                        </td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2.5 pr-4 font-semibold text-rose-900">
                            {fmt(m.totalLiabilities)}
                          </td>
                        ))}
                        <td className="py-2.5 pr-4 font-bold text-rose-900">
                          {fmt(finalM.totalLiabilities)}
                        </td>
                      </tr>
                      <tr className="border-b border-slate-200 bg-indigo-50/30">
                        <td className="py-2.5 pr-4 font-bold text-slate-900 whitespace-nowrap">
                          Net Assets
                        </td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2.5 pr-4 font-bold text-slate-900">
                            {fmt(m.netAssets)}
                          </td>
                        ))}
                        <td className="py-2.5 pr-4 font-extrabold text-slate-900">
                          {fmt(finalM.netAssets)}
                        </td>
                      </tr>

                      {/* CAPITAL & RESERVES */}
                      <tr className="bg-slate-50/80 border-b border-slate-200">
                        <td
                          colSpan={14}
                          className="py-1.5 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-500"
                        >
                          Capital &amp; Reserves
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 pr-4 text-slate-700 whitespace-nowrap">
                          Called-Up Share Capital
                        </td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2 pr-4 text-slate-700">
                            {fmt(m.shareCapital)}
                          </td>
                        ))}
                        <td className="py-2 pr-4 font-semibold text-slate-800">
                          {fmt(finalM.shareCapital)}
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 pr-4 text-slate-700 whitespace-nowrap">
                          Retained Earnings B/F
                        </td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2 pr-4 text-slate-700">
                            {fmt(m.retainedEarningsBf)}
                          </td>
                        ))}
                        <td className="py-2 pr-4 font-semibold text-slate-800">
                          {fmt(finalM.retainedEarningsBf)}
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 pr-4 text-emerald-700 whitespace-nowrap">
                          Profit After Tax (YTD)
                        </td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2 pr-4 text-emerald-700">
                            {fmt(m.ytdNetProfit + m.ytdOneOffs)}
                          </td>
                        ))}
                        <td className="py-2 pr-4 font-semibold text-emerald-800">
                          {fmt(finalM.ytdNetProfit + finalM.ytdOneOffs)}
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 pr-4 text-rose-600 whitespace-nowrap">
                          Less: Dividends Paid (YTD)
                        </td>
                        {months.map((m) => (
                          <td key={m.index} className="py-2 pr-4 text-rose-600">
                            {m.ytdDividends > 0 ? `(${fmt(m.ytdDividends)})` : "—"}
                          </td>
                        ))}
                        <td className="py-2 pr-4 font-semibold text-rose-700">
                          {finalM.ytdDividends > 0 ? `(${fmt(finalM.ytdDividends)})` : "—"}
                        </td>
                      </tr>
                      <tr className="bg-emerald-50/70">
                        <td className="py-3 pr-4 font-extrabold text-emerald-950 whitespace-nowrap">
                          Total Capital &amp; Reserves
                        </td>
                        {months.map((m) => (
                          <td
                            key={m.index}
                            className={`py-3 pr-4 font-bold ${
                              m.equity < 0 ? "text-rose-700" : "text-emerald-800"
                            }`}
                          >
                            {fmt(m.equity)}
                          </td>
                        ))}
                        <td className="py-3 pr-4 font-extrabold text-emerald-900">
                          {fmt(finalM.equity)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Saved Pack Snapshots */}
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200/80 space-y-4 print:hidden">
                  <h2 className="text-base font-bold text-slate-900">Saved Pack Snapshots</h2>
                  <form
                    action={saveSnapshot.bind(
                      null,
                      clientId,
                      assumptions.id,
                      activeScenario,
                      currentSummary.lowestCash,
                      currentSummary.closingCash12m,
                      currentSummary.netProfit12m
                    )}
                    className="flex gap-2"
                  >
                    <input
                      name="snapshot_name"
                      placeholder="e.g. Q4 Advisory Review"
                      className="flex-1 rounded-xl border border-slate-200 p-2.5 text-xs"
                    />
                    <button
                      type="submit"
                      className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 cursor-pointer"
                    >
                      Save Snapshot
                    </button>
                  </form>

                  <div className="space-y-2">
                    {snapshots.map((sn) => (
                      <div
                        key={sn.id}
                        className="rounded-xl border border-slate-100 p-2.5 text-xs flex items-center justify-between"
                      >
                        <div>
                          <p className="font-semibold text-slate-900">{sn.snapshot_name}</p>
                          <p className="text-[11px] text-slate-500">
                            {sn.scenario.toUpperCase()} · Lowest: {fmt(Number(sn.lowest_cash))} ·
                            12M Cash: {fmt(Number(sn.closing_cash_12m))}
                          </p>
                        </div>
                        <span className="text-[11px] text-slate-400">
                          {new Date(sn.created_at).toLocaleDateString("en-GB")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}