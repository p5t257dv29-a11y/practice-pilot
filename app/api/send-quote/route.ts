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
    return NextResponse.json(
      { error: "Missing quote ID or client email" },
      { status: 400 }
    );
  }

  // Generate unique token
  const token = crypto.randomBytes(32).toString("hex");

  // Fetch quote details
  const { data: quote, error } = await supabase
    .from("quotes")
    .select("*, clients(client_name), quote_lines(*)")
    .eq("id", quoteId)
    .single();

  if (error || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  // Save token and email to quote
  await supabase
    .from("quotes")
    .update({ token, client_email: clientEmail, status: "Sent" })
    .eq("id", quoteId);

  // Build the quote URL
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const quoteUrl = `${baseUrl}/q/${token}`;

  // Send email
  const { error: emailError } = await resend.emails.send({
    from: "PracticePilot <onboarding@resend.dev>",
    to: clientEmail,
    subject: `Quote ${quote.quote_number} from E&P Accountancy Services`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0f172a;">Quote ${quote.quote_number}</h2>
        <p>Dear ${quote.clients?.client_name || "Client"},</p>
        <p>Please find your quote attached. You can view and respond to it by clicking the button below.</p>
        
        <div style="margin: 30px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="background: #f8fafc;">
              <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold;">Quote Number</td>
              <td style="padding: 12px; border: 1px solid #e2e8f0;">${quote.quote_number}</td>
            </tr>
            <tr>
              <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold;">Total</td>
              <td style="padding: 12px; border: 1px solid #e2e8f0;">£${Number(quote.total || 0).toFixed(2)} inc. VAT</td>
            </tr>
            <tr style="background: #f8fafc;">
              <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold;">Valid Until</td>
              <td style="padding: 12px; border: 1px solid #e2e8f0;">${quote.valid_until ? new Date(quote.valid_until).toLocaleDateString("en-GB") : "No expiry"}</td>
            </tr>
          </table>
        </div>

        <a href="${quoteUrl}" 
           style="display: inline-block; background: #0f172a; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">
          View &amp; Respond to Quote
        </a>

        <p style="margin-top: 30px; color: #64748b; font-size: 14px;">
          If you have any questions, please don't hesitate to get in touch.
        </p>
        <p style="color: #64748b; font-size: 14px;">
          Kind regards,<br>
          E&P Accountancy Services
        </p>
      </div>
    `,
  });

  if (emailError) {
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, quoteUrl });
}
