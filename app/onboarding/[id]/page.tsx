import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { Resend } from "resend";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import OnboardingSendButton from "../onboarding-send-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

async function updateChecklist(id: string, formData: FormData) {
  "use server";

  await supabase.from("onboarding_requests").update({
    id_received: formData.get("id_received") === "on",
    prev_accounts_received: formData.get("prev_accounts_received") === "on",
    signed_engagement_received: formData.get("signed_engagement_received") === "on",
    clearance_received: formData.get("clearance_received") === "on",
    prev_accountant_name: String(formData.get("prev_accountant_name") || ""),
    prev_accountant_firm: String(formData.get("prev_accountant_firm") || ""),
    prev_accountant_email: String(formData.get("prev_accountant_email") || ""),
    notes: String(formData.get("notes") || ""),
  }).eq("id", id);

  revalidatePath(`/onboarding/${id}`);
}

async function markClientFormSent(id: string) {
  "use server";

  const { data: request } = await supabase
    .from("onboarding_requests")
    .select("token, clients(client_name, email)")
    .eq("id", id)
    .single();

  const client = request?.clients as any;
  const recipientEmail = client?.email;

  if (recipientEmail && request?.token) {
    const { data: settings } = await supabase.from("practice_settings").select("firm_name").limit(1).maybeSingle();
    const firmName = settings?.firm_name || "Your Accountant";
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const formUrl = `${baseUrl}/onboard/${request.token}`;

    await resend.emails.send({
      from: `${firmName} <onboarding@resend.dev>`,
      to: recipientEmail,
      subject: `Welcome — please complete your details for ${firmName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #0f172a;">Welcome, ${client?.client_name || "there"}!</h2>
          <p>To get started, please complete your details using the secure link below.</p>
          <a href="${formUrl}"
             style="display: inline-block; background: #0f172a; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 20px 0;">
            Complete Your Details
          </a>
          <p style="color: #64748b; font-size: 14px;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            ${formUrl}
          </p>
          <p style="color: #64748b; font-size: 14px;">
            Kind regards,<br>
            ${firmName}
          </p>
        </div>
      `,
    });
  }

  await supabase.from("onboarding_requests").update({
    sent_at: new Date().toISOString(),
    status: "In Progress",
  }).eq("id", id);

  revalidatePath(`/onboarding/${id}`);
}
// Generates the actual Professional Clearance Letter as a PDF, using the
// real content already shown on this page — not a shortened version.
// Wraps long lines manually since pdf-lib has no built-in text wrapping.
async function generateClearanceLetterPDF(data: {
  prevAccountantName: string;
  prevAccountantFirm: string;
  prevAccountantEmail: string;
  clientName: string;
  companyNumber: string | null;
  letterDate: string;
}) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595, 842]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  const pageWidth = 595;
  const maxWidth = pageWidth - margin * 2;
  let y = 792;

  const wrapText = (text: string, fontToUse: typeof font, size: number) => {
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (fontToUse.widthOfTextAtSize(test, size) > maxWidth) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  const addLine = (text: string, opts: { size?: number; font?: typeof font; gapAfter?: number } = {}) => {
    const size = opts.size || 11;
    const useFont = opts.font || font;
    if (y < margin + 30) {
      page = pdfDoc.addPage([595, 842]);
      y = 792;
    }
    for (const line of wrapText(text, useFont, size)) {
      if (y < margin + 30) {
        page = pdfDoc.addPage([595, 842]);
        y = 792;
      }
      page.drawText(line, { x: margin, y, size, font: useFont, color: rgb(0.1, 0.1, 0.1) });
      y -= size * 1.4;
    }
    y -= opts.gapAfter ?? 6;
  };

  addLine("Professional Clearance Letter", { size: 16, font: boldFont, gapAfter: 16 });
  addLine(`To: ${data.prevAccountantName} — ${data.prevAccountantFirm}`);
  addLine(`Email: ${data.prevAccountantEmail}`, { gapAfter: 16 });
  addLine(data.letterDate, { gapAfter: 12 });
  addLine(`Dear ${data.prevAccountantName || "Sir/Madam"},`, { gapAfter: 12 });
  addLine(`Re: ${data.clientName}${data.companyNumber ? ` (Company No. ${data.companyNumber})` : ""}`, { font: boldFont, gapAfter: 12 });
  addLine("We have been appointed as accountants for the above client and, in accordance with professional clearance procedures, would be grateful if you could provide the following information at your earliest convenience:", { gapAfter: 16 });

  addLine("1. General handover", { font: boldFont, gapAfter: 4 });
  addLine("•  Confirmation of any professional reason why we should not accept this appointment.");
  addLine("•  Copies of the last set of filed accounts and tax computations.", { gapAfter: 12 });

  addLine("2. VAT", { font: boldFont, gapAfter: 4 });
  addLine("•  Copies of the last four VAT returns filed, and details of the current VAT scheme used.", { gapAfter: 12 });

  addLine("3. Payroll", { font: boldFont, gapAfter: 4 });
  addLine("•  Copies of the most recent P60s, and any P11Ds/P11D(b) submitted, for all employees and directors.");
  addLine("•  Auto-enrolment pension details: provider, staging/duties start date, contribution rates, and next re-enrolment date.");
  addLine("•  If the Client engages subcontractors: CIS scheme details, contractor/subcontractor status, and CIS return history.", { gapAfter: 12 });

  addLine("5. HMRC references and agent authorisation", { font: boldFont, gapAfter: 4 });
  addLine("•  Unique Taxpayer Reference (UTR) — corporate and, where relevant, personal.");
  addLine("•  VAT registration number, PAYE reference, and Accounts Office reference (if not already provided above).");
  addLine("•  Confirmation that you will remove/deauthorise your firm as agent on HMRC's systems (Government Gateway / Agent Services Account) once we are authorised, or confirmation of the taxes/services for which you currently hold authorisation.");
  addLine("•  Details of any HMRC online services enrolments relevant to the Client that we should be aware of.", { gapAfter: 12 });

  addLine("6. HMRC enquiries, disputes and correspondence", { font: boldFont, gapAfter: 4 });
  addLine("•  Details of any current or recent HMRC enquiries, compliance checks, or disputes, including correspondence reference numbers.", { gapAfter: 16 });

  addLine("Please let us know if you require any further information from us to action this request.", { gapAfter: 16 });
  addLine("Yours faithfully,");

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes).toString("base64");
}

async function markClearanceSent(id: string) {
  "use server";

  const { data: request } = await supabase
    .from("onboarding_requests")
    .select("prev_accountant_name, prev_accountant_firm, prev_accountant_email, clients(client_name, company_number)")
    .eq("id", id)
    .single();

  const client = request?.clients as any;
  let emailError: string | null = null;

  if (request?.prev_accountant_email) {
    const { data: settings } = await supabase.from("practice_settings").select("firm_name").limit(1).maybeSingle();
    const firmName = settings?.firm_name || "Your Accountant";
    const letterDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

    const pdfBase64 = await generateClearanceLetterPDF({
      prevAccountantName: request.prev_accountant_name || "",
      prevAccountantFirm: request.prev_accountant_firm || "",
      prevAccountantEmail: request.prev_accountant_email || "",
      clientName: client?.client_name || "Client",
      companyNumber: client?.company_number || null,
      letterDate,
    });

    const { error } = await resend.emails.send({
      from: `${firmName} <onboarding@resend.dev>`,
      to: request.prev_accountant_email,
      subject: `Professional Clearance Request — ${client?.client_name || "Client"}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #0f172a;">Professional Clearance Request</h2>
          <p>Dear ${request.prev_accountant_name || "Sir/Madam"},</p>
          <p>
            Please find attached our professional clearance letter regarding
            <strong>${client?.client_name || "the above client"}</strong>.
          </p>
          <p>
            Please reply directly to this email with the requested information at your earliest convenience.
          </p>
          <p style="color: #64748b; font-size: 14px; margin-top: 30px;">
            Kind regards,<br>
            ${firmName}
          </p>
        </div>
      `,
      attachments: [
        {
          filename: `Professional-Clearance-Letter-${(client?.client_name || "Client").replace(/[^a-zA-Z0-9]/g, "-")}.pdf`,
          content: pdfBase64,
        },
      ],
    });

    if (error) {
      console.error("Failed to send clearance letter email:", error);
      emailError = error.message || "Unknown error sending email";
    }
  } else {
    emailError = "No email address on file for the previous accountant";
  }

  await supabase.from("onboarding_requests").update({
    clearance_sent_at: new Date().toISOString(),
    clearance_send_error: emailError,
  }).eq("id", id);

  revalidatePath(`/onboarding/${id}`);
}

export default async function OnboardingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: request, error } = await supabase
    .from("onboarding_requests")
    .select("*, clients(client_name, company_number, address, email)")
    .eq("id", id)
    .single();

  if (error || !request) notFound();

  const updateChecklistWithId = updateChecklist.bind(null, id);
  const markClientFormSentWithId = markClientFormSent.bind(null, id);
  const markClearanceSentWithId = markClearanceSent.bind(null, id);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const clientFormUrl = `${baseUrl}/onboard/${request.token}`;

  const letterDate = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const completedItems = [
    request.id_received,
    request.prev_accounts_received,
    request.signed_engagement_received,
    request.clearance_received,
  ].filter(Boolean).length;

  const client = request.clients as any;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/onboarding" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Onboarding
        </a>

        <div className="mt-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {client?.client_name || "Client"}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">{client?.email}</p>
          </div>
          <span className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
            {request.status || "Pending"}
          </span>
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Onboarding progress</span>
            <span className="text-slate-500">{completedItems}/4 items complete</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all"
              style={{ width: `${(completedItems / 4) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">

        {/* Left - main content */}
        <div className="lg:col-span-2 space-y-6">

          {/* Client Information Form */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Client Information Form</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Send this link to the client — they fill in all their details online.
            </p>

            <div className="mt-4 rounded-xl bg-slate-50 border border-slate-100 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Client form link:</p>
              <a href={clientFormUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline break-all">
                {clientFormUrl}
              </a>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <a href={clientFormUrl} target="_blank" rel="noopener noreferrer"
                className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                Preview Form →
              </a>
              {!request.sent_at ? (
                <OnboardingSendButton action={markClientFormSentWithId} alreadySent={false} />
              ) : (
                <>
                  <OnboardingSendButton action={markClientFormSentWithId} alreadySent={true} />
                  <span className="rounded-xl bg-green-50 px-4 py-2 text-sm font-semibold text-green-700">
                    ✓ Sent {new Date(request.sent_at).toLocaleDateString("en-GB")}
                  </span>
                </>
              )}
            </div>

            {request.completed_at && (
              <div className="mt-3 rounded-xl bg-green-50 border border-green-100 p-3">
                <p className="text-sm font-semibold text-green-700">
                  ✓ Client completed the form on {new Date(request.completed_at).toLocaleDateString("en-GB")}
                </p>
              </div>
            )}
          </div>

          {/* Professional Clearance Letter */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Professional Clearance Letter</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Comprehensive handover request sent to the previous accountant.
            </p>

            <div className="mt-4 rounded-xl bg-slate-50 border border-slate-100 p-6 text-sm text-slate-700 space-y-3">
              <p><strong>To:</strong> {request.prev_accountant_name || "—"} — {request.prev_accountant_firm || "—"}</p>
              <p><strong>Email:</strong> {request.prev_accountant_email || "—"}</p>
              <p className="pt-2">{letterDate}</p>
              <p>Dear {request.prev_accountant_name || "Sir/Madam"},</p>
              <p>
                Re: <strong>{client?.client_name}</strong>
                {client?.company_number && ` (Company No. ${client.company_number})`}
              </p>
              <p>
                We have been appointed as accountants for the above client and, in accordance with
                professional clearance procedures, would be grateful if you could provide the following
                information at your earliest convenience:
              </p>

              <p className="font-semibold pt-2">1. General handover</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Confirmation of any professional reason why we should not accept this appointment.</li>
                <li>Copies of the last set of filed accounts and tax computations.</li>
              </ul>

              <p className="font-semibold pt-2">2. VAT</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Copies of the last four VAT returns filed, and details of the current VAT scheme used.</li>
              </ul>

              <p className="font-semibold pt-2">3. Payroll</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Copies of the most recent P60s, and any P11Ds/P11D(b) submitted, for all employees and directors.</li>
                <li>Auto-enrolment pension details: provider, staging/duties start date, contribution rates, and next re-enrolment date.</li>
                <li>If the Client engages subcontractors: CIS scheme details, contractor/subcontractor status, and CIS return history.</li>
              </ul>

              <p className="font-semibold pt-2">5. HMRC references and agent authorisation</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Unique Taxpayer Reference (UTR) — corporate and, where relevant, personal.</li>
                <li>VAT registration number, PAYE reference, and Accounts Office reference (if not already provided above).</li>
                <li>Confirmation that you will remove/deauthorise your firm as agent on HMRC's systems (Government Gateway / Agent Services Account) once we are authorised, or confirmation of the taxes/services for which you currently hold authorisation.</li>
                <li>Details of any HMRC online services enrolments relevant to the Client that we should be aware of.</li>
              </ul>

              <p className="font-semibold pt-2">6. HMRC enquiries, disputes and correspondence</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Details of any current or recent HMRC enquiries, compliance checks, or disputes, including correspondence reference numbers.</li>
              </ul>

              <p className="pt-3">
                Please let us know if you require any further information from us to action this request.
              </p>
              <p className="pt-2">Yours faithfully,</p>
            </div>

            <div className="mt-4 flex items-center gap-3">
              {!request.clearance_sent_at ? (
                <OnboardingSendButton action={markClearanceSentWithId} alreadySent={false} />
              ) : (
                <>
                  <OnboardingSendButton action={markClearanceSentWithId} alreadySent={true} />
                  <span className="rounded-xl bg-green-50 px-4 py-2 text-sm font-semibold text-green-700">
                    ✓ Sent {new Date(request.clearance_sent_at).toLocaleDateString("en-GB")}
                  </span>
                </>
              )}
            </div>
            {request.clearance_send_error && (
              <div className="mt-3 rounded-xl bg-red-50 border border-red-100 p-3">
                <p className="text-sm font-semibold text-red-700">⚠ Email may not have been delivered</p>
                <p className="text-xs text-red-600 mt-1">{request.clearance_send_error}</p>
              </div>
            )}
          </div>

          {/* Checklist */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Onboarding Checklist</h2>
            <form action={updateChecklistWithId} className="mt-4 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" name="id_received" defaultChecked={request.id_received} className="w-4 h-4 rounded" />
                <span className="text-sm text-slate-700">Proof of ID / AML checks received</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" name="prev_accounts_received" defaultChecked={request.prev_accounts_received} className="w-4 h-4 rounded" />
                <span className="text-sm text-slate-700">Previous accounts received</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" name="signed_engagement_received" defaultChecked={request.signed_engagement_received} className="w-4 h-4 rounded" />
                <span className="text-sm text-slate-700">Signed engagement letter received</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" name="clearance_received" defaultChecked={request.clearance_received} className="w-4 h-4 rounded" />
                <span className="text-sm text-slate-700">Professional clearance received</span>
              </label>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1 mt-4">Notes</label>
                <textarea name="notes" defaultValue={request.notes || ""} rows={3}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <button type="submit"
                className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save Checklist
              </button>
            </form>
          </div>
        </div>

        {/* Right - Details */}
        <div className="space-y-6">

          {/* Previous Accountant */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Previous Accountant</h2>

            <form action={updateChecklistWithId} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Contact Name</label>
                <input name="prev_accountant_name" defaultValue={request.prev_accountant_name || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="e.g. John Smith" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Firm Name</label>
                <input name="prev_accountant_firm" defaultValue={request.prev_accountant_firm || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="e.g. Smith & Co" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input name="prev_accountant_email" type="email" defaultValue={request.prev_accountant_email || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="prev@accountant.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                <textarea name="prev_accountant_address" rows={2}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="Full address" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" defaultValue={request.notes || ""} rows={2}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <button type="submit"
                className="w-full rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save Details
              </button>
            </form>
          </div>

          {/* Client Info */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Client Info</h2>
            <div className="mt-4 space-y-2 text-sm">
              <p><span className="text-slate-500">Company:</span> {client?.client_name}</p>
              <p><span className="text-slate-500">Company No:</span> {client?.company_number}</p>
              <p><span className="text-slate-500">Address:</span> {client?.address || "—"}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}