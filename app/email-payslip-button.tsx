"use client";

export default function EmailPayslipButton({
  email,
  employeeName,
  token,
  paymentDate,
  periodStart,
  periodEnd,
}: {
  email: string;
  employeeName: string;
  token: string;
  paymentDate: string;
  periodStart: string;
  periodEnd: string;
}) {
  const handleClick = () => {
    const link = `${window.location.origin}/payslip/${token}`;
    const subject = `Your payslip — ${new Date(paymentDate).toLocaleDateString("en-GB")}`;
    const body = `Hi ${employeeName},\n\nHere's your payslip for the period ${new Date(periodStart).toLocaleDateString("en-GB")} to ${new Date(periodEnd).toLocaleDateString("en-GB")}:\n\n${link}\n\nThanks,`;
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <button onClick={handleClick}
      className="rounded-lg bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-100 transition-colors">
      Email Payslip
    </button>
  );
}