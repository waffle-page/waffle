# Security Policy

Waffle is local-first: the app bundle carries no server credentials and user data stays on-device. Security reports are taken seriously regardless.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's private vulnerability reporting on this repository (Security tab → "Report a vulnerability"). You'll get an acknowledgement within a few days.

In scope: anything that lets a crafted vault file, connector package, extracted web content, or shared-folder payload read data it shouldn't, write outside the vault, or execute code outside the sandbox contracts described in `docs/05-connector-sdk.md` and `docs/03-adr.md` (ADR-008).
