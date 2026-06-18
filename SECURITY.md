# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

CryptSend takes security seriously. If you discover a security vulnerability,
please **do not** file a public GitHub issue.

Instead, send a description of the issue to **[security@patrykpanasiuk.com](mailto:security@patrykpanasiuk.com)**.

Please include:

- A brief description of the vulnerability
- Steps to reproduce (if applicable)
- Your assessment of the impact

You should receive a response within 48 hours. If you don't, please follow up.

## Security Highlights

- All encryption and decryption happens client-side in the browser using the Web Crypto API
- No plaintext data is ever transmitted to any server
- Decryption keys are stored exclusively in the URL fragment (the part after `#`), which is never sent to servers
- No cookies, localStorage, or IndexedDB is used
- A Content Security Policy (CSP) helps mitigate XSS and data injection attacks
- The project has zero runtime dependencies for its client-side functionality
