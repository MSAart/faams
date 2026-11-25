import { LoginForm } from "@/components/auth/login-form";
import { getSafeRedirectPath } from "@/lib/safe-redirect";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <LoginForm
      nextPath={getSafeRedirectPath(next)}
      errorCode={error}
    />
  );
}
