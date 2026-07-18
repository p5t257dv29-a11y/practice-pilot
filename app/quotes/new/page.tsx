import { createClient } from "@supabase/supabase-js";
import NewQuoteForm from "../../new-quote-form";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function NewQuotePage() {
  const [{ data: clients }, { data: services }] = await Promise.all([
    supabase.from("clients").select("id, client_name").order("client_name", { ascending: true }),
    supabase.from("services").select("id, service_name").eq("is_active", true).order("service_name", { ascending: true }),
  ]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/quotes" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Quotes
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">New Quote</h1>
      </div>

      <div className="p-8 max-w-4xl">
        <NewQuoteForm clients={clients || []} services={services || []} />
      </div>
    </div>
  );
}
