import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function disconnectXero(tenantId: string) {
  "use server";
  await supabase.from("xero_connections").delete().eq("tenant_id", tenantId);
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ xero_connected?: string; xero_error?: string }>;
}) {
  const { xero_connected, xero_error } = await searchParams;

  const { data: xeroConnection } = await supabase
    .from("xero_connections")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const disconnectWithId = xeroConnection ? disconnectXero.bind(null, xeroConnection.tenant_id) : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Integrations</h1>
        <p className="text-sm text-slate-500 mt-0.5">Connect PracticePilot to other software you use.</p>
      </div>

      <div className="p-8 max-w-2xl">
        {xero_connected && (
          <div className="mb-4 rounded-xl bg-green-50 border border-green-100 p-3 text-sm text-green-700">
            Successfully connected to Xero.
          </div>
        )}
        {xero_error && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
            Something went wrong connecting to Xero ({xero_error}). Please try again.
          </div>
        )}

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Xero</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Push finalised invoices directly into your connected Xero organisation.
              </p>
            </div>
            {xeroConnection ? (
              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                Connected
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                Not connected
              </span>
            )}
          </div>

          {xeroConnection ? (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
              <span className="text-sm font-medium text-slate-700">
                Connected to: {xeroConnection.tenant_name || xeroConnection.tenant_id}
              </span>
              <form action={disconnectWithId!}>
                <button className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                  Disconnect
                </button>
              </form>
            </div>
          ) : (
            <a href="/api/xero/connect"
              className="mt-4 inline-block rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Connect to Xero
            </a>
          )}
        </div>
      </div>
    </div>
  );
}