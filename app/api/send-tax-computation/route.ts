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
  const { computationId, clientEmail } = await request.json();

  if (!computationId || !clientEmail) {
    return NextResponse.json(
      { error: "Missing computation ID or client email" },
      { status: 400 }
    );
  }

  const token = crypto.randomBytes(32).toString("hex");

  const { data: comp, error } = await supabase
    .from("tax_computations")
    .select("*, clients(client_name)")
    .eq("id", computationId)
    .single();

  if (error || !comp) {
    return NextResponse.json({ error: "Tax computation not found" }, { status: 404 });
  }

  await supabase
    .from("tax_computations")
    .update({ token, client_email: clientEmail, status: "Sent" })
    .eq("id", computationId);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const computationUrl = `${baseUrl}/t/${token}`;

  // Recalculate totals for the email summary (mirrors the on-page calculation)
  const employment = Number(comp.employment_income);
  const selfEmployment = Number(comp.self_employment_income);
  const rental = Number(comp.rental_income);
  const pension = Number(comp.pension_income);
  const interest = Number(comp.interest_income);
  const dividends = Number(comp.dividend_income);
  const totalIncome = employment + selfEmployment + rental + pension + interest + dividends;

  const { error: emailError } = await resend.emails.send({
    from: "PracticePilot <onboarding@resend.dev>",
    to: clientEmail,
    subject: `Your ${comp.tax_year} Tax Computation from E&P Accountancy Services`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0f172a;">Tax Computation ${comp.tax_year}</h2>
        <p>Dear ${comp.clients?.client_name || "Client"},</p>
        <p>Please find your tax computation summary below. You can review the full breakdown and approve it by clicking the button below.</p>

        <div style="margin: 30px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="background: #f8fafc;">
              <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold;">Tax Year</td>
              <td style="padding: 12px; border: 1px solid #e2e8f0;">${comp.tax_year}</td>
            </tr>
            <tr>
              <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold;">Total Income</td>
              <td style="padding: 12px; border: 1px solid #e2e8f0;">£${totalIncome.toFixed(2)}</td>
            </tr>
          </table>
        </div>

        <a href="${computationUrl}"
           style="display: inline-block; background: #0f172a; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">
          View &amp; Approve Computation
        </a>

        <p style="margin-top: 30px; color: #64748b; font-size: 14px;">
          Please review the figures carefully and let us know if anything looks incorrect before we proceed to file.
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

  return NextResponse.json({ success: true, computationUrl });
}
