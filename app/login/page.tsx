import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

/**
 * `/login` (§22.4). The form reads `?next` via `useSearchParams`, which Next requires to
 * sit inside a Suspense boundary.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
