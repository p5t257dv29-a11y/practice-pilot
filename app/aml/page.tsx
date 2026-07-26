import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AmlIssue = {
  client_id: string;
  client_name: string;
  company_number: string | null;
  entity_type: string | null;
  reasons: string[];
  reviewDueDate: string | null;
  reviewDaysOverdue: number | null;
};

function getDaysUntil(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(date);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default async function AmlReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;

  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, client_name, company_number, entity_type, onboarding_status, aml_risk_rating, aml_id_verified, aml_next_review_due")
    .in("onboarding_status", ["Active Client", "Onboarding"])
    .order("client_name", { ascending: true });

  if (error) {
    return (
      <div className="p-8">
        <p className="text-red-600">Could not load AML data: {error.message}</p>
      </div>
    );
  }

  const issues: AmlIssue[] = (clients || [])
    .map((c) => {
      const reasons: string[] = [];
      if (!c.aml_id_verified) reasons.push("ID not verified");
      if (!c.aml_risk_rating) reasons.push("No risk rating");

      let reviewDaysOverdue: number | null = null;
      if (c.aml_next_review_due) {
        const days = getDaysUntil(new Date(c.aml_next_review_due));
        if (days < 0) {
          reasons.push("Review overdue");
          reviewDaysOverdue = Math.abs(days);
        }
      }

      if (reasons.length === 0) return null;

      return {
        client_id: c.id,
        client_name: c.client_name,
        company_number: c.company_number,
        entity_type: c.entity_type,
        reasons,
        reviewDueDate: c.aml_next_review_due,
        reviewDaysOverdue,
      };
    })
    .filter((i): i is AmlIssue => i !== null);

  const unverified = issues.filter((i) => i.reasons.includes("ID not verified"));
  const noRating = issues.filter((i) => i.reasons.includes("No risk rating"));
  const overdue = issues.filter((i) => i.reasons.includes("Review overdue"));

  const filteredIssues = filter === "unverified"
    ? unverified
    : filter === "no-rating"
    ? noRating
    : filter === "overdue"
    ? overdue
    : issues;

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AML Reviews</h1>
          <p className="text-sm text-slate-500 mt-0.5">{today}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/aml"
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              !filter ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}>
            All issues ({issues.length})
          </a>
          <a href="/aml?filter=overdue"
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === "overdue" ? "bg-red-600 text-white" : "bg-red-50 text-red-600 hover:bg-red-100"
            }`}>
            Overdue reviews ({overdue.length})
          </a>
          <a href="/aml?filter=unverified"
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === "unverified" ? "bg-orange-600 text-white" : "bg-orange-50 text-orange-600 hover:bg-orange-100"
            }`}>
            ID not verified ({unverified.length})
          </a>
          <a href="/aml?filter=no-rating"
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === "no-rating" ? "bg-yellow-600 text-white" : "bg-yellow-50 text-yellow-600 hover:bg-yellow-100"
            }`}>
            No risk rating ({noRating.length})
          </a>
        </div>
      </div>

      <div className="p-8">
        {filteredIssues.length === 0 ? (
          <div className="rounded-2xl bg-white p-12 shadow-sm border border-slate-100 text-center">
            <p className="text-slate-500">✓ Nothing needs attention here.</p>
            <p className="text-sm text-slate-400 mt-1">All active and onboarding clients have up-to-date AML records.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredIssues.map((issue) => (
              <a key={issue.client_id} href={`/clients/${issue.client_id}?tab=aml`}
                className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 p-4 hover:opacity-80 transition-opacity">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                  <div>
                    <p className="font-semibold text-slate-900">{issue.client_name}</p>
                    <p className="text-xs text-slate-500">
                      {issue.company_number && `${issue.company_number} · `}{issue.entity_type || "No entity type"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {issue.reasons.map((reason) => (
                    <span key={reason} className="rounded-full bg-red-100 text-red-700 px-3 py-1 text-xs font-bold">
                      {reason === "Review overdue" && issue.reviewDaysOverdue !== null
                        ? `Review ${issue.reviewDaysOverdue}d overdue`
                        : reason}
                    </span>
                  ))}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}