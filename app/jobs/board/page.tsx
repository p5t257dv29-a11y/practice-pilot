import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import JobsBoardClient from "./board-client";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function updateJobWorkflowStage(jobId: string, newStage: string) {
  "use server";
  await supabase.from("jobs").update({ workflow_stage: newStage }).eq("id", jobId);
  revalidatePath("/jobs/board");
  revalidatePath("/jobs");
}

export default async function JobsBoardPage() {
  const [{ data: jobs, error }, { data: staff }] = await Promise.all([
    supabase
      .from("jobs")
      .select("*, clients(client_name)")
      .not("status", "in", "(Completed,Cancelled)")
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase.from("staff").select("id, name").eq("is_active", true).order("name", { ascending: true }),
  ]);

  return (
    <JobsBoardClient
      jobs={jobs || []}
      staff={staff || []}
      error={error?.message}
      updateStageAction={updateJobWorkflowStage}
    />
  );
}