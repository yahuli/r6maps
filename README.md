# R6Maps Wiki Demo

A static GitHub Pages demo for restarting the abandoned `capajon/r6maps` idea with a GitHub-backed data workflow.

The app is intentionally built without a server:

- `public/data/official/maps.json` stores collaborator-maintained official map metadata and blueprint references.
- `public/data/community/markers/index.json` lists per-map community marker files under `public/data/community/markers/`; each map keeps its own marker JSON, even when the file only contains an empty array.
- `public/data/community/translations.json` stores community-editable map and marker translations.
- `public/data/i18n/ui.json` stores UI text for the static app.
- A Cloudflare Worker can turn community submissions into GitHub PRs. Without the Worker, GitHub Issues remain the fallback queue.
- GitHub Actions validates data, builds the site, deploys Pages, and can merge low/medium-risk community PRs after qualified votes.
- Official map data is maintained manually by repository collaborators. Community IssueOps submissions do not modify `public/data/official/maps.json`.
- Community proposal and review state lives in GitHub Issues and Pull Requests, not in static JSON under `public/data/community`.

## Local Development

```bash
npm install
npm run dev
```

## Verification

```bash
npm run validate:data
npm run lint
npm run build
```

## GitHub Pages Hosting

Enable GitHub Pages for this repository and select GitHub Actions as the source. The `Deploy GitHub Pages` workflow builds the Vite app and publishes `dist`.

Project pages need a base path. The workflow sets:

```bash
VITE_BASE_PATH=/${{ github.event.repository.name }}/
```

Local development keeps `/` as the base path.

Configure the GitHub repository used by the static IssueOps submit button with:

```bash
VITE_GITHUB_REPOSITORY=owner/repo
```

If it is not set, the app falls back to the current repository, `yahuli/r6maps`, and still exposes the generated submission payload for copying.

Configure the optional direct PR submission Worker with a repository variable:

```bash
SUBMISSION_API_BASE=https://r6maps-submissions.example.workers.dev
```

The Pages workflow passes this value to Vite as `VITE_SUBMISSION_API_BASE`. If the repository variable is empty or the Worker call fails, the editor falls back to copying the payload and opening a short GitHub Issue URL.

## Cloudflare Worker PR Submissions

The Worker in `worker/index.js` accepts editor submissions at `POST /api/submissions`, validates that only community marker files and marker-label translations are changed, then creates a branch, commit, and PR in `yahuli/r6maps` using a GitHub App installation token.

Deploy with Wrangler after configuring secrets:

```bash
npx wrangler deploy
```

Required Worker variables:

```bash
GITHUB_OWNER=yahuli
GITHUB_REPO=r6maps
GITHUB_BASE_BRANCH=main
ALLOWED_ORIGINS=https://yahuli.github.io,http://localhost:5173
```

Required Worker secrets:

```bash
SESSION_SECRET=<random cookie signing secret>
GITHUB_OAUTH_CLIENT_ID=<github oauth app client id>
GITHUB_OAUTH_CLIENT_SECRET=<github oauth app client secret>
GITHUB_APP_ID=<github app id>
GITHUB_APP_PRIVATE_KEY=<github app private key pem>
GITHUB_INSTALLATION_ID=<github app installation id>
```

GitHub OAuth App:

- Callback URL: `https://<worker-host>/api/auth/callback`
- Scope: empty/minimal. OAuth is only used to identify the submitter.

GitHub App:

- Install it on `yahuli/r6maps`.
- Repository permissions: Contents read/write, Pull requests read/write, Issues read/write for PR labels.
- The Worker exchanges a signed GitHub App JWT for an installation access token on each submission.

Security boundary:

- Browser users never receive OAuth tokens, GitHub App keys, or installation tokens.
- The OAuth token is used once to fetch `id`, `login`, `avatar_url`, and `html_url`, then discarded.
- The session cookie is signed, HttpOnly, Secure, SameSite=None, and expires after 7 days.
- Repository writes are created by the GitHub App, not by user-granted repository write access.
- Server-side validation rejects protected paths including official map data, workflows, source code, tools, dependency manifests, and non-marker translations.

## Community PR Flow

1. A user edits markers in the web UI.
2. The UI generates a patch for a per-map marker file, such as `public/data/community/markers/calypso-casino.json`.
3. If `SUBMISSION_API_BASE` is configured, the UI posts the change set to the Cloudflare Worker.
4. The Worker requires GitHub login, creates a PR with `community-data` and `risk-low`, and includes `Submitted by @login` in the body.
5. If the Worker is not configured or fails, the static app copies the full payload and opens a short GitHub issue with the `community-data` label.
6. `CI` validates JSON data, tests vote rules, lints, and builds.
7. Add or confirm a risk label: `risk-low`, `risk-medium`, or `risk-high`.
8. `Vote Gate` counts qualified `+1` and `-1` reactions.
9. Low and medium risk PRs can auto-merge when the threshold is met and protected files were not touched.

High risk changes, official map data, workflows, scripts, dependencies, and app code require collaborator review and direct repository changes.

## Internationalization

The demo separates source data from translations:

- Official and community entities keep stable ids.
- English source labels remain on the source object.
- Non-English values are added as translation rows with `entityType`, `entityId`, `field`, `locale`, `value`, and `status`.
- The viewer falls back to the source label when a translation is missing.
- Desktop PR drafts can add both a new marker and a localized label in one patch.

Mobile stays read-only: users can switch language, choose maps/floors, and inspect translated markers, but editing controls are hidden.
