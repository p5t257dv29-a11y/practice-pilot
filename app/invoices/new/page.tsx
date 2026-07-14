import { createClient } from "@supabase/supabase-js";
import NewInvoiceForm from "../../new-invoice-form";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function NewInvoicePage() {
  const [{ data: clients }, { data: jobs }] = await Promise.all([
    supabase.from("clients").select("id, client_name").order("client_name", { ascending: true }),
    supabase.from("jobs").select("id, job_name, client_id").order("job_name", { ascending: true }),
  ]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/invoices" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Invoices
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">New Invoice</h1>
      </div>

      <div className="p-8 max-w-4xl">
        <NewInvoiceForm clients={clients || []} jobs={jobs || []} />
      </div>
    </div>
  );
}
