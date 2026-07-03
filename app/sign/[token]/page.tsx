import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateLetter(id: string, formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  await supabase.from("engagement_letters").update({
    client_email: get("client_email"),
    services_description: get("services_description"),
    fee_description: get("fee_description"),
    start_date: get("start_date") || null,
    partner_name: get("partner_name"),
    custom_terms: get("custom_terms"),
    notes: get("notes"),
  }).eq("id", id);

  revalidatePath(`/engagement/${id}`);
}

async function markAsSent(id: string) {
  "use server";

  await supabase.from("engagement_letters").update({
    sent_at: new Date().toISOString(),
    status: "Sent",
  }).eq("id", id);

  revalidatePath(`/engagement/${id}`);
}

export default async function EngagementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: letter, error } = await supabase
    .from("engagement_letters")
    .select("*, clients(client_name, company_number, address)")
    .eq("id", id)
    .single();

  if (error || !letter) notFound();

  const updateWithId = updateLetter.bind(null, id);
  const markAsSentWithId = markAsSent.bind(null, id);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const signingUrl = `${baseUrl}/sign/${letter.token}`;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/engagement" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Engagement Letters
        </a>

        <div className="mt-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {letter.clients?.client_name || "Unknown Client"}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">Letter of Engagement</p>
          </div>

          <span className={`rounded-full px-4 py-2 text-sm font-semibold ${
            letter.status === "Signed" ? "bg-green-100 text-green-700"
            : letter.status === "Sent" ? "bg-blue-100 text-blue-700"
            : "bg-slate-100 text-slate-600"
          }`}>
            {letter.status}
          </span>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">

        {/* Left - Letter preview and sending */}
        <div className="lg:col-span-2 space-y-6">

          {/* Letter Preview */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Letter Preview</h2>

            {/* Actual letter */}
            <div className="border border-slate-200 rounded-xl p-8 bg-white text-sm text-slate-700 leading-relaxed space-y-4">
              
              <div className="text-right text-xs text-slate-400">
                {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
              </div>

              <div>
                <p className="font-bold text-slate-900">E&P Accountancy Services Limited</p>
                <p className="text-xs text-slate-500 mt-1">Letter of Engagement</p>
              </div>

              <div>
                <p className="font-semibold">{letter.clients?.client_name}</p>
                {letter.clients?.address && (
                  <p className="text-slate-500 text-xs mt-0.5">{letter.clients.address}</p>
                )}
              </div>

              <p>Dear {letter.clients?.client_name},</p>

              <p>
                We are pleased to confirm our appointment as your accountants and tax advisers
                {letter.start_date && ` with effect from ${new Date(letter.start_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}.
                This letter sets out the terms of our engagement.
              </p>

              <div>
                <p className="font-semibold text-slate-900">Services</p>
                <p className="mt-1 whitespace-pre-line">{letter.services_description || "Services to be confirmed."}</p>
              </div>

              <div>
                <p className="font-semibold text-slate-900">Fees</p>
                <p className="mt-1 whitespace-pre-line">{letter.fee_description || "Fees to be confirmed."}</p>
              </div>

              <div>
                <p className="font-semibold text-slate-900">Your Responsibilities</p>
                <p className="mt-1">
                  You are responsible for maintaining adequate accounting records and for preparing 
                  accounts which give a true and fair view. You are also responsible for making 
                  available to us all information of which you are aware that is relevant to the 
                  preparation of the accounts.
                </p>
              </div>

              <div>
                <p className="font-semibold text-slate-900">Our Responsibilities</p>
                <p className="mt-1">
                  We will prepare your accounts and tax returns using the information and 
                  explanations provided to us. We will not be responsible for errors arising 
                  from incorrect or incomplete information provided by you.
                </p>
              </div>

              <div>
                <p className="font-semibold text-slate-900">Confidentiality</p>
                <p className="mt-1">
                  We confirm that we will keep your affairs strictly confidential and will not 
                  disclose information about your affairs to any third party without your consent, 
                  except where we are required to do so by law or professional regulations.
                </p>
              </div>

              <div>
                <p className="font-semibold text-slate-900">Termination</p>
                <p className="mt-1">
                  Either party may terminate this engagement by giving one month's written notice. 
                  Any outstanding fees will be payable on termination.
                </p>
              </div>

              {letter.custom_terms && (
                <div>
                  <p className="font-semibold text-slate-900">Additional Terms</p>
                  <p className="mt-1 whitespace-pre-line">{letter.custom_terms}</p>
                </div>
              )}

              <p>
                Please sign below to confirm your acceptance of these terms of engagement.
              </p>

              <div className="border-t border-slate-200 pt-4 mt-6">
                <p>Yours sincerely,</p>
                <br />
                <p className="font-semibold">{letter.partner_name || "E&P Accountancy Services Limited"}</p>
              </div>

              <div className="border-t border-slate-200 pt-4 mt-6">
                <p className="text-xs text-slate-500 mb-4">Client acceptance:</p>
                {letter.signed_at ? (
                  <div className="rounded-xl bg-green-50 border border-green-100 p-4">
                    <p className="text-green-700 font-semibold text-sm">
                      ✓ Signed digitally on {new Date(letter.signed_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                    <p className="text-green-600 text-xs mt-1">by {letter.client_email}</p>
                  </div>
                ) : (
                  <p className="text-slate-400 text-xs italic">Awaiting client signature...</p>
                )}
              </div>
            </div>
          </div>

          {/* Send section */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Send for Signing</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Share this link with the client to collect their digital signature.
            </p>

            <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-4">
              <p className="text-xs font-medium text-slate-500 mb-2">Client signing link:</p>
              <p className="text-sm font-mono text-blue-600 break-all">{signingUrl}</p>
            </div>

            <div className="mt-4 flex gap-3">
              <a href={signingUrl} target="_blank" rel="noopener noreferrer"
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                Preview →
              </a>

              {!letter.sent_at ? (
                <form action={markAsSentWithId}>
                  <button type="submit"
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
                    Mark as Sent
                  </button>
                </form>
              ) : (
                <span className="rounded-xl bg-green-50 px-4 py-2 text-sm font-semibold text-green-700">
                  ✓ Sent {new Date(letter.sent_at).toLocaleDateString("en-GB")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right - Edit form */}
        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Edit Letter</h2>

            <form action={updateWithId} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Client Email</label>
                <input name="client_email" type="email" defaultValue={letter.client_email || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                <input name="start_date" type="date" defaultValue={letter.start_date || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Services</label>
                <textarea name="services_description" defaultValue={letter.services_description || ""} rows={4}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Fees</label>
                <textarea name="fee_description" defaultValue={letter.fee_description || ""} rows={3}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Partner Name</label>
                <input name="partner_name" defaultValue={letter.partner_name || "E&P Accountancy Services Limited"}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Additional Terms</label>
                <textarea name="custom_terms" defaultValue={letter.custom_terms || ""} rows={3}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" defaultValue={letter.notes || ""} rows={2}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <button type="submit"
                className="w-full rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save Changes
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
