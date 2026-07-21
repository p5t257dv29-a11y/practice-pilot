import { createClient } from "@supabase/supabase-js";
import { computeDeadlines } from "./deadlines/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(amount);

export default async function DashboardPage() {
  const [
    { count: totalClients },
    { data: invoices },
    { data: amlClients },
    { data: deadlineClients },
    { data: sentTax },
    { data: sentAccounts },
    { data: sentCT },
    { data: engagementLetters },
    { data: onboardingRequests },
    { data: sentP11D },
  ] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase.from("invoices").select("status, total"),
    supabase.from("clients").select("id, onboarding_status, aml_risk_rating, aml_id_verified, aml_next_review_due"),
    supabase.from("clients").select("id, client_name, company_number, entity_type, accounts_next_due, confirmation_statement_next_due, requires_self_assessment, vat_stagger_group, paye_reference"),
    supabase.from("tax_computations").select("id", { count: "exact" }).eq("status", "Sent"),
    supabase.from("trial_balances").select("id", { count: "exact" }).eq("approval_status", "Sent"),
    supabase.from("corporation_tax_computations").select("id", { count: "exact" }).eq("status", "Sent"),
    supabase.from("engagement_letters").select("id, status"),
    supabase.from("onboarding_requests").select("id, status"),
    supabase.from("p11d_computations").select("id", { count: "exact" }).eq("status", "Sent"),
  ]);

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const clientsCount = totalClients ?? 0;

  const outstandingFees = (invoices || [])
    .filter((i) => i.status !== "Paid")
    .reduce((s, i) => s + Number(i.total || 0), 0);

  const amlOutstandingCount = (amlClients || [])
    .filter((c) => c.onboarding_status === "Active Client" || c.onboarding_status === "Onboarding")
    .filter((c) => {
      const reviewOverdue = c.aml_next_review_due && new Date(c.aml_next_review_due) < new Date();
      return !c.aml_id_verified || !c.aml_risk_rating || reviewOverdue;
    }).length;

  const allDeadlines = computeDeadlines(deadlineClients || []);
  const upcomingDeadlinesCount = allDeadlines.filter((d) => d.days <= 30).length;

  const accountsAwaitingCount = sentAccounts?.length ?? 0;
  const ctAwaitingCount = sentCT?.length ?? 0;
  const personalTaxAwaitingCount = sentTax?.length ?? 0;
  const p11dAwaitingCount = sentP11D?.length ?? 0;

  const outstandingEngagementCount = (engagementLetters || []).filter((l) => l.status !== "Signed").length;
  const outstandingOnboardingCount = (onboardingRequests || []).filter((r) => r.status !== "Complete").length;

  return (
    <div className="min-h-screen bg-[#f8fafc] p-8 font-sans">
      <div className="mx-auto max-w-7xl space-y-8">
        
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-slate-200/80 pb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Practice Dashboard</h1>
            <p className="mt-1 text-xs font-medium text-slate-500">{today}</p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <a
              href="/clients?new=true"
              className="rounded-lg bg-[#0e1726] px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 transition-colors"
            >
              + New Client
            </a>
            <a
              href="/jobs"
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
            >
              + Job
            </a>
            <a
              href="/quotes/new"
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
            >
              + Quote
            </a>
            <a
              href="/invoices/new"
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
            >
              + Invoice
            </a>
          </div>
        </div>

        {/* Dashboard Sections */}
        <div className="space-y-8">
          
          {/* Practice Overview */}
          <section>
            <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Practice Overview
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <a href="/clients" className="group rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs hover:border-slate-300 hover:shadow-xs transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">Total Active Clients</span>
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-slate-900">{clientsCount}</span>
                  <span className="text-slate-400 group-hover:translate-x-0.5 group-hover:text-slate-700 transition-all text-sm">&rarr;</span>
                </div>
              </a>

              <a href="/invoices" className="group rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs hover:border-slate-300 hover:shadow-xs transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">Outstanding Fees</span>
                  {outstandingFees > 0 && (
                    <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200/60">
                      Unpaid
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-slate-900">{formatCurrency(outstandingFees)}</span>
                  <span className="text-slate-400 group-hover:translate-x-0.5 group-hover:text-slate-700 transition-all text-sm">&rarr;</span>
                </div>
              </a>

              <a href="/deadlines" className="group rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs hover:border-slate-300 hover:shadow-xs transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">Upcoming Deadlines</span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">30 Days</span>
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-slate-900">{upcomingDeadlinesCount}</span>
                  <span className="text-slate-400 group-hover:translate-x-0.5 group-hover:text-slate-700 transition-all text-sm">&rarr;</span>
                </div>
              </a>
            </div>
          </section>

          {/* Compliance & Risk */}
          <section>
            <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Compliance & Risk
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <a href="/clients" className="group rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs hover:border-slate-300 hover:shadow-xs transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">Outstanding AML Checks</span>
                  {amlOutstandingCount > 0 ? (
                    <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 border border-rose-200/60">
                      Requires Review
                    </span>
                  ) : (
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200/60">
                      Compliant
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-slate-900">{amlOutstandingCount}</span>
                  <span className="text-slate-400 group-hover:translate-x-0.5 group-hover:text-slate-700 transition-all text-sm">&rarr;</span>
                </div>
              </a>
            </div>
          </section>

          {/* Awaiting Client Sign-Off */}
          <section>
            <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Awaiting Client Sign-Off
            </h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[
                { label: "Accounts", count: accountsAwaitingCount, type: "Accounts" },
                { label: "Corporation Tax", count: ctAwaitingCount, type: "Corporation+Tax" },
                { label: "Personal Tax", count: personalTaxAwaitingCount, type: "Personal+Tax" },
                { label: "P11D Computations", count: p11dAwaitingCount, type: "P11D" },
              ].map((item) => (
                <a
                  key={item.label}
                  href={`/communications?status=Sent&type=${item.type}`}
                  className="group rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs hover:border-slate-300 hover:shadow-xs transition-all"
                >
                  <span className="text-xs font-semibold text-slate-500">{item.label}</span>
                  <div className="mt-4 flex items-baseline justify-between">
                    <span className="text-3xl font-bold text-slate-900">{item.count}</span>
                    <span className="text-slate-400 group-hover:translate-x-0.5 group-hover:text-slate-700 transition-all text-sm">&rarr;</span>
                  </div>
                </a>
              ))}
            </div>
          </section>

          {/* Onboarding & Legal */}
          <section>
            <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Onboarding & Contracts
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <a href="/engagement" className="group rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs hover:border-slate-300 hover:shadow-xs transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">Unsigned Engagement Letters</span>
                  {outstandingEngagementCount > 0 && (
                    <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 border border-blue-200/60">
                      Pending
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-slate-900">{outstandingEngagementCount}</span>
                  <span className="text-slate-400 group-hover:translate-x-0.5 group-hover:text-slate-700 transition-all text-sm">&rarr;</span>
                </div>
              </a>

              <a href="/onboarding" className="group rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs hover:border-slate-300 hover:shadow-xs transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">Incomplete Onboarding</span>
                  {outstandingOnboardingCount > 0 && (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                      In Progress
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-slate-900">{outstandingOnboardingCount}</span>
                  <span className="text-slate-400 group-hover:translate-x-0.5 group-hover:text-slate-700 transition-all text-sm">&rarr;</span>
                </div>
              </a>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}