import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FILTERS: Record<string, { label: string; test: (d: any) => boolean }> = {
  wip: { label: "Unbilled work (WIP)", test: (d) => d.wip > 0 },
  invoiced: { label: "Invoiced", test: (d) => d.invoicedAmount > 0 },
  paid: { label: "Paid", test: (d) => d.paidAmount > 0 },
  writtenoff: { label: "Written off", test: (d) => d.writtenOffAmount > 0 },
  overbudget: { label: "Over budget", test: (d) => d.overBudget },
  "status-Draft": { label: "Draft", test: (d) => !d.isGeneral && d.job.status === "Draft" },
  "status-Active": { label: "Active", test: (d) => !d.isGeneral && d.job.status === "Active" },
  "status-On Hold": { label: "On Hold", test: (d) => !d.isGeneral && d.job.status === "On Hold" },
  "status-Completed": { label: "Completed", test: (d) => !d.isGeneral && d.job.status === "Completed" },
  "status-Cancelled": { label: "Cancelled", test: (d) => !d.isGeneral && d.job.status === "Cancelled" },
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STAFF_PERIODS: Record<string, string> = {
  month: "This Month",
  quarter: "This Quarter",
  year: "This Year",
  all: "All Time",
};

function isWithinPeriod(dateStr: string | null, period: string, now: Date): boolean {
  if (period === "all") return true;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (period === "month") {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  if (period === "quarter") {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const dQuarter = Math.floor(d.getMonth() / 3);
    return d.getFullYear() === now.getFullYear() && dQuarter === currentQuarter;
  }
  if (period === "year") {
    return d.getFullYear() === now.getFullYear();
  }
  return true;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; client?: string; staffPeriod?: string }>;
}) {
  const { filter, client: clientFilterId, staffPeriod } = await searchParams;
  const activeFilter = filter && FILTERS[filter] ? filter : null;
  const activeStaffPeriod = staffPeriod && STAFF_PERIODS[staffPeriod] ? staffPeriod : "all";

  const [
    { data: jobs },
    { data: entries },
    { data: invoices },
    { data: writeoffs },
    { data: clientsList },
  ] = await Promise.all([
    supabase
      .from("jobs")
      .select("*, clients(client_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("time_entries")
      .select("*"),
    supabase
      .from("invoices")
      .select("*"),
    supabase
      .from("wip_writeoffs")
      .select("*"),
    supabase
      .from("clients")
      .select("id, client_name"),
  ]);

  const clientNameMap = new Map((clientsList || []).map((c) => [c.id, c.client_name]));

  const wipData = (jobs || []).map((job) => {
    const jobEntries = (entries || []).filter(e => e.job_id === job.id);
    const totalHours = jobEntries.reduce((sum, e) => sum + Number(e.hours), 0);
    const billableHours = jobEntries.filter(e => e.billable).reduce((sum, e) => sum + Number(e.hours), 0);
    const chargeOutValue = jobEntries.filter(e => e.billable).reduce((sum, e) => sum + (Number(e.hours) * Number(e.hourly_rate)), 0);

    const jobInvoices = (invoices || []).filter(i => i.job_id === job.id);
    const invoicedAmount = jobInvoices.reduce((sum, i) => sum + Number(i.subtotal || 0), 0);
    const paidAmount = jobInvoices.filter(i => i.status === "Paid").reduce((sum, i) => sum + Number(i.subtotal || 0), 0);

    const jobWriteoffs = (writeoffs || []).filter(w => w.job_id === job.id);
    const writtenOffAmount = jobWriteoffs.reduce((sum, w) => sum + Number(w.amount), 0);

    const wip = chargeOutValue - invoicedAmount - writtenOffAmount;
    const overBudget = invoicedAmount > 0 && chargeOutValue > invoicedAmount;
    const hasActivity = totalHours > 0 || invoicedAmount > 0 || writtenOffAmount > 0;

    return {
      key: `job-${job.id}`,
      isGeneral: false,
      job,
      clientId: job.client_id,
      clientName: job.clients?.client_name || "Unknown",
      jobType: job.job_type || "Other",
      totalHours,
      billableHours,
      chargeOutValue,
      invoicedAmount,
      paidAmount,
      writtenOffAmount,
      wip: Math.max(wip, 0),
      overBudget,
      hasActivity,
    };
  });

  const generalEntries = (entries || []).filter(e => !e.job_id && e.client_id);
  const generalByClient = new Map<string, typeof generalEntries>();
  generalEntries.forEach((e) => {
    const list = generalByClient.get(e.client_id) || [];
    list.push(e);
    generalByClient.set(e.client_id, list);
  });

  const generalRows = Array.from(generalByClient.entries()).map(([clientId, clientEntries]) => {
    const totalHours = clientEntries.reduce((sum, e) => sum + Number(e.hours), 0);
    const billableHours = clientEntries.filter(e => e.billable).reduce((sum, e) => sum + Number(e.hours), 0);
    const chargeOutValue = clientEntries.filter(e => e.billable).reduce((sum, e) => sum + (Number(e.hours) * Number(e.hourly_rate)), 0);

    return {
      key: `general-${clientId}`,
      isGeneral: true,
      job: null as any,
      clientId,
      clientName: clientNameMap.get(clientId) || "Unknown",
      jobType: "General / Not job-linked",
      totalHours,
      billableHours,
      chargeOutValue,
      invoicedAmount: 0,
      paidAmount: 0,
      writtenOffAmount: 0,
      wip: Math.max(chargeOutValue, 0),
      overBudget: false,
      hasActivity: totalHours > 0,
    };
  }).filter(d => d.totalHours > 0);

  const allRows = [...wipData, ...generalRows];

  const activityRows = allRows.filter(d => d.hasActivity);

  const totalWIP = activityRows.reduce((sum, d) => sum + d.wip, 0);
  const totalInvoiced = activityRows.reduce((sum, d) => sum + d.invoicedAmount, 0);
  const totalPaid = activityRows.reduce((sum, d) => sum + d.paidAmount, 0);
  const totalWrittenOff = activityRows.reduce((sum, d) => sum + d.writtenOffAmount, 0);
  const overBudgetJobs = wipData.filter(d => d.overBudget).length;

  const statusCounts = ["Draft", "Active", "On Hold", "Completed", "Cancelled"].map((status) => ({
    status,
    count: (jobs || []).filter((j) => j.status === status).length,
  }));

  // Job Summary display rows — client filter takes priority over status/wip filter,
  // since they represent two different drill-down paths into the same table.
  let displayRows = activeFilter ? allRows.filter(FILTERS[activeFilter].test) : activityRows;
  let displayFilterLabel: string | null = activeFilter ? FILTERS[activeFilter].label : null;
  if (clientFilterId) {
    displayRows = allRows.filter((d) => d.clientId === clientFilterId);
    displayFilterLabel = `Client: ${clientNameMap.get(clientFilterId) || "Unknown"}`;
  }

  // --- Practice Overview: fee income, profitability, staff utilisation, YoY, service lines ---

  const now = new Date();
  const monthKeys: { key: string; label: string; year: number; month: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`, year: d.getFullYear(), month: d.getMonth() });
  }

  const monthlyFeeIncome = monthKeys.map(({ key, label, year, month }) => {
    const monthInvoices = (invoices || []).filter((i) => {
      if (!i.invoice_date) return false;
      const d = new Date(i.invoice_date);
      return d.getFullYear() === year && d.getMonth() === month;
    });
    const invoicedTotal = monthInvoices.reduce((sum, i) => sum + Number(i.subtotal || 0), 0);
    const paidTotal = monthInvoices.filter((i) => i.status === "Paid").reduce((sum, i) => sum + Number(i.subtotal || 0), 0);
    return { key, label, invoicedTotal, paidTotal };
  });

  const maxMonthlyInvoiced = Math.max(1, ...monthlyFeeIncome.map((m) => m.invoicedTotal));

  const clientProfitMap = new Map<string, { clientId: string; clientName: string; invoiced: number; paid: number; writtenOff: number; timeValue: number; hours: number }>();
  allRows.forEach((d) => {
    const existing = clientProfitMap.get(d.clientId) || {
      clientId: d.clientId, clientName: d.clientName, invoiced: 0, paid: 0, writtenOff: 0, timeValue: 0, hours: 0,
    };
    existing.invoiced += d.invoicedAmount;
    existing.paid += d.paidAmount;
    existing.writtenOff += d.writtenOffAmount;
    existing.timeValue += d.chargeOutValue;
    existing.hours += d.totalHours;
    clientProfitMap.set(d.clientId, existing);
  });

  const clientProfitability = Array.from(clientProfitMap.values())
    .filter((c) => c.invoiced > 0 || c.timeValue > 0)
    .map((c) => ({
      ...c,
      realisation: c.timeValue > 0 ? (c.invoiced / c.timeValue) * 100 : 0,
    }))
    .sort((a, b) => b.invoiced - a.invoiced)
    .slice(0, 10);

  // Staff utilisation — respects the selected period, filtered by entry date
  const periodEntries = (entries || []).filter((e) => isWithinPeriod(e.date, activeStaffPeriod, now));
  const staffMap = new Map<string, { name: string; totalHours: number; billableHours: number; chargeOutValue: number }>();
  periodEntries.forEach((e) => {
    const name = e.user_name || "Unassigned";
    const existing = staffMap.get(name) || { name, totalHours: 0, billableHours: 0, chargeOutValue: 0 };
    existing.totalHours += Number(e.hours);
    if (e.billable) {
      existing.billableHours += Number(e.hours);
      existing.chargeOutValue += Number(e.hours) * Number(e.hourly_rate);
    }
    staffMap.set(name, existing);
  });

  const staffUtilisation = Array.from(staffMap.values())
    .map((s) => ({ ...s, utilisation: s.totalHours > 0 ? (s.billableHours / s.totalHours) * 100 : 0 }))
    .sort((a, b) => b.totalHours - a.totalHours);

  const currentYear = now.getFullYear();
  const previousYear = currentYear - 1;

  const yearTotal = (year: number, upToMonth?: number) =>
    (invoices || [])
      .filter((i) => {
        if (!i.invoice_date) return false;
        const d = new Date(i.invoice_date);
        if (d.getFullYear() !== year) return false;
        if (upToMonth !== undefined && d.getMonth() > upToMonth) return false;
        return true;
      })
      .reduce((sum, i) => sum + Number(i.subtotal || 0), 0);

  const currentYearToDate = yearTotal(currentYear, now.getMonth());
  const previousYearSamePeriod = yearTotal(previousYear, now.getMonth());
  const yoyChange = previousYearSamePeriod > 0
    ? ((currentYearToDate - previousYearSamePeriod) / previousYearSamePeriod) * 100
    : null;
  const currentYearFull = yearTotal(currentYear);
  const previousYearFull = yearTotal(previousYear);

  // Service line breakdown — group all activity rows by job type
  const serviceLineMap = new Map<string, { jobType: string; invoiced: number; timeValue: number; wip: number; count: number }>();
  activityRows.forEach((d) => {
    const existing = serviceLineMap.get(d.jobType) || { jobType: d.jobType, invoiced: 0, timeValue: 0, wip: 0, count: 0 };
    existing.invoiced += d.invoicedAmount;
    existing.timeValue += d.chargeOutValue;
    existing.wip += d.wip;
    existing.count += 1;
    serviceLineMap.set(d.jobType, existing);
  });

  const serviceLines = Array.from(serviceLineMap.values()).sort((a, b) => b.invoiced - a.invoiced);
  const maxServiceLineInvoiced = Math.max(1, ...serviceLines.map((s) => s.invoiced));

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmt0 = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <div className="min-h-screen bg-slate-50">

      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports & WIP</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Work in progress, time analysis and billing overview.
          </p>
        </div>
      </div>

      <div className="p-8 space-y-8">

        <div className="grid grid-cols-2 gap-6 lg:grid-cols-5">
          <Link href={activeFilter === "wip" ? "/reports" : "/reports?filter=wip"}
            className={`rounded-2xl bg-white p-6 shadow-sm border transition-colors ${activeFilter === "wip" ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-100 hover:border-slate-300"}`}>
            <p className="text-sm font-medium text-slate-500">Total WIP</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900 tabular-nums">{fmt(totalWIP)}</p>
            <p className="mt-1 text-xs text-slate-400">Unbilled work value</p>
          </Link>

          <Link href={activeFilter === "invoiced" ? "/reports" : "/reports?filter=invoiced"}
            className={`rounded-2xl bg-blue-600 p-6 shadow-sm transition-colors ${activeFilter === "invoiced" ? "ring-2 ring-blue-900" : "hover:bg-blue-700"}`}>
            <p className="text-sm font-medium text-blue-100">Total Invoiced</p>
            <p className="mt-2 text-3xl font-semibold text-white tabular-nums">{fmt(totalInvoiced)}</p>
            <p className="mt-1 text-xs text-blue-200">All invoices raised</p>
          </Link>

          <Link href={activeFilter === "paid" ? "/reports" : "/reports?filter=paid"}
            className={`rounded-2xl bg-white p-6 shadow-sm border transition-colors ${activeFilter === "paid" ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-100 hover:border-slate-300"}`}>
            <p className="text-sm font-medium text-slate-500">Total Paid</p>
            <p className="mt-2 text-3xl font-semibold text-green-600 tabular-nums">{fmt(totalPaid)}</p>
            <p className="mt-1 text-xs text-slate-400">Cash received</p>
          </Link>

          <Link href={activeFilter === "writtenoff" ? "/reports" : "/reports?filter=writtenoff"}
            className={`rounded-2xl bg-white p-6 shadow-sm border transition-colors ${activeFilter === "writtenoff" ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-100 hover:border-slate-300"}`}>
            <p className="text-sm font-medium text-slate-500">Written Off</p>
            <p className="mt-2 text-3xl font-semibold text-slate-500 tabular-nums">{fmt(totalWrittenOff)}</p>
            <p className="mt-1 text-xs text-slate-400">WIP not being billed</p>
          </Link>

          <Link href={activeFilter === "overbudget" ? "/reports" : "/reports?filter=overbudget"}
            className={`rounded-2xl p-6 shadow-sm transition-colors ${overBudgetJobs > 0 ? "bg-red-50 border border-red-100 hover:border-red-300" : "bg-white border border-slate-100 hover:border-slate-300"} ${activeFilter === "overbudget" ? "ring-1 ring-red-500" : ""}`}>
            <p className={`text-sm font-medium ${overBudgetJobs > 0 ? "text-red-500" : "text-slate-500"}`}>Over Budget</p>
            <p className={`mt-2 text-3xl font-semibold tabular-nums ${overBudgetJobs > 0 ? "text-red-600" : "text-slate-900"}`}>{overBudgetJobs}</p>
            <p className={`mt-1 text-xs ${overBudgetJobs > 0 ? "text-red-400" : "text-slate-400"}`}>Jobs over invoiced</p>
          </Link>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">

          <div className="lg:col-span-2">
            <div id="job-summary" className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-900">Job Summary</h2>
                {displayFilterLabel && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-3 py-1">
                      {displayFilterLabel} · {displayRows.length}
                    </span>
                    <Link href="/reports" className="text-xs font-semibold text-slate-400 hover:text-slate-600">
                      Clear ✕
                    </Link>
                  </div>
                )}
              </div>

              {displayRows.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-slate-500 text-sm">{displayFilterLabel ? "Nothing matches this filter." : "No data yet."}</p>
                  {!displayFilterLabel && (
                    <>
                      <p className="text-slate-400 text-xs mt-1">Log time against jobs to see WIP data.</p>
                      <Link href="/timesheets" className="text-blue-600 text-sm hover:underline mt-1 block">
                        Log time →
                      </Link>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 2fr) repeat(4, minmax(85px, 1fr))", gap: "0.5rem" }}
                    className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-4">
                    <div>Job / Client</div>
                    <div className="text-right">Time Value</div>
                    <div className="text-right">Invoiced</div>
                    <div className="text-right">Written Off</div>
                    <div className="text-right">WIP</div>
                  </div>

                  {displayRows.map((d) => (
                    <div key={d.key}
                      className={`rounded-xl border p-4 ${d.overBudget ? "border-red-200 bg-red-50" : "border-slate-100"}`}>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 2fr) repeat(4, minmax(85px, 1fr))", gap: "0.5rem" }}
                        className="items-center">
                        <div>
                          <div className="flex items-center gap-2">
                            {d.isGeneral ? (
                              <Link href={`/clients/${d.clientId}`}
                                className="font-semibold text-slate-900 hover:text-blue-600 transition-colors text-sm">
                                General / No job
                              </Link>
                            ) : (
                              <Link href={`/jobs/${d.job.id}`}
                                className="font-semibold text-slate-900 hover:text-blue-600 transition-colors text-sm">
                                {d.job.job_name}
                              </Link>
                            )}
                            {d.overBudget && (
                              <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-semibold">!</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {d.clientName} · {d.totalHours.toFixed(1)}h
                          </p>
                          {d.isGeneral ? (
                            <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-500">
                              Not job-linked
                            </span>
                          ) : (
                            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                              d.job.status === "Active" ? "bg-green-100 text-green-700"
                              : d.job.status === "Completed" ? "bg-blue-100 text-blue-700"
                              : "bg-slate-100 text-slate-600"
                            }`}>
                              {d.job.status}
                            </span>
                          )}
                        </div>

                        <div className="text-right">
                          <p className="font-semibold text-slate-900 text-sm tabular-nums">{fmt(d.chargeOutValue)}</p>
                          <p className="text-xs text-slate-400">{d.billableHours.toFixed(1)}h billable</p>
                        </div>

                        <div className="text-right">
                          <p className="font-semibold text-slate-900 text-sm tabular-nums">{fmt(d.invoicedAmount)}</p>
                          {d.paidAmount > 0 && (
                            <p className="text-xs text-green-600 tabular-nums">{fmt(d.paidAmount)} paid</p>
                          )}
                        </div>

                        <div className="text-right">
                          <p className="text-sm text-slate-500 tabular-nums">
                            {d.writtenOffAmount > 0 ? fmt(d.writtenOffAmount) : "—"}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className={`font-bold text-sm tabular-nums ${d.wip > 0 ? "text-orange-600" : "text-green-600"}`}>
                            {fmt(d.wip)}
                          </p>
                          <p className="text-xs text-slate-400">unbilled</p>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 2fr) repeat(4, minmax(85px, 1fr))", gap: "0.5rem" }}
                      className="items-center">
                      <div>
                        <p className="font-bold text-slate-900 text-sm">
                          {displayFilterLabel ? `Totals (${displayFilterLabel})` : "Totals"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-900 text-sm tabular-nums">
                          {fmt(displayRows.reduce((sum, d) => sum + d.chargeOutValue, 0))}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-900 text-sm tabular-nums">
                          {fmt(displayRows.reduce((sum, d) => sum + d.invoicedAmount, 0))}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-500 text-sm tabular-nums">
                          {fmt(displayRows.reduce((sum, d) => sum + d.writtenOffAmount, 0))}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-orange-600 text-sm tabular-nums">
                          {fmt(displayRows.reduce((sum, d) => sum + d.wip, 0))}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-base font-bold text-slate-900 mb-4">Job Status</h2>
              <div className="space-y-2">
                {statusCounts.map(({ status, count }) => (
                  <Link key={status}
                    href={activeFilter === `status-${status}` ? "/reports" : `/reports?filter=status-${status}`}
                    className={`flex items-center justify-between rounded-xl border p-3 transition-colors ${
                      activeFilter === `status-${status}` ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-100 hover:border-slate-300"
                    }`}>
                    <span className="text-sm font-medium text-slate-700">{status}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700 tabular-nums">{count}</span>
                  </Link>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* ============ PRACTICE OVERVIEW ============ */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Practice Overview</h2>
              <p className="text-sm text-slate-500 mt-0.5">Fee income, profitability, and staff utilisation across the whole practice.</p>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">

            {/* Fee Income by Month */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h3 className="text-base font-bold text-slate-900 mb-1">Fee Income — Last 12 Months</h3>
              <p className="text-xs text-slate-400 mb-4">Based on invoice date. Bar shows invoiced; green shows paid portion.</p>
              <div className="space-y-2">
                {monthlyFeeIncome.map((m) => (
                  <div key={m.key} className="flex items-center gap-3">
                    <span className="w-16 flex-shrink-0 text-xs text-slate-500">{m.label}</span>
                    <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden relative">
                      <div className="h-full bg-blue-200 rounded-full absolute top-0 left-0"
                        style={{ width: `${(m.invoicedTotal / maxMonthlyInvoiced) * 100}%` }} />
                      <div className="h-full bg-blue-600 rounded-full absolute top-0 left-0"
                        style={{ width: `${(m.paidTotal / maxMonthlyInvoiced) * 100}%` }} />
                    </div>
                    <span className="w-20 flex-shrink-0 text-right text-xs font-semibold text-slate-700 tabular-nums">{fmt0(m.invoicedTotal)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Year on Year */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h3 className="text-base font-bold text-slate-900 mb-1">Year-on-Year Comparison</h3>
              <p className="text-xs text-slate-400 mb-4">Fee income invoiced, based on invoice date.</p>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">{currentYear} year to date</p>
                  <p className="text-xl font-bold text-slate-900 mt-1 tabular-nums">{fmt0(currentYearToDate)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">{previousYear} same period</p>
                  <p className="text-xl font-bold text-slate-900 mt-1 tabular-nums">{fmt0(previousYearSamePeriod)}</p>
                </div>
              </div>

              {yoyChange !== null && (
                <div className={`rounded-xl p-4 mb-4 ${yoyChange >= 0 ? "bg-green-50 border border-green-100" : "bg-red-50 border border-red-100"}`}>
                  <p className={`text-sm font-bold ${yoyChange >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {yoyChange >= 0 ? "▲" : "▼"} {Math.abs(yoyChange).toFixed(1)}% vs same period last year
                  </p>
                </div>
              )}

              <div className="flex justify-between text-sm border-t border-slate-100 pt-4">
                <span className="text-slate-500">{previousYear} full year</span>
                <span className="font-semibold text-slate-900 tabular-nums">{fmt0(previousYearFull)}</span>
              </div>
              <div className="flex justify-between text-sm mt-2">
                <span className="text-slate-500">{currentYear} so far</span>
                <span className="font-semibold text-slate-900 tabular-nums">{fmt0(currentYearFull)}</span>
              </div>
            </div>

            {/* Profitability by Client — now links into Job Summary via clientFilter */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h3 className="text-base font-bold text-slate-900 mb-1">Profitability by Client</h3>
              <p className="text-xs text-slate-400 mb-4">Top 10 by invoiced value. Click a client to see their jobs above. Realisation = invoiced ÷ time value.</p>

              {clientProfitability.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No client activity yet.</p>
              ) : (
                <div className="space-y-2">
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 2fr) repeat(3, minmax(70px, 1fr))", gap: "0.5rem" }}
                    className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">
                    <div>Client</div>
                    <div className="text-right">Invoiced</div>
                    <div className="text-right">Time Value</div>
                    <div className="text-right">Realisation</div>
                  </div>
                  {clientProfitability.map((c) => (
                    <Link key={c.clientId} href={`/reports?client=${c.clientId}#job-summary`}
                      className={`block rounded-xl border p-3 transition-colors ${
                        clientFilterId === c.clientId ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-100 hover:bg-slate-50"
                      }`}>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 2fr) repeat(3, minmax(70px, 1fr))", gap: "0.5rem" }}
                        className="items-center">
                        <span className="text-sm font-medium text-slate-900 truncate">{c.clientName}</span>
                        <span className="text-right text-sm font-semibold text-slate-900 tabular-nums">{fmt0(c.invoiced)}</span>
                        <span className="text-right text-sm text-slate-500 tabular-nums">{fmt0(c.timeValue)}</span>
                        <span className={`text-right text-sm font-semibold tabular-nums ${c.realisation >= 100 ? "text-green-600" : c.realisation >= 80 ? "text-amber-600" : "text-red-600"}`}>
                          {c.realisation.toFixed(0)}%
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Staff Utilisation — now with period selector */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-bold text-slate-900">Staff Utilisation</h3>
              </div>
              <p className="text-xs text-slate-400 mb-3">Billable hours as a share of all hours logged.</p>

              <div className="flex gap-1.5 mb-4">
                {Object.entries(STAFF_PERIODS).map(([key, label]) => (
                  <Link key={key}
                    href={key === "all" ? "/reports#staff-utilisation" : `/reports?staffPeriod=${key}#staff-utilisation`}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      activeStaffPeriod === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}>
                    {label}
                  </Link>
                ))}
              </div>

              {staffUtilisation.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No time entries logged in this period.</p>
              ) : (
                <div className="space-y-3">
                  {staffUtilisation.map((s) => (
                    <div key={s.name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-slate-900">{s.name}</span>
                        <span className="text-xs text-slate-500 tabular-nums">
                          {s.billableHours.toFixed(1)}h / {s.totalHours.toFixed(1)}h · {s.utilisation.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${s.utilisation >= 70 ? "bg-green-500" : s.utilisation >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                          style={{ width: `${Math.min(s.utilisation, 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Service Line Breakdown — new */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 lg:col-span-2">
              <h3 className="text-base font-bold text-slate-900 mb-1">Fee Income by Service Line</h3>
              <p className="text-xs text-slate-400 mb-4">Grouped by job type, across all jobs with activity.</p>

              {serviceLines.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No activity yet.</p>
              ) : (
                <div className="space-y-3">
                  {serviceLines.map((s) => (
                    <div key={s.jobType} className="flex items-center gap-3">
                      <span className="w-48 flex-shrink-0 text-sm text-slate-700 truncate">{s.jobType}</span>
                      <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden relative">
                        <div className="h-full bg-slate-800 rounded-full absolute top-0 left-0"
                          style={{ width: `${(s.invoiced / maxServiceLineInvoiced) * 100}%` }} />
                      </div>
                      <span className="w-24 flex-shrink-0 text-right text-sm font-semibold text-slate-900 tabular-nums">{fmt0(s.invoiced)}</span>
                      <span className="w-16 flex-shrink-0 text-right text-xs text-slate-400 tabular-nums">{s.count} job{s.count !== 1 ? "s" : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}