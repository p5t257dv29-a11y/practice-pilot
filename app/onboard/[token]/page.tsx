import ClientOnboardForm from "./client-form";

export default async function OnboardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ClientOnboardForm token={token} />;
}
