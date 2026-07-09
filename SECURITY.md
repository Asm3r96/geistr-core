# Security Policy

## Supported versions

Security fixes target the latest `1.x` release.

## Reporting a vulnerability

Please do **not** open a public GitHub issue for vulnerabilities, leaked secrets, auth bypasses, unsafe tool execution, or local data exposure.

Report security issues privately through GitHub Security Advisories for this repository.

Include:

- affected version or commit
- reproduction steps
- impact
- suggested fix, if known

## Secrets

Never commit API keys, OAuth client secrets, access tokens, local databases, private logs, or user data. If a secret is accidentally committed, rotate it immediately and remove it from git history before pushing.
