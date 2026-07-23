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

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const activeFilter = filter && FILTERS[filter] ? filter : null;

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

  const displayRows = activeFilter ? allRows.filter(FILTERS[activeFilter].test) : activityRows;

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
            <p className="mt-2 text-3xl font-semibold text-slate-900 tabular-nums">£{totalWIP.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="mt-1 text-xs text-slate-400">Unbilled work value</p>
          </Link>

          <Link href={activeFilter === "invoiced" ? "/reports" : "/reports?filter=invoiced"}
            className={`rounded-2xl bg-blue-600 p-6 shadow-sm transition-colors ${activeFilter === "invoiced" ? "ring-2 ring-blue-900" : "hover:bg-blue-700"}`}>
            <p className="text-sm font-medium text-blue-100">Total Invoiced</p>
            <p className="mt-2 text-3xl font-semibold text-white tabular-nums">£{totalInvoiced.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="mt-1 text-xs text-blue-200">All invoices raised</p>
          </Link>

          <Link href={activeFilter === "paid" ? "/reports" : "/reports?filter=paid"}
            className={`rounded-2xl bg-white p-6 shadow-sm border transition-colors ${activeFilter === "paid" ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-100 hover:border-slate-300"}`}>
            <p className="text-sm font-medium text-slate-500">Total Paid</p>
            <p className="mt-2 text-3xl font-semibold text-green-600 tabular-nums">£{totalPaid.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="mt-1 text-xs text-slate-400">Cash received</p>
          </Link>

          <Link href={activeFilter === "writtenoff" ? "/reports" : "/reports?filter=writtenoff"}
            className={`rounded-2xl bg-white p-6 shadow-sm border transition-colors ${activeFilter === "writtenoff" ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-100 hover:border-slate-300"}`}>
            <p className="text-sm font-medium text-slate-500">Written Off</p>
            <p className="mt-2 text-3xl font-semibold text-slate-500 tabular-nums">£{totalWrittenOff.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
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
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-900">Job Summary</h2>
                {activeFilter && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-3 py-1">
                      {FILTERS[activeFilter].label} · {displayRows.length}
                    </span>
                    <Link href="/reports" className="text-xs font-semibold text-slate-400 hover:text-slate-600">
                      Clear ✕
                    </Link>
                  </div>
                )}
              </div>

              {displayRows.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-slate-500 text-sm">{activeFilter ? "Nothing matches this filter." : "No data yet."}</p>
                  {!activeFilter && (
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
                          <p className="font-semibold text-slate-900 text-sm tabular-nums">£{d.chargeOutValue.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          <p className="text-xs text-slate-400">{d.billableHours.toFixed(1)}h billable</p>
                        </div>

                        <div className="text-right">
                          <p className="font-semibold text-slate-900 text-sm tabular-nums">£{d.invoicedAmount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          {d.paidAmount > 0 && (
                            <p className="text-xs text-green-600 tabular-nums">£{d.paidAmount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} paid</p>
                          )}
                        </div>

                        <div className="text-right">
                          <p className="text-sm text-slate-500 tabular-nums">
                            {d.writtenOffAmount > 0 ? `£${d.writtenOffAmount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className={`font-bold text-sm tabular-nums ${d.wip > 0 ? "text-orange-600" : "text-green-600"}`}>
                            £{d.wip.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                          {activeFilter ? `Totals (${FILTERS[activeFilter].label})` : "Totals"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-900 text-sm tabular-nums">
                          £{displayRows.reduce((sum, d) => sum + d.chargeOutValue, 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-900 text-sm tabular-nums">
                          £{displayRows.reduce((sum, d) => sum + d.invoicedAmount, 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-500 text-sm tabular-nums">
                          £{displayRows.reduce((sum, d) => sum + d.writtenOffAmount, 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-orange-600 text-sm tabular-nums">
                          £{displayRows.reduce((sum, d) => sum + d.wip, 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
      </div>
    </div>
  );
}
