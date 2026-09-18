# Contributing to Web Serial Plotter

Thanks for your interest in improving this project! This guide explains how to get set up, make changes, and submit a great pull request.

## Quick Start

1. Fork and clone your fork
2. Use Node.js 20+ (LTS recommended)
3. Install dependencies:
   - `npm ci` (preferred) or `npm install`
4. Start the dev server:
   - `npm run dev` (Vite)
5. Open `http://localhost:5173` in a Chromium-based browser (Chrome/Edge)

## Project Scripts

- `npm run dev` — start Vite dev server
- `npm run build` — type-check and build production assets
- `npm run lint` — run ESLint
- `npm run typecheck` — run TypeScript with no emit
- `npm test` — run unit tests (Vitest)
- `npm run test:coverage` — run tests with coverage

## Development Workflow

- Create a feature branch from `main` (e.g., `feat/…`, `fix/…`, `chore/…`)
- Keep PRs focused and reasonably small
- Write or update tests for behavior changes
- Run locally before opening a PR:
  - `npm run lint`
  - `npm run typecheck`
  - `npm test`
  - `npm run test:coverage` (for significant changes)
- Fill out the PR template and link related issues (e.g., `Closes #123`)

## Code Style

- TypeScript first: avoid `any`, favor explicit types for public APIs
- Prefer clear, descriptive names over abbreviations
- Use early returns and guard clauses to keep control flow flat
- Keep components small and focused; lift shared logic into hooks or utils where appropriate
- Run `npm run lint` and fix issues (you can try `eslint . --fix` locally)

## Tests

- Unit tests use Vitest + Testing Library
- Place tests near code or in `__tests__` directories (project already uses both patterns)
- Test behavior, not implementation details; prefer user-facing assertions
- Update snapshots purposefully and review diffs

## UI/UX Notes

- Maintain keyboard accessibility and focus states
- Prefer semantic HTML; use ARIA only when needed
- For visual changes, include before/after screenshots or GIFs in your PR

## Working with Web Serial

- Use a Chromium-based browser (Chrome/Edge) for the Web Serial API
- Works on `localhost` or HTTPS only; grant serial permissions when prompted
- Example firmware: `example_firmware/basic_plotter/basic_plotter.ino`
  - Open in Arduino IDE, select your board/port, upload, then connect from the app

## Commit Messages

- Prefer Conventional Commits when possible:
  - `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `build:`
- Keep them concise and meaningful; reference issues where applicable

## Pull Requests

- Fill out the PR template (auto-included when opening a PR)
- Ensure CI/lint/tests pass
- Respond to review feedback promptly; squash or tidy commits if requested

## Questions or Help

Open a discussion or an issue with details about your environment and the problem or idea. PRs are welcome even if they’re marked as draft.

Thank you for contributing!
