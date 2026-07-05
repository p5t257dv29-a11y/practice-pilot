import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import JobsPageClient from "./jobs-page-client";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createJobRecord(formData: FormData) {
  "use server";

  const client_id = formData.get("client_id")?.toString().trim();
  const job_name = formData.get("job_name")?.toString().trim();

  if (!client_id || !job_name) {
    return;
  }

  const isRecurring = formData.get("is_recurring") === "on";

  const { data, error } = await supabase.from("jobs").insert({
    client_id,
    job_name,
    job_type: formData.get("job_type")?.toString().trim() || null,
    status: formData.get("status")?.toString().trim() || "Draft",
    workflow_stage: formData.get("workflow_stage")?.toString().trim() || null,
    assigned_to: formData.get("assigned_to")?.toString().trim() || null,
    due_date: formData.get("due_date")?.toString().trim() || null,
    notes: formData.get("notes")?.toString().trim() || null,
    is_recurring: isRecurring,
    recurrence_frequency: isRecurring ? formData.get("recurrence_frequency")?.toString().trim() || null : null,
  }).select();

  if (error) {
    console.error("Job insert error:", error);
    return;
  }

  console.log("Job created:", data);
  revalidatePath("/jobs");
}

async function deleteJobRecord(id: string) {
  "use server";
  await supabase.from("jobs").delete().eq("id", id);
  revalidatePath("/jobs");
}

export default async function JobsPage() {
  const [{ data: jobs, error }, { data: clients }] = await Promise.all([
    supabase
      .from("jobs")
      .select("*, clients(client_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, client_name")
      .order("client_name", { ascending: true }),
  ]);

  return (
    <JobsPageClient
      jobs={jobs || []}
      clients={clients || []}
      error={error?.message}
      createAction={createJobRecord}
      deleteAction={deleteJobRecord}
    />
  );
}