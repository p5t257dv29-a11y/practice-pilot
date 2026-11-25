"use server";

import { revalidatePath } from "next/cache";
import { generateDueRenewalDrafts } from "@/lib/renewals/generateDueRenewals";

export async function runRenewalsNow(formData?: FormData) {
  const rawDate = String(formData?.get("run_date") || "").trim();
  const result = await generateDueRenewalDrafts(rawDate || undefined);

  revalidatePath("/quotes");
  revalidatePath("/engagement");

  return result;
}