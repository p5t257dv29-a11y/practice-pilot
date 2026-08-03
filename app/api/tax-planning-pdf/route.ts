import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { calculateTax, getTaxRates } from "../../tax/page";
import { calculateCorporationTax, getCtRates } from "../../corporation-tax/page";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const NI_RATES_FALLBACK = {
  lowerEarningsLimit: 6500,
  employeePrimaryThreshold: 12570,
  employeeUpperEarningsLimit: 50270,
  employeeMainRate: 0.08,
  employeeUpperRate: 0.02,
  employerSecondaryThreshold: 9100,
  employerRate: 0.138,
};

async function getNiRates(taxYear: string) {
  const { data } = await supabase
    .from("tax_rates")
    .select("national_insurance")
    .eq("tax_year", taxYear)
    .maybeSingle();
  return data?.national_insurance || NI_RATES_FALLBACK;
}

function calculateNI(annualSalary: number, rates: any) {
  const employeeBand1 = Math.max(
    0,
    Math.min(annualSalary, rates.employeeUpperEarningsLimit) - rates.employeePrimaryThreshold
  );
  const employeeBand2 = Math.max(0, annualSalary - rates.employeeUpperEarningsLimit);
  const employeeNI = employeeBand1 * rates.employeeMainRate + employeeBand2 * rates.employeeUpperRate;

  const employerBand = Math.max(0, annualSalary - rates.employerSecondaryThreshold);
  const employerNI = employerBand * rates.employerRate;

  return { employeeNI, employerNI };
}

function solveSalaryForBudget(budget: number, rates: any): number {
  if (budget <= 0) return 0;
  if (budget <= rates.employerSecondaryThreshold) return budget;
  const remainingBudget = budget - rates.employerSecondaryThreshold;
  const extraSalary = remainingBudget / (1 + rates.employerRate);
  return rates.employerSecondaryThreshold + extraSalary;
}

function fmt(n: number) {
  return `GBP ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// pdf-lib's StandardFonts don't include the £ glyph reliably across all encodings,
// so this report uses "GBP" throughout rather than "£" to avoid it rendering as a
// missing-glyph box.

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId") || "";
  const profitParam = request.nextUrl.searchParams.get("profit") || "0";
  const taxYear = request.nextUrl.searchParams.get("taxYear") || "2026/27";
  const pensionParam = request.nextUrl.searchParams.get("pension") || "0";

  const companyProfit = parseFloat(profitParam) || 0;
  if (companyProfit <= 0) {
    return NextResponse.json({ error: "No profit figure provided" }, { status: 400 });
  }

  let clientName = "";
  if (clientId) {
    const { data: client } = await supabase
      .from("clients")
      .select("client_name")
      .eq("id", clientId)
      .maybeSingle();
    clientName = client?.client_name || "";
  }

  const pensionContribution = Math.min(parseFloat(pensionParam) || 0, companyProfit);
  const remunerationPot = companyProfit - pensionContribution;

  const taxRates = await getTaxRates(taxYear);
  const ctRates = await getCtRates(taxYear);
  const niRates = await getNiRates(taxYear);

  const splits = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];

  const scenarios = splits.map((splitPct) => {
    const remunerationBudget = (remunerationPot * splitPct) / 100;
    const salary = solveSalaryForBudget(remunerationBudget, niRates);
    const { employeeNI, employerNI } = calculateNI(salary, niRates);

    const taxableProfit = Math.max(0, companyProfit - pensionContribution - salary - employerNI);
    const ct = calculateCorporationTax(
      {
        taxableProfit,
        periodStart: "2026-04-06",
        periodEnd: "2027-04-05",
        associatedCompanies: 0,
        taxYear,
      },
      ctRates
    );

    const dividend = Math.max(0, taxableProfit - ct.corporationTax);

    const taxResult = calculateTax(
      {
        employmentIncome: salary,
        selfEmploymentIncome: 0,
        rentalIncome: 0,
        pensionIncome: 0,
        interestIncome: 0,
        dividendIncome: dividend,
        taxYear,
      },
      taxRates
    );

    const netToDirector = salary + dividend - employeeNI - taxResult.totalIncomeTax;

    return {
      splitPct,
      salary,
      dividend,
      employerNI,
      corporationTax: ct.corporationTax,
      employeeNI,
      incomeTax: taxResult.totalIncomeTax,
      totalTaxAndNI: employerNI + ct.corporationTax + employeeNI + taxResult.totalIncomeTax,
      netToDirector,
    };
  });

  const bestScenario = scenarios.reduce((best, s) => (s.netToDirector > best.netToDirector ? s : best));
  const allDividendScenario = scenarios.find((s) => s.splitPct === 0)!;
  const savingVsAllDividends = bestScenario.netToDirector - allDividendScenario.netToDirector;

  const soleTraderResult = calculateTax(
    {
      employmentIncome: 0,
      selfEmploymentIncome: companyProfit,
      rentalIncome: 0,
      pensionIncome: 0,
      interestIncome: 0,
      dividendIncome: 0,
      taxYear,
    },
    taxRates
  );
  const soleTraderNet = companyProfit - soleTraderResult.totalLiability;
  const incorporationBetterBy = bestScenario.netToDirector - soleTraderNet;

  // Build the PDF
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]); // A4 landscape
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 40;
  const pageWidth = 842;
  let y = 555;

  const darkText = rgb(0.1, 0.1, 0.15);
  const grayText = rgb(0.4, 0.4, 0.45);
  const greenText = rgb(0.1, 0.45, 0.25);

  function drawText(text: string, x: number, yPos: number, size: number, useFont = font, color = darkText) {
    page.drawText(text, { x, y: yPos, size, font: useFont, color });
  }

  function wrapText(text: string, maxWidth: number, size: number, useFont = font): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let currentLine = "";
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = useFont.widthOfTextAtSize(testLine, size);
      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  // Header
  drawText("Tax Planning Report", margin, y, 20, fontBold);
  y -= 20;
  drawText("Salary vs Dividends, Pension Contributions & Incorporation Comparison", margin, y, 11, font, grayText);
  y -= 24;

  if (clientName) {
    drawText(`Client: ${clientName}`, margin, y, 11, fontBold);
    y -= 16;
  }
  drawText(`Tax Year: ${taxYear}`, margin, y, 11);
  y -= 14;
  drawText(`Company profit available for extraction: ${fmt(companyProfit)}`, margin, y, 11);
  y -= 14;
  drawText(
    `Generated: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
    margin,
    y,
    9,
    font,
    grayText
  );
  y -= 26;

  // Pension box
  if (pensionContribution > 0) {
    drawText("Pension Contribution", margin, y, 13, fontBold);
    y -= 16;
    drawText(
      `Contribution: ${fmt(pensionContribution)}   |   Corporation Tax saved: ~${fmt(
        pensionContribution * (ctRates.mainRate || 0.25)
      )}   |   NI / Income Tax on this amount: GBP 0.00`,
      margin,
      y,
      10
    );
    y -= 14;
    const pensionNote = wrapText(
      `This goes into the director's pension, not their bank account. The remaining ${fmt(
        remunerationPot
      )} is compared as salary vs dividends below. Contributions are subject to the Annual Allowance (currently GBP 60,000 for most people, tapered for very high earners) — confirm separately for this client.`,
      pageWidth - margin * 2,
      9
    );
    pensionNote.forEach((line) => {
      drawText(line, margin, y, 9, font, grayText);
      y -= 12;
    });
    y -= 12;
  }

  // Recommendation
  drawText("Recommendation", margin, y, 13, fontBold);
  y -= 16;
  const recLines = wrapText(
    `The most tax-efficient split tested is a ${fmt(bestScenario.salary)} salary with ${fmt(
      bestScenario.dividend
    )} in dividends, leaving ${fmt(bestScenario.netToDirector)} net to the director.${
      savingVsAllDividends > 0
        ? ` That's ${fmt(savingVsAllDividends)} more than taking everything as dividends alone.`
        : ""
    }`,
    pageWidth - margin * 2,
    10
  );
  recLines.forEach((line) => {
    drawText(line, margin, y, 10);
    y -= 13;
  });

  if (bestScenario.salary < niRates.lowerEarningsLimit) {
    y -= 4;
    const niWarnLines = wrapText(
      `Note: this salary is below the Lower Earnings Limit (${fmt(
        niRates.lowerEarningsLimit
      )}), so it may not count as a qualifying year for State Pension purposes — worth discussing with the client rather than defaulting to the purely tax-optimal figure.`,
      pageWidth - margin * 2,
      9
    );
    niWarnLines.forEach((line) => {
      drawText(line, margin, y, 9, font, rgb(0.6, 0.35, 0.05));
      y -= 12;
    });
  }
  y -= 16;

  // Table
  const colX = [margin, margin + 55, margin + 130, margin + 220, margin + 305, margin + 385, margin + 465, margin + 545, margin + 640, margin + 730];
  const headers = ["Split", "Salary", "Dividend", "Employer NI", "Corp Tax", "Employee NI", "Income Tax", "Total Tax+NI", "Net to Director"];

  drawText(`Salary vs Dividends — ${fmt(remunerationPot)} available`, margin, y, 12, fontBold);
  y -= 18;

  headers.forEach((h, i) => drawText(h, colX[i], y, 8.5, fontBold, grayText));
  y -= 4;
  page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 14;

  scenarios.forEach((s) => {
    const isBest = s.splitPct === bestScenario.splitPct;
    const rowColor = isBest ? greenText : darkText;
    const rowFont = isBest ? fontBold : font;
    drawText(`${s.splitPct}%${isBest ? " *" : ""}`, colX[0], y, 8.5, rowFont, rowColor);
    drawText(fmt(s.salary), colX[1], y, 8.5, rowFont, rowColor);
    drawText(fmt(s.dividend), colX[2], y, 8.5, rowFont, rowColor);
    drawText(fmt(s.employerNI), colX[3], y, 8.5, rowFont, rowColor);
    drawText(fmt(s.corporationTax), colX[4], y, 8.5, rowFont, rowColor);
    drawText(fmt(s.employeeNI), colX[5], y, 8.5, rowFont, rowColor);
    drawText(fmt(s.incomeTax), colX[6], y, 8.5, rowFont, rowColor);
    drawText(fmt(s.totalTaxAndNI), colX[7], y, 8.5, rowFont, rowColor);
    drawText(fmt(s.netToDirector), colX[8], y, 8.5, rowFont, rowColor);
    y -= 15;
  });
  y -= 8;
  drawText("* Most tax-efficient split tested", margin, y, 8, font, grayText);
  y -= 24;

  // Incorporation vs sole trader
  drawText(`Incorporation vs Sole Trader — ${fmt(companyProfit)} profit`, margin, y, 12, fontBold);
  y -= 18;
  drawText("Sole Trader:", margin, y, 10, fontBold);
  drawText(`Income Tax ${fmt(soleTraderResult.totalIncomeTax)}   Class 4 NI ${fmt(soleTraderResult.class4NI)}   Net to Owner ${fmt(soleTraderNet)}`, margin + 90, y, 10);
  y -= 16;
  drawText("Limited Company:", margin, y, 10, fontBold);
  drawText(`Corp Tax ${fmt(bestScenario.corporationTax)}   Employee NI + Income Tax ${fmt(bestScenario.employeeNI + bestScenario.incomeTax)}   Net to Director ${fmt(bestScenario.netToDirector)}`, margin + 90, y, 10);
  y -= 20;

  const verdict =
    incorporationBetterBy > 0
      ? `Incorporating is worth ${fmt(incorporationBetterBy)} more per year at this profit level, based on the optimal extraction split above.`
      : `Staying a sole trader is worth ${fmt(-incorporationBetterBy)} more per year at this profit level.`;
  drawText(verdict, margin, y, 10, fontBold);
  y -= 24;

  // Footer / caveats
  const caveats = wrapText(
    "This report compares tax and National Insurance only. It assumes salary is set as a percentage of the total profit figure, for comparison purposes — real planning conversations should use round, practical salary figures. Employer's NI assumes no Employment Allowance (typical for a single-director company with no other employees). Incorporation figures don't account for company filing costs, limited liability, or administrative burden. This is a planning estimate produced for discussion purposes, not a substitute for a full computation or regulated financial advice.",
    pageWidth - margin * 2,
    8
  );
  caveats.forEach((line) => {
    drawText(line, margin, y, 8, font, grayText);
    y -= 11;
  });

  const pdfBytes = await pdfDoc.save();

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Tax-Planning-Report-${(clientName || "Standalone").replace(/[^a-z0-9]/gi, "-")}.pdf"`,
    },
  });
}