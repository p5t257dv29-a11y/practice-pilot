import { createClient } from "@supabase/supabase-js";
import { computeDeadlines } from "./deadlines/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const formatCurrency = (amount: number | string) => {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "£0";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(num);
};

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
    { data: quotes },
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
    supabase.from("quotes").select("id, status"),
  ]);

  const totalActiveClients = totalClients ?? 0;
  const unpaidInvoicesAmount = (invoices || []).filter((i) => i.status !== "Paid").reduce((s, i) => s + Number(i.total || 0), 0);
  const outstandingQuotesCount = (quotes || []).filter((q) => q.status !== "Accepted" && q.status !== "Declined").length;
  const allDeadlines = computeDeadlines(deadlineClients || []);
  const upcomingDeadlinesCount = allDeadlines.filter((d) => d.days <= 30).length;

  const outstandingAmlChecks = (amlClients || [])
    .filter((c) => c.onboarding_status === "Active Client" || c.onboarding_status === "Onboarding")
    .filter((c) => {
      const reviewOverdue = c.aml_next_review_due && new Date(c.aml_next_review_due) < new Date();
      return !c.aml_id_verified || !c.aml_risk_rating || reviewOverdue;
    }).length;
  const outstandingClearances = 0;

  const unsignedEngagementLetters = (engagementLetters || []).filter((l) => l.status !== "Signed").length;
  const incompleteOnboarding = (onboardingRequests || []).filter((r) => r.status !== "Complete").length;

  const awaitingSignOff = [
    { label: "Accounts Production", val: sentAccounts?.length ?? 0, href: "/communications?status=Sent&type=Accounts" },
    { label: "Corporation Tax", val: sentCT?.length ?? 0, href: "/communications?status=Sent&type=Corporation+Tax" },
    { label: "Director's Loan & s455", val: 0, href: "/directors-loan-account" },
    { label: "Capital Gains", val: 0, href: "/capital-gains" },
    { label: "Personal Tax", val: sentTax?.length ?? 0, href: "/communications?status=Sent&type=Personal+Tax" },
    { label: "Partnership Tax", val: 0, href: "/partnership-tax" },
    { label: "P11D Computations", val: sentP11D?.length ?? 0, href: "/communications?status=Sent&type=P11D" },
  ];

  const totalAwaitingSignoff = awaitingSignOff.reduce((acc, item) => acc + item.val, 0);

  return (
    <div className="min-h-screen bg-slate-50/50 p-8 space-y-8 text-slate-800">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Practice Dashboard
          </h1>
          <p className="text-xs font-medium text-slate-500 mt-1">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a href="/clients?new=true" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 transition-all">
            <span>+</span> New Client
          </a>
          <a href="/jobs" className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-all">
            <span>+</span> Job
          </a>
          <a href="/quotes/new" className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-all">
            <span>+</span> Quote
          </a>
          <a href="/invoices/new" className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-all">
            <span>+</span> Invoice
          </a>
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
            Practice Overview
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <a href="/clients" className="group relative rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500">Active Clients</p>
              <span className="text-slate-300 group-hover:text-slate-600 transition-colors">→</span>
            </div>
            <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
              {totalActiveClients}
            </p>
          </a>

          <a href="/invoices" className="group relative rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500">Unpaid Invoices</p>
              <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                Outstanding
              </span>
            </div>
            <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
              {formatCurrency(unpaidInvoicesAmount)}
            </p>
          </a>

          <a href="/quotes" className="group relative rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500">Outstanding Quotes</p>
              <span className="rounded-full bg-purple-50 border border-purple-200 px-2 py-0.5 text-[10px] font-bold text-purple-700">
                Pending
              </span>
            </div>
            <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
              {outstandingQuotesCount}
            </p>
          </a>

          <a href="/deadlines" className="group relative rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500">Upcoming Deadlines</p>
              <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                Next 30 Days
              </span>
            </div>
            <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
              {upcomingDeadlinesCount}
            </p>
          </a>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
            Compliance & Risk
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <a href="/clients?filter=aml" className="group rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500">AML Checks</p>
                <span className="rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[10px] font-bold text-red-600">
                  Review Needed
                </span>
              </div>
              <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
                {outstandingAmlChecks}
              </p>
            </a>

            <a href="/onboarding" className="group rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500">Prof. Clearances</p>
                <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                  Awaiting
                </span>
              </div>
              <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
                {outstandingClearances}
              </p>
            </a>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
            Onboarding & Contracts
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <a href="/engagement" className="group rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500">Unsigned Letters</p>
                <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-600">
                  Pending
                </span>
              </div>
              <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
                {unsignedEngagementLetters}
              </p>
            </a>

            <a href="/onboarding" className="group rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500">Incomplete Onboarding</p>
                <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  In Progress
                </span>
              </div>
              <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
                {incompleteOnboarding}
              </p>
            </a>
          </div>
        </section>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
            Awaiting Client Sign-off
          </h2>
          <span className="text-xs font-semibold text-slate-500">
            Total Pending: <strong className="text-slate-900">{totalAwaitingSignoff}</strong>
          </span>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 divide-y sm:divide-y-0 divide-slate-100">
            {awaitingSignOff.map((item, idx) => {
              const hasItems = item.val > 0;
              return (
                <a key={item.label} href={item.href} className={"group p-4 flex items-center justify-between transition-colors border-slate-100 " + (idx < awaitingSignOff.length - 1 ? "sm:border-r " : "") + "hover:bg-slate-50/80"}>
                  <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-900 transition-colors">
                    {item.label}
                  </span>
                  <span className={"inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-bold transition-all " + (hasItems ? "bg-amber-500 text-white shadow-xs" : "bg-slate-100 text-slate-400")}>
                    {item.val}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
