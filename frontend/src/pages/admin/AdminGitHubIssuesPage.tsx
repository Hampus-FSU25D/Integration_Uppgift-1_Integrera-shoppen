import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

type GitHubIssue = {
  number: number;
  title: string;
  body: string;
  url: string;
  author?: string;
};

export function AdminGitHubIssuesPage() {
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [message, setMessage] = useState("");

  async function loadIssues() {
    setIsLoading(true);
    setLoadError("");
    try {
      setIssues(await apiRequest<GitHubIssue[]>("/admin/github/issues"));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Issues kunde inte hämtas.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadIssues();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setFormError("");
    setMessage("");

    try {
      const issue = await apiRequest<GitHubIssue>("/admin/github/issues", {
        method: "POST",
        body: JSON.stringify({ title, description }),
      });
      setIssues((current) => [issue, ...current.filter((item) => item.number !== issue.number)]);
      setTitle("");
      setDescription("");
      setMessage(`Issue #${issue.number} skapades i GitHub.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Issue kunde inte skapas.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="admin-page github-issues-page">
      <div className="page-heading">
        <div>
          <h1>GitHub Issues</h1>
          <p>Rapportera fel och följ öppna issues i butikens repository.</p>
        </div>
      </div>

      <section className="admin-card github-issue-form-panel" aria-labelledby="github-issue-form-heading">
        <h2 id="github-issue-form-heading">Rapportera ett fel</h2>
        <form className="form-block github-issue-form" onSubmit={handleSubmit}>
          <label>
            Rubrik
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={256} required />
          </label>
          <label>
            Beskrivning
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={64000} required />
          </label>
          <div>
            <button className="button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Skapar issue…" : "Skapa issue"}
            </button>
          </div>
        </form>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        {message && <p className="github-issue-success" role="status">{message}</p>}
      </section>

      <section className="github-issue-section" aria-labelledby="github-issues-heading">
        <div className="github-issue-heading">
          <h2 id="github-issues-heading">Öppna issues</h2>
          <button className="secondary-action" type="button" onClick={() => void loadIssues()} disabled={isLoading}>
            {isLoading ? "Hämtar…" : "Uppdatera"}
          </button>
        </div>
        {loadError && <p className="form-error" role="alert">{loadError}</p>}
        {isLoading ? (
          <p role="status">Hämtar öppna issues.</p>
        ) : !loadError && issues.length === 0 ? (
          <p>Det finns inga öppna issues.</p>
        ) : (
          <ul className="github-issue-list">
            {issues.map((issue) => (
              <li className="github-issue-item" key={issue.number}>
                <span className="github-issue-number">#{issue.number}</span>
                <div>
                  <a href={issue.url} target="_blank" rel="noopener noreferrer">{issue.title}</a>
                  {issue.author && <p className="github-issue-author">Öppnad av @{issue.author}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
