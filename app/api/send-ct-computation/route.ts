import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import crypto from "crypto";
import { calculateCorporationTax, applyLossRelief } from "../../corporation-tax/page";
import { calculateCapitalAllowances } from "../../fixed-assets/capital-allowances/page";
import { calculateS455 } from "../../directors-loan-account/page";

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
    .from("corporation_tax_computations")
    .select("*, clients(client_name)")
    .eq("id", computationId)
    .single();

  if (error || !comp) {
    return NextResponse.json({ error: "Corporation Tax computation not found" }, { status: 404 });
  }

  await supabase
    .from("corporation_tax_computations")
    .update({ token, client_email: clientEmail, status: "Sent" })
    .eq("id", computationId);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const computationUrl = `${baseUrl}/ct/${token}`;

  // Recalculate for the email summary — mirrors the detail page's own calculation
  const { data: assets } = await supabase.from("fixed_assets").select("*").eq("client_id", comp.client_id);
  const ca = calculateCapitalAllowances({
    assets: assets || [],
    periodStart: comp.period_start,
    periodEnd: comp.period_end,
    mainPoolBfwd: Number(comp.main_pool_bfwd),
    specialRatePoolBfwd: Number(comp.special_rate_pool_bfwd),
    jobId: comp.job_id,
  });
  const taxableProfitBeforeLosses =
    Number(comp.accounting_profit) + Number(comp.depreciation_addback) + Number(comp.disallowable_expenses) -
    ca.totalCapitalAllowances - Number(comp.other_allowable_deductions);
  const loss = applyLossRelief(taxableProfitBeforeLosses, Number(comp.brought_forward_losses));
  const ct = calculateCorporationTax({
    taxableProfit: loss.taxableProfitAfterLosses,
    periodStart: comp.period_start,
    periodEnd: comp.period_end,
    associatedCompanies: comp.associated_companies,
  });

  const { data: linkedDLAs } = await supabase.from("directors_loan_accounts").select("*").eq("corporation_tax_id", computationId);
  const totalS455 = (linkedDLAs || []).reduce((s, dla) => s + calculateS455({
    closingBalance: Number(dla.closing_balance),
    periodEnd: dla.period_end,
    repaidByDueDate: dla.repaid_by_due_date,
    s455Rate: Number(dla.s455_rate),
  }).s455Due, 0);

  const totalTaxPayable = ct.corporationTax + totalS455;
  const periodEndFormatted = new Date(comp.period_end).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const { error: emailError } = await resend.emails.send({
    from: "PracticePilot <onboarding@resend.dev>",
    to: clientEmail,
    subject: `Your Corporation Tax Computation for the Period Ended ${periodEndFormatted} — E&P Accountancy Services`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0f172a;">Corporation Tax Computation</h2>
        <p>Dear ${comp.clients?.client_name || "Client"},</p>
        <p>Please find your Corporation Tax computation ready for review. You can view the full breakdown and approve it by clicking the button below.</p>

        <div style="margin: 30px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="background: #f8fafc;">
              <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold;">Accounting Period</td>
              <td style="padding: 12px; border: 1px solid #e2e8f0;">${new Date(comp.period_start).toLocaleDateString("en-GB")} to ${periodEndFormatted}</td>
            </tr>
            <tr>
              <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold;">Total Tax Payable</td>
              <td style="padding: 12px; border: 1px solid #e2e8f0;">£${totalTaxPayable.toFixed(2)}</td>
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
