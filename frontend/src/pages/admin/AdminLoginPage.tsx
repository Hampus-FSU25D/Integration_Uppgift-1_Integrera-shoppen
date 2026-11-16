import { useEffect } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Link } from "../../components/Link";

function navigateTo(path: string) {
  window.history.replaceState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function AdminLoginPage() {
  const { user } = useAuth();
  const result = new URLSearchParams(window.location.search).get("github_login");
  const message = result === "cancelled"
    ? "GitHub-inloggningen avbröts. Du kan försöka igen."
    : result === "forbidden"
      ? "Ditt GitHub-konto har inte behörighet att logga in som administratör."
      : result === "failed"
        ? "GitHub-inloggningen kunde inte slutföras. Försök igen."
        : "";

  useEffect(() => {
    if (user?.role === "admin" && !result) navigateTo("/admin");
  }, [result, user]);

  return (
    <section className="placeholder auth-panel">
      <span className="eyebrow">Everyday Market Admin</span>
      <h1>Administratörs<wbr />inloggning</h1>
      <p>Logga in med ett GitHub-konto som har administratörsbehörighet.</p>
      <button
        type="button"
        className="button secondary-action"
        onClick={() => window.location.assign("/api/auth/github")}
      >
        Logga in med GitHub
      </button>
      {message && <p className="form-message" role="alert">{message}</p>}
      {user && user.role !== "admin" && (
        <p className="form-message" role="status">Du är inloggad som kund. GitHub-inloggningen startar en separat administratörssession.</p>
      )}
      <p><Link href="/login">Till kundinloggningen</Link></p>
    </section>
  );
}
