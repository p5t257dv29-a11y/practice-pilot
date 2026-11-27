import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import crypto from "crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

const formatGBP = (amount: number | string | null | undefined) => {
  const num = typeof amount === "string" ? parseFloat(amount) : Number(amount ?? 0);
  if (isNaN(num)) return "£0.00";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

const escapeHtml = (str: string) =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export async function POST(request: NextRequest) {
  const { quoteId, clientEmail } = await request.json();

  if (!quoteId || !clientEmail) {
    return NextResponse.json(
      { error: "Missing quote ID or client email" },
      { status: 400 }
    );
  }

  // Fetch quote details first so we can preserve any existing token on re-sends
  const { data: quote, error } = await supabase
    .from("quotes")
    .select("*, clients(client_name), quote_lines(*)")
    .eq("id", quoteId)
    .single();

  if (error || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  const token = quote.token || crypto.randomBytes(32).toString("hex");

  // Save token and email to quote
  await supabase
    .from("quotes")
    .update({ token, client_email: clientEmail, status: "Sent" })
    .eq("id", quoteId);

  // Build the quote URL
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const quoteUrl = `${baseUrl}/q/${token}`;

  const clientName = escapeHtml(quote.clients?.client_name || "Client");
  const quoteNumber = escapeHtml(quote.quote_number || "");
  const validUntil = quote.valid_until
    ? new Date(quote.valid_until).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "No expiry";

  const lines: any[] = quote.quote_lines || [];
  const scopeRowsHtml = lines
    .map(
      (line) => `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; color: #1e293b; font-size: 14px;">
            ${escapeHtml(line.description || "")}
          </td>
          <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-size: 14px; font-weight: 600; text-align: right; white-space: nowrap;">
            ${formatGBP(line.line_total)}
          </td>
        </tr>
      `
    )
    .join("");

  // Send email
  const { error: emailError } = await resend.emails.send({
    from: "E&P Accountancy Services <onboarding@resend.dev>",
    to: clientEmail,
    subject: `Your Proposal (${quote.quote_number}) from E&P Accountancy Services`,
    html: `
      <div style="background-color: #f1f5f9; padding: 32px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0;">
          
          <!-- Brand Header -->
          <div style="background-color: #020617; padding: 24px 32px; color: #ffffff;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td>
                  <div style="font-size: 16px; font-weight: 700; letter-spacing: -0.01em;">
                    E&amp;P Accountancy Services
                  </div>
                  <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">
                    Client Proposal &amp; Scope of Services
                  </div>
                </td>
                <td style="text-align: right;">
                  <span style="display: inline-block; background-color: rgba(255,255,255,0.12); color: #e2e8f0; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 999px;">
                    ${quoteNumber}
                  </span>
                </td>
              </tr>
            </table>
          </div>

          <!-- Body -->
          <div style="padding: 32px;">
            <p style="margin: 0 0 16px; font-size: 15px; color: #0f172a;">
              Dear ${clientName},
            </p>
            <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #475569;">
              We have prepared a tailored proposal outlining our proposed scope of services and fees. You can review the full breakdown, engagement terms, and accept online using the button below.
            </p>

            <!-- Summary Box -->
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding-bottom: 12px;">
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600;">
                      Total Investment (inc. VAT)
                    </div>
                    <div style="font-size: 24px; font-weight: 700; color: #0f172a; margin-top: 2px;">
                      ${formatGBP(quote.total)}
                    </div>
                  </td>
                  <td style="text-align: right; vertical-align: top; padding-bottom: 12px;">
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600;">
                      Valid Until
                    </div>
                    <div style="font-size: 13px; font-weight: 600; color: #0f172a; margin-top: 4px;">
                      ${validUntil}
                    </div>
                  </td>
                </tr>
              </table>

              ${
                scopeRowsHtml
                  ? `
                <div style="border-top: 1px solid #e2e8f0; padding-top: 12px; margin-top: 4px;">
                  <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; margin-bottom: 6px;">
                    Included Services (excl. VAT)
                  </div>
                  <table style="width: 100%; border-collapse: collapse;">
                    ${scopeRowsHtml}
                  </table>
                </div>
              `
                  : ""
              }
            </div>

            <!-- Primary CTA -->
            <div style="text-align: center; margin: 28px 0;">
              <a href="${quoteUrl}"
                 style="display: inline-block; background-color: #059669; color: #ffffff; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-size: 14px; font-weight: 700;">
                Review &amp; Accept Proposal
              </a>
            </div>

            <p style="margin: 24px 0 8px; font-size: 13px; line-height: 1.6; color: #64748b;">
              If you have any questions or would like to discuss any part of this proposal, simply reply to this email.
            </p>
            <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #475569;">
              Kind regards,<br>
              <strong>E&amp;P Accountancy Services</strong>
            </p>

            <!-- Fallback URL -->
            <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0; font-size: 11px; color: #94a3b8; word-break: break-all;">
                If the button above does not work, copy and paste this link into your browser:<br>
                <a href="${quoteUrl}" style="color: #2563eb; text-decoration: underline;">${quoteUrl}</a>
              </p>
            </div>
          </div>
        </div>
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