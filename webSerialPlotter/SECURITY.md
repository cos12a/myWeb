# Security Policy

Although this application runs purely in the browser and does not send data to a backend server, there can still be security risks through third-party dependencies, browser APIs (for example, Web Serial), and supply-chain or implementation issues. This document explains how to report vulnerabilities and what we do to reduce risk.

## Reporting a Vulnerability

- Do not open public GitHub issues for security reports.
- Use GitHub Security Advisories (the "Report a vulnerability" button in the repo’s Security tab) to privately disclose issues to maintainers.
- If the advisory feature is unavailable, open a minimal public issue that requests a private contact channel (do not include exploit details), or contact maintainers via any listed repository contacts.

When reporting, please include:
- A clear description of the issue and impact
- Steps to reproduce or a minimal proof-of-concept
- Affected versions/commits, environment, and browser/OS details

We aim to acknowledge within 3 business days and provide regular updates until resolution. Please give us reasonable time to investigate and patch before public disclosure.

## Scope

- The web app (React/Vite) running in the browser
- Usage of the Web Serial API to communicate with devices
- Third-party dependencies and build tooling (npm ecosystem)
- Example firmware in `example_firmware/` is provided as a convenience; report firmware security issues too, but note that device-level risks depend on your hardware and environment

Out of scope includes:
- Issues that require a compromised local environment or browser outside standard threat models
- Social engineering against maintainers or contributors

## Supported Versions

We generally support the latest release and the `main` branch. Security fixes may be backported at the maintainers’ discretion based on severity and complexity.

## Security Considerations for a Browser-Only App

- No server data storage: The app does not send user data to a backend by default; however, browser APIs (such as Web Serial) interact with local hardware and require explicit user permission.
- Permissions: Web Serial requires user consent per origin. Always review prompts carefully.
- Untrusted input: Data coming from connected devices is untrusted. We avoid executing or rendering data as HTML and parse defensively. If you discover a vector (for example, XSS via logs, screenshots, or export features), please report it.
- Content isolation: When practical, we favor safe rendering paths and avoid `dangerouslySetInnerHTML`.

## Third-Party Dependencies and Supply Chain

- We rely on the npm ecosystem (see `package.json`). Supply-chain issues (malicious packages, typosquatting, compromised maintainers) can affect browser code.
- Mitigations we use and recommend:
  - Lockfile usage and regular dependency updates
  - GitHub Advisory and Dependabot alerts (if enabled on the repo)
  - Review of new and transitive packages, and a minimal dependency surface
  - `npm audit` and vendor advisories monitoring

If you identify a vulnerable dependency path or a build-time compromise, please report it with the exact package names, versions, and the path from our project.

## Responsible Disclosure Guidelines

- Do not exploit the issue beyond what is necessary to prove the vulnerability
- Do not perform actions that could harm users, data, or devices
- Avoid privacy violations, data exfiltration, or service degradation
- Give us a reasonable disclosure window to remediate
- We will credit reporters who request acknowledgment once a fix is released

## Development Hygiene (for contributors)

- Run `npm ci` to reproduce a clean, locked dependency tree
- Before PRs: `npm run lint`, `npm run typecheck`, `npm test`, and optionally `npm run test:coverage`
- Avoid introducing `dangerouslySetInnerHTML`; validate and sanitize any user or device-supplied data as plain text
- Keep dependencies minimal and prefer well-maintained libraries

Thank you for helping keep this project and its users safe.
