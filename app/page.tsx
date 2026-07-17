import { createClient } from "@supabase/supabase-js";
import { computeDeadlines, getUrgencyColor } from "./deadlines/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function DashboardPage() {
  const [
    { count: totalClients },
    { count: activeJobs },
    { data: deadlineClients },
    { data: recentClients },
    { data: recentJobs },
    { data: recentQuotes },
    { data: sentTaxComputations },
    { data: sentAccounts },
    { data: invoices },
    { data: amlClients },
  ] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase.from("jobs").select("*", { count: "exact", head: true }).eq("status", "Active"),
    supabase.from("clients").select("id, client_name, company_number, entity_type, accounts_next_due, confirmation_statement_next_due, requires_self_assessment, vat_stagger_group, paye_reference"),
    supabase.from("clients").select("id, client_name, entity_type, onboarding_status, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("jobs").select("*, clients(client_name)").order("created_at", { ascending: false }).limit(5),
    supabase.from("quotes").select("*, clients(client_name)").order("created_at", { ascending: false }).limit(5),
    supabase.from("tax_computations").select("id, tax_year, status, client_id, clients(client_name)").in("status", ["Sent", "Queried"]),
    supabase.from("trial_balances").select("id, period_end, accounts_type, approval_status, client_id, clients(client_name)").in("approval_status", ["Sent", "Queried"]),
    supabase.from("invoices").select("status, total"),
    supabase.from("clients").select("id, client_name, onboarding_status, aml_risk_rating, aml_id_verified, aml_next_review_due"),
  ]);

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Deadlines — exact same calculation as the Deadlines page, just showing the
  // most urgent handful here instead of the full list
  const allDeadlines = computeDeadlines(deadlineClients || []);
  allDeadlines.sort((a, b) => a.days - b.days);
  const urgentDeadlines = allDeadlines.filter((d) => d.days <= 30).slice(0, 6);
  const overdueCount = allDeadlines.filter((d) => d.days < 0).length;

  // Pending approvals — merge Personal Tax and Accounts sent-for-approval items
  const pendingApprovals = [
    ...(sentTaxComputations || []).map((t) => ({
      key: `tax-${t.id}`,
      label: `Personal Tax ${t.tax_year}`,
      client_name: (t.clients as any)?.client_name || "No client",
      status: t.status,
      href: `/tax/${t.id}`,
    })),
    ...(sentAccounts || []).map((a) => ({
      key: `acc-${a.id}`,
      label: `${a.accounts_type || "Accounts"} — Year Ended ${new Date(a.period_end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
      client_name: (a.clients as any)?.client_name || "No client",
      status: a.approval_status,
      href: `/accounts-production/${a.id}`,
    })),
  ].sort((a, b) => (a.status === "Queried" ? -1 : 1) - (b.status === "Queried" ? -1 : 1));

  // Billing snapshot
  const outstanding = (invoices || []).filter((i) => i.status !== "Paid").reduce((s, i) => s + Number(i.total || 0), 0);
  const paidThisRun = (invoices || []).filter((i) => i.status === "Paid").reduce((s, i) => s + Number(i.total || 0), 0);
  const draftCount = (invoices || []).filter((i) => i.status === "Draft").length;

  // AML alerts — only flag clients who are actually onboard/active, not prospects who
  // haven't been taken on yet. Same "needs attention" logic as the client detail page.
  const amlAlerts = (amlClients || [])
    .filter((c) => c.onboarding_status === "Active Client" || c.onboarding_status === "Onboarding")
    .map((c) => {
      const reviewOverdue = c.aml_next_review_due && new Date(c.aml_next_review_due) < new Date();
      const reasons: string[] = [];
      if (!c.aml_id_verified) reasons.push("ID not verified");
      if (!c.aml_risk_rating) reasons.push("No risk rating");
      if (reviewOverdue) reasons.push("Review overdue");
      return { id: c.id, client_name: c.client_name, reasons };
    })
    .filter((c) => c.reasons.length > 0);

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-sm text-slate-500 mt-0.5">{today}</p>
          </div>
          <div className="flex gap-3">
            <a href="/clients?new=true" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">+ New Client</a>
            <a href="/jobs" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">+ New Job</a>
            <a href="/quotes" className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 transition-colors">+ New Quote</a>
            <a href="/invoices/new" className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 transition-colors">+ New Invoice</a>
          </div>
        </div>
      </div>

      <div className="p-8">

        {/* Stat Cards */}
        <div className="grid grid-cols-2 gap-6 lg:grid-cols-5">

          <a href="/clients" className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 hover:shadow-md hover:border-slate-200 transition-all">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">Total Clients</p>
              <span className="text-2xl">👥</span>
            </div>
            <p className="mt-3 text-4xl font-bold text-slate-900">{totalClients ?? 0}</p>
          </a>

          <a href="/jobs" className="rounded-2xl bg-blue-600 p-6 shadow-sm hover:bg-blue-700 transition-all">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-blue-100">Active Jobs</p>
              <span className="text-2xl">⚡</span>
            </div>
            <p className="mt-3 text-4xl font-bold text-white">{activeJobs ?? 0}</p>
          </a>

          <a href="/deadlines" className={`rounded-2xl p-6 shadow-sm transition-all ${overdueCount > 0 ? "bg-red-600 hover:bg-red-700" : "bg-white border border-slate-100 hover:shadow-md hover:border-slate-200"}`}>
            <div className="flex items-center justify-between">
              <p className={`text-sm font-medium ${overdueCount > 0 ? "text-red-100" : "text-slate-500"}`}>Overdue Deadlines</p>
              <span className="text-2xl">⏰</span>
            </div>
            <p className={`mt-3 text-4xl font-bold ${overdueCount > 0 ? "text-white" : "text-slate-900"}`}>{overdueCount}</p>
          </a>

          <a href="/invoices" className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 hover:shadow-md hover:border-slate-200 transition-all">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">Outstanding</p>
              <span className="text-2xl">💷</span>
            </div>
            <p className="mt-3 text-4xl font-bold text-orange-600">£{outstanding.toFixed(0)}</p>
          </a>

          <a href="/clients" className={`rounded-2xl p-6 shadow-sm transition-all ${amlAlerts.length > 0 ? "bg-red-600 hover:bg-red-700" : "bg-white border border-slate-100 hover:shadow-md hover:border-slate-200"}`}>
            <div className="flex items-center justify-between">
              <p className={`text-sm font-medium ${amlAlerts.length > 0 ? "text-red-100" : "text-slate-500"}`}>AML Reviews Needed</p>
              <span className="text-2xl">🛡️</span>
            </div>
            <p className={`mt-3 text-4xl font-bold ${amlAlerts.length > 0 ? "text-white" : "text-slate-900"}`}>{amlAlerts.length}</p>
          </a>

        </div>

        {/* Deadlines + Approvals + Billing */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">

          {/* Upcoming Deadlines */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-900">Upcoming Deadlines</h2>
              <a href="/deadlines" className="text-xs font-medium text-blue-600 hover:underline">View all →</a>
            </div>
            <div className="space-y-2">
              {urgentDeadlines.map((d, i) => {
                const urgency = getUrgencyColor(d.days);
                return (
                  <a key={i} href={`/clients/${d.client_id}`}
                    className={`flex items-center justify-between rounded-xl border ${urgency.border} ${urgency.bg} p-3 hover:opacity-80 transition-opacity`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${urgency.dot}`}></div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{d.client_name}</p>
                        <p className="text-xs text-slate-500">{d.type}</p>
                      </div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${urgency.badge}`}>
                      {d.days < 0 ? `${Math.abs(d.days)}d overdue` : `${d.days}d`}
                    </span>
                  </a>
                );
              })}
              {urgentDeadlines.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">Nothing due within 30 days.</p>
              )}
            </div>
          </div>

          {/* Pending Approvals */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-900">Pending Client Approvals</h2>
            </div>
            <div className="space-y-2">
              {pendingApprovals.map((item) => (
                <a key={item.key} href={item.href}
                  className={`flex items-center justify-between rounded-xl border p-3 hover:opacity-80 transition-opacity ${
                    item.status === "Queried" ? "border-yellow-200 bg-yellow-50" : "border-blue-100 bg-blue-50"
                  }`}>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.client_name}</p>
                    <p className="text-xs text-slate-500">{item.label}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                    item.status === "Queried" ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700"
                  }`}>
                    {item.status}
                  </span>
                </a>
              ))}
              {pendingApprovals.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">Nothing awaiting client response.</p>
              )}
            </div>
          </div>

          {/* Billing Snapshot */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-900">Billing Snapshot</h2>
              <a href="/invoices" className="text-xs font-medium text-blue-600 hover:underline">View all →</a>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl bg-orange-50 border border-orange-100 p-4">
                <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide">Outstanding</p>
                <p className="mt-1 text-2xl font-bold text-orange-700">£{outstanding.toFixed(2)}</p>
              </div>
              <div className="rounded-xl bg-green-50 border border-green-100 p-4">
                <p className="text-xs font-semibold text-green-600 uppercase tracking-wide">Paid (all time)</p>
                <p className="mt-1 text-2xl font-bold text-green-700">£{paidThisRun.toFixed(2)}</p>
              </div>
              {draftCount > 0 && (
                <p className="text-xs text-slate-400 text-center">{draftCount} invoice{draftCount !== 1 ? "s" : ""} still in Draft, not yet sent</p>
              )}
            </div>
          </div>

        </div>

        {/* AML Alerts */}
        {amlAlerts.length > 0 && (
          <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-red-200">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-900">⚠ Clients Needing AML Attention</h2>
              <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                {amlAlerts.length} client{amlAlerts.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {amlAlerts.map((c) => (
                <a key={c.id} href={`/clients/${c.id}`}
                  className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 p-3 hover:opacity-80 transition-opacity">
                  <p className="text-sm font-semibold text-slate-900">{c.client_name}</p>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {c.reasons.map((r) => (
                      <span key={r} className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        {r}
                      </span>
                    ))}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Recent activity */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">

          {/* Recent Clients */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-900">Recent Clients</h2>
              <a href="/clients" className="text-xs font-medium text-blue-600 hover:underline">View all →</a>
            </div>
            <div className="space-y-2">
              {(recentClients || []).map((client) => (
                <a key={client.id} href={`/clients/${client.id}`}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
                      {client.client_name?.charAt(0) || "?"}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{client.client_name}</p>
                      <p className="text-xs text-slate-500">{client.entity_type || "No entity type"}</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    client.onboarding_status === "Active Client" ? "bg-green-100 text-green-700"
                    : client.onboarding_status === "Prospect" ? "bg-blue-100 text-blue-700"
                    : client.onboarding_status === "Onboarding" ? "bg-yellow-100 text-yellow-700"
                    : "bg-slate-100 text-slate-600"
                  }`}>
                    {client.onboarding_status || "Unknown"}
                  </span>
                </a>
              ))}
              {recentClients && recentClients.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">
                  No clients yet. <a href="/clients?new=true" className="text-blue-600 hover:underline">Add your first →</a>
                </p>
              )}
            </div>
          </div>

          {/* Recent Jobs */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-900">Recent Jobs</h2>
              <a href="/jobs" className="text-xs font-medium text-blue-600 hover:underline">View all →</a>
            </div>
            <div className="space-y-2">
              {(recentJobs || []).map((job) => (
                <a key={job.id} href={`/jobs/${job.id}`}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-xs font-bold text-blue-600">
                      {job.job_name?.charAt(0) || "?"}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{job.job_name}</p>
                      <p className="text-xs text-slate-500">{job.clients?.client_name || "No client"}</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    job.status === "Active" ? "bg-green-100 text-green-700"
                    : job.status === "Completed" ? "bg-blue-100 text-blue-700"
                    : job.status === "On Hold" ? "bg-yellow-100 text-yellow-700"
                    : "bg-slate-100 text-slate-600"
                  }`}>
                    {job.status || "Draft"}
                  </span>
                </a>
              ))}
              {recentJobs && recentJobs.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">
                  No jobs yet. <a href="/jobs" className="text-blue-600 hover:underline">Add your first →</a>
                </p>
              )}
            </div>
          </div>

          {/* Recent Quotes */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-900">Recent Quotes</h2>
              <a href="/quotes" className="text-xs font-medium text-blue-600 hover:underline">View all →</a>
            </div>
            <div className="space-y-2">
              {(recentQuotes || []).map((quote) => (
                <a key={quote.id} href={`/quotes/${quote.id}`}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center text-xs font-bold text-green-600">
                      £
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{quote.quote_number}</p>
                      <p className="text-xs text-slate-500">
                        {quote.clients?.client_name || "No client"} · £{Number(quote.total || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    quote.status === "Accepted" ? "bg-green-100 text-green-700"
                    : quote.status === "Sent" ? "bg-blue-100 text-blue-700"
                    : quote.status === "Declined" ? "bg-red-100 text-red-700"
                    : quote.status === "Expired" ? "bg-orange-100 text-orange-700"
                    : "bg-slate-100 text-slate-600"
                  }`}>
                    {quote.status || "Draft"}
                  </span>
                </a>
              ))}
              {recentQuotes && recentQuotes.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">
                  No quotes yet. <a href="/quotes" className="text-blue-600 hover:underline">Add your first →</a>
                </p>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
