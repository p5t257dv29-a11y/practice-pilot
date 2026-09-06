import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import crypto from "crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  const { quoteId, clientEmail } = await request.json();

  if (!quoteId || !clientEmail) {
    return NextResponse.json({ error: "Missing quote ID or client email" }, { status: 400 });
  }

  const token = crypto.randomBytes(32).toString("hex");

  const { data: quote, error } = await supabase
    .from("quotes")
    .select("*, clients(client_name)")
    .eq("id", quoteId)
    .single();

  if (error || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  await supabase.from("quotes").update({ token, client_email: clientEmail, status: "Sent" }).eq("id", quoteId);
  await supabase.from("engagement_letters").update({ status: "Sent", sent_at: new Date().toISOString(), client_email: clientEmail }).eq("quote_id", quoteId);

  const { data: settings } = await supabase.from("practice_settings").select("firm_name").limit(1).maybeSingle();
  const firmName = settings?.firm_name || "Your Accountant";

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const renewalUrl = `${baseUrl}/renewal/${token}`;

  const { error: emailError } = await resend.emails.send({
    from: `${firmName} <onboarding@resend.dev>`,
    to: clientEmail,
    subject: `Your Annual Renewal — ${firmName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0f172a;">Time to renew your engagement with us</h2>
        <p>Dear ${quote.clients?.client_name || "Client"},</p>
        <p>Ahead of the year ahead, please find our proposed services and fee for continuing to work together, along with the terms of engagement.</p>

        <div style="margin: 30px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="background: #f8fafc;">
              <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold;">Total Fee</td>
              <td style="padding: 12px; border: 1px solid #e2e8f0;">£${Number(quote.total).toFixed(2)}</td>
            </tr>
          </table>
        </div>

        <a href="${renewalUrl}"
           style="display: inline-block; background: #0f172a; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">
          Review & Approve Renewal
        </a>

        <p style="margin-top: 30px; color: #64748b; font-size: 14px;">
          Approving confirms both the fee and the terms of engagement for the coming year. Let us know if you have any questions.
        </p>
        <p style="color: #64748b; font-size: 14px;">
          Kind regards,<br>
          ${firmName}
        </p>
      </div>
    `,
  });

  if (emailError) {
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }

  return NextResponse.json({ success: true, renewalUrl });
}