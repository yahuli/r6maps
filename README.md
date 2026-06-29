# R6Maps Wiki Demo

A static GitHub Pages demo for restarting the abandoned `capajon/r6maps` idea with a GitHub-backed data workflow.

The app is intentionally built without a server:

- `public/data/official/maps.json` stores collaborator-maintained official map metadata and blueprint references.
- `public/data/community/markers/index.json` lists per-map community marker files under `public/data/community/markers/`.
- `public/data/community/translations.json` stores community-editable map and marker translations.
- `public/data/i18n/ui.json` stores UI text for the static app.
- GitHub Issues become the community marker edit queue.
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

## Community PR Flow

1. A user edits markers in the web UI.
2. The UI generates a patch for a per-map marker file, such as `public/data/community/markers/calypso-casino.json`.
3. The static app opens a new GitHub issue with the `community-data` label and a fenced JSON change set payload.
4. A GitHub Action or maintainer converts accepted issue payloads into PRs.
5. `CI` validates JSON data, tests vote rules, lints, and builds.
6. Add a risk label: `risk-low`, `risk-medium`, or `risk-high`.
7. `Vote Gate` counts qualified `+1` and `-1` reactions.
8. Low and medium risk PRs can auto-merge when the threshold is met and protected files were not touched.

High risk changes, official map data, workflows, scripts, dependencies, and app code require collaborator review and direct repository changes.

## Internationalization

The demo separates source data from translations:

- Official and community entities keep stable ids.
- English source labels remain on the source object.
- Non-English values are added as translation rows with `entityType`, `entityId`, `field`, `locale`, `value`, and `status`.
- The viewer falls back to the source label when a translation is missing.
- Desktop PR drafts can add both a new marker and a localized label in one patch.

Mobile stays read-only: users can switch language, choose maps/floors, and inspect translated markers, but editing controls are hidden.
