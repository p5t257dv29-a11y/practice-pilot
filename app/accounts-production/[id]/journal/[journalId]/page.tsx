import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { PL_CATEGORIES, BS_CATEGORIES } from "../../../page";
import JournalLinesEditor from "../journal-lines-editor";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateJournal(trialBalanceId: string, journalId: string, clientId: string, formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();
  const description = get("journal_description");
  const reference = get("journal_reference");
  const journal_date = get("journal_date") || null;

  if (!description) {
    redirect(`/accounts-production/${trialBalanceId}/journal/${journalId}?journal_error=Please+enter+a+journal+description`);
  }

  const rows = [];
  for (let i = 0; i < 8; i++) {
    const lineDesc = get(`line_description_${i}`);
    const debit = parseFloat(get(`line_debit_${i}`)) || 0;
    const credit = parseFloat(get(`line_credit_${i}`)) || 0;
    const category = get(`line_category_${i}`);
    const nominal_code = get(`line_code_${i}`) || null;

    if (!lineDesc && debit === 0 && credit === 0) continue;
    if (!lineDesc || !category || (debit === 0 && credit === 0)) {
      redirect(`/accounts-production/${trialBalanceId}/journal/${journalId}?journal_error=Every+line+needs+a+description,+category,+and+a+debit+or+credit+amount`);
    }

    rows.push({ nominal_code, description: lineDesc, debit, credit, category });
  }

  if (rows.length < 2) {
    redirect(`/accounts-production/${trialBalanceId}/journal/${journalId}?journal_error=A+journal+needs+at+least+two+lines`);
  }

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  if (Math.abs(totalDebit - totalCredit) >= 0.01) {
    redirect(`/accounts-production/${trialBalanceId}/journal/${journalId}?journal_error=Journal+does+not+balance+%E2%80%94+Dr+£${totalDebit.toFixed(2)}+vs+Cr+£${totalCredit.toFixed(2)}`);
  }

  await supabase.from("journals").update({ reference: reference || null, description, journal_date }).eq("id", journalId);

  // Simplest safe approach: replace all lines for this journal rather than diffing individual rows
  await supabase.from("trial_balance_lines").delete().eq("journal_id", journalId);
  await supabase.from("trial_balance_lines").insert(
    rows.map((r) => ({ trial_balance_id: trialBalanceId, journal_id: journalId, ...r }))
  );

  for (const r of rows) {
    if (r.nominal_code) {
      await supabase.from("nominal_code_mappings").upsert(
        { client_id: clientId, nominal_code: r.nominal_code, category: r.category },
        { onConflict: "client_id,nominal_code" }
      );
    }
  }

  revalidatePath(`/accounts-production/${trialBalanceId}`);
  revalidatePath("/accounts-production");
  redirect(`/accounts-production/${trialBalanceId}`);
}

export default async function EditJournalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; journalId: string }>;
  searchParams: Promise<{ journal_error?: string }>;
}) {
  const { id, journalId } = await params;
  const { journal_error } = await searchParams;

  const [{ data: tb, error }, { data: journal }, { data: journalLines }, { data: accounts }] = await Promise.all([
    supabase.from("trial_balances").select("*, clients(client_name)").eq("id", id).single(),
    supabase.from("journals").select("*").eq("id", journalId).single(),
    supabase.from("trial_balance_lines").select("*").eq("journal_id", journalId).order("nominal_code", { ascending: true }),
    supabase.from("chart_of_accounts").select("nominal_code, account_name, category").order("nominal_code", { ascending: true }),
  ]);

  if (error || !tb || !journal) notFound();

  const updateJournalWithIds = updateJournal.bind(null, id, journalId, tb.client_id);

  const initialLines = (journalLines || []).map((l) => ({
    code: l.nominal_code || "",
    description: l.description,
    category: l.category || "",
    debit: Number(l.debit) > 0 ? String(l.debit) : "",
    credit: Number(l.credit) > 0 ? String(l.credit) : "",
  }));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href={`/accounts-production/${id}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Trial Balance
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">Edit Journal</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {(tb.clients as any)?.client_name} · Period {new Date(tb.period_start).toLocaleDateString("en-GB")} to {new Date(tb.period_end).toLocaleDateString("en-GB")}
        </p>
      </div>

      <div className="p-8">
        {journal_error && (
          <div className="mb-6 rounded-2xl bg-red-50 border border-red-100 p-4">
            <p className="text-sm font-bold text-red-700">⚠ {decodeURIComponent(journal_error).replace(/\+/g, " ")}</p>
          </div>
        )}

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <p className="text-sm text-slate-500">
            Editing replaces this journal's lines entirely with what's saved here. Debits must equal credits.
          </p>
          <form action={updateJournalWithIds} className="mt-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
                <input name="journal_description" required defaultValue={journal.description}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reference</label>
                <input name="journal_reference" defaultValue={journal.reference || ""}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <input name="journal_date" type="date" defaultValue={journal.journal_date || ""}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wide px-1">
              <span className="w-24">Code</span>
              <span className="flex-1 min-w-[200px]">Description</span>
              <span className="w-56">Category</span>
              <span className="w-28 text-right">Debit</span>
              <span className="w-28 text-right">Credit</span>
            </div>

            <JournalLinesEditor accounts={accounts || []} plCategories={PL_CATEGORIES} bsCategories={BS_CATEGORIES} initialLines={initialLines} />

            <button type="submit"
              className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Save Changes
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
