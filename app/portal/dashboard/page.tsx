import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import PortalSignOutButton from "../portal-signout-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function sendPortalMessage(clientId: string, clientName: string, formData: FormData) {
  "use server";
  const messageText = String(formData.get("message_text") || "").trim();
  if (!messageText) return;

  await supabase.from("client_messages").insert({
    client_id: clientId,
    sender: "client",
    sender_name: clientName,
    message_text: messageText,
    read_by_client: true,
    read_by_staff: false,
  });

  revalidatePath("/portal/dashboard");
}

async function markMessagesReadByClient(clientId: string) {
  "use server";
  await supabase.from("client_messages").update({ read_by_client: true }).eq("client_id", clientId).eq("read_by_client", false);
  revalidatePath("/portal/dashboard");
}

async function uploadClientPortalDocument(clientId: string, formData: FormData) {
  "use server";
  const file = formData.get("document") as File | null;
  const description = String(formData.get("description") || "").trim();
  if (!file || file.size === 0) return;

  const storagePath = `${clientId}/${Date.now()}-${file.name}`;
  const fileBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from("client-portal-documents")
    .upload(storagePath, fileBuffer, { contentType: file.type });

  if (uploadError) {
    console.error("Could not upload document:", uploadError.message);
    return;
  }

  await supabase.from("client_documents").insert({
    client_id: clientId,
    uploaded_by: "client",
    file_name: file.name,
    storage_path: storagePath,
    file_size: file.size,
    description: description || null,
  });

  revalidatePath("/portal/dashboard");
}
export default async function PortalDashboardPage() {
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    }
  );

  const { data: { user } } = await supabaseAuth.auth.getUser();
  const clientId = user?.user_metadata?.client_id;

  if (!user || !clientId) {
    redirect("/portal/login");
  }

  const [
    { data: client },
    { data: taxComputations },
    { data: ctComputations },
    { data: p11dComputations },
    { data: trialBalances },
    { data: documents },
    { data: messages },
  ] = await Promise.all([
    supabase.from("clients").select("client_name").eq("id", clientId).single(),
    supabase.from("tax_computations").select("id, tax_year, status").eq("client_id", clientId).eq("status", "Sent"),
    supabase.from("corporation_tax_computations").select("id, period_start, period_end, approval_token").eq("client_id", clientId).eq("status", "Sent"),
    supabase.from("p11d_computations").select("id, tax_year, employee_name, status").eq("client_id", clientId).eq("status", "Sent"),
    supabase.from("trial_balances").select("id, period_start, period_end, accounts_type, approval_token, approval_status").eq("client_id", clientId).eq("approval_status", "Sent"),
    supabase.from("client_documents").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase.from("client_messages").select("*").eq("client_id", clientId).order("created_at", { ascending: true }),
  ]);

  const unreadFromStaff = (messages || []).filter((m) => m.sender === "staff" && !m.read_by_client).length;
  if (unreadFromStaff > 0) {
    await markMessagesReadByClient(clientId);
  }

  const sendMessageWithId = sendPortalMessage.bind(null, clientId, client?.client_name || "");
const uploadDocWithId = uploadClientPortalDocument.bind(null, clientId);
  const documentsWithUrls = await Promise.all(
    (documents || []).map(async (doc) => {
      const { data: signed } = await supabase.storage
        .from("client-portal-documents")
        .createSignedUrl(doc.storage_path, 300);
      return { ...doc, url: signed?.signedUrl || null };
    })
  );

  const pendingApprovals = [
    ...(taxComputations || []).map((t) => ({
      key: `tax-${t.id}`,
      label: `Personal Tax ${t.tax_year}`,
      href: `/tax/approve/${t.id}`,
    })),
    ...(p11dComputations || []).map((p) => ({
      key: `p11d-${p.id}`,
      label: `P11D — ${p.employee_name} (${p.tax_year})`,
      href: `/p11d/approve/${p.id}`,
    })),
    ...(trialBalances || []).map((tb) => ({
      key: `tb-${tb.id}`,
      label: `${tb.accounts_type || "Accounts"} — ${new Date(tb.period_start).toLocaleDateString("en-GB")} to ${new Date(tb.period_end).toLocaleDateString("en-GB")}`,
      href: `/a/${tb.approval_token}`,
    })),
  ];

  const fmtFileSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{client?.client_name || "Your Portal"}</h1>
            <p className="text-sm text-slate-500 mt-0.5">Client Portal</p>
          </div>
          <PortalSignOutButton />
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-8 space-y-6">

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Awaiting Your Approval</h2>
          <p className="text-sm text-slate-500 mt-0.5">Review and approve these items whenever you're ready.</p>

          <div className="mt-4 space-y-2">
            {pendingApprovals.map((item) => (
              <a key={item.key} href={item.href} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                <p className="font-semibold text-slate-900">{item.label}</p>
                <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-700">
                  Awaiting Review
                </span>
              </a>
            ))}
            {pendingApprovals.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">Nothing awaiting your approval right now.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Messages</h2>
          <p className="text-sm text-slate-500 mt-0.5">Message your accountant directly.</p>

          <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
            {(messages || []).map((m: any) => (
              <div key={m.id} className={`rounded-xl p-3 max-w-[80%] ${m.sender === "client" ? "bg-blue-600 text-white ml-auto" : "bg-slate-100 text-slate-900"}`}>
                <p className="text-sm whitespace-pre-wrap">{m.message_text}</p>
                <p className={`text-xs mt-1 ${m.sender === "client" ? "text-blue-100" : "text-slate-400"}`}>
                  {m.sender === "client" ? "You" : "Your Accountant"} · {new Date(m.created_at).toLocaleDateString("en-GB")} at {new Date(m.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            ))}
            {(!messages || messages.length === 0) && (
              <p className="text-sm text-slate-400 text-center py-6">No messages yet.</p>
            )}
          </div>

          <form action={sendMessageWithId} className="mt-4 flex gap-2 items-end border-t border-slate-100 pt-4">
            <textarea name="message_text" rows={2} required placeholder="Type a message..."
              className="flex-1 rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <button type="submit"
              className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
              Send
            </button>
          </form>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Documents</h2>
          <p className="text-sm text-slate-500 mt-0.5">Shared between you and your accountant.</p>

          <div className="mt-4 space-y-2">
            {documentsWithUrls.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg flex-shrink-0">📄</span>
                  <div className="min-w-0">
                    {doc.url ? (
                      <a href={doc.url} target="_blank" rel="noopener noreferrer"
                        className="text-sm font-medium text-blue-600 hover:underline truncate block">
                        {doc.file_name}
                      </a>
                    ) : (
                      <span className="text-sm font-medium text-slate-900 truncate block">{doc.file_name}</span>
                    )}
                    <p className="text-xs text-slate-400">
                      {doc.uploaded_by === "client" ? "Uploaded by you" : "Uploaded by your accountant"}
                      {doc.description && ` · ${doc.description}`}
                      {" · "}{fmtFileSize(doc.file_size)} · {new Date(doc.created_at).toLocaleDateString("en-GB")}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {documentsWithUrls.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-6">No documents shared yet.</p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}