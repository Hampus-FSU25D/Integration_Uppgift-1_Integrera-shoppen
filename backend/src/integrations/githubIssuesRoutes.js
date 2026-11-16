import express from "express";
import { GitHubIssuesError } from "./githubIssuesAdapter.js";

export function createGitHubIssuesRouter({ adapter, requireAdmin }) {
  const router = express.Router();

  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  router.get("/", requireAdmin, async (_request, response) => {
    try {
      return response.json(await adapter.listOpenIssues());
    } catch (error) {
      return respondWithGitHubError(response, error);
    }
  });

  router.post("/", requireAdmin, async (request, response) => {
    const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
    const description = typeof request.body?.description === "string" ? request.body.description.trim() : "";
    if (!title || title.length > 256) {
      return response.status(400).json({ error: "Enter an issue title (up to 256 characters)." });
    }
    if (!description || description.length > 64000) {
      return response.status(400).json({ error: "Enter a description (up to 64,000 characters)." });
    }

    const reportedBy = request.session.githubAdminLogin;
    if (typeof reportedBy !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(reportedBy)) {
      return response.status(403).json({ error: "Sign in with an approved GitHub admin account to report an issue." });
    }

    try {
      return response.status(201).json(await adapter.createIssue({ title, description, reportedBy }));
    } catch (error) {
      return respondWithGitHubError(response, error);
    }
  });

  return router;
}

function respondWithGitHubError(response, error) {
  if (error instanceof GitHubIssuesError) {
    return response.status(error.status).json({ error: error.message });
  }
  return response.status(502).json({ error: "GitHub is temporarily unavailable. Try again." });
}
