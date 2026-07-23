"use client";

export default function JobNotesForm({
  addAction,
}: {
  addAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <form
      action={async (formData) => {
        await addAction(formData);
        const textarea = document.getElementById("note_text") as HTMLTextAreaElement | null;
        if (textarea) textarea.value = "";
      }}
      className="space-y-2"
    >
      <textarea
        id="note_text"
        name="note_text"
        rows={2}
        required
        placeholder="Add a note about this job..."
        className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
      <button
        type="submit"
        className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
      >
        Add Note
      </button>
    </form>
  );
}