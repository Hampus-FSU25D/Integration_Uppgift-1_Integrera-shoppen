import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Link } from "../../components/Link";

function getRedirectPath() {
  const nextPath = new URLSearchParams(window.location.search).get("next");

  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//") || nextPath.startsWith("/login")) {
    return "/";
  }

  return nextPath;
}

function navigateTo(path: string) {
  window.history.replaceState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function LoginPage() {
  const { signIn, user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const googleLoginResult = new URLSearchParams(window.location.search).get("google_login");
  const [message, setMessage] = useState(() => {
    if (googleLoginResult === "cancelled") return "Google-inloggningen avbröts. Du kan försöka igen.";
    if (googleLoginResult === "link_required") return "Kontot finns redan. Logga in med samma e-postadress och lösenord för att koppla Google till ditt konto.";
    if (googleLoginResult === "conflict") return "Det finns redan ett konto med den e-postadressen. Logga in med det kontot i stället.";
    if (googleLoginResult === "failed") return "Google-inloggningen kunde inte slutföras. Försök igen.";
    return "";
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      navigateTo(getRedirectPath());
    }
  }, [user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      await signIn(email, password);
      navigateTo(getRedirectPath());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inloggningen misslyckades. Kontrollera e-post och lösenord.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (user) {
    return <></>;
  }

  return (
    <section className="placeholder auth-panel">
      <span className="eyebrow">Everyday Market Admin</span>
      <h1>Logga in</h1>
      <p>Logga in med e-post och lösenord.</p>

      <form className="form-block" onSubmit={handleSubmit}>
        <label>
          E-post
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label>
          Lösenord
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
          />
        </label>

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Loggar in..." : "Logga in"}
        </button>
      </form>

      <div className="auth-divider"><span>eller</span></div>
      <button
        type="button"
        className="button secondary-action google-login-button"
        onClick={() => window.location.assign("/api/auth/google")}
      >
        Fortsätt med Google
      </button>

      {message && <p className="form-message" role="alert">{message}</p>}

      <p>
        <Link href="/admin/login">Administratör? Logga in med GitHub</Link>
      </p>
      <p>
        <Link href="/register">Registrera kundkonto</Link>
      </p>
    </section>
  );
}
