# CryptSend

**Zero-knowledge, end-to-end encrypted secret sharing.**

CryptSend lets you share passwords, tokens, and other sensitive data with a single link. Your secret is encrypted in your browser using **AES-256-GCM** and — depending on the mode — embedded directly into the URL or stored server-side for a guaranteed one-time view.

> **No account required. No tracking. Open source. MIT licensed.**

---

## Features

- **AES-256-GCM encryption** — industry-standard, military-grade authenticated encryption
- **Client-side encryption** — your secret never leaves your browser unencrypted
- **Zero-knowledge** — the server never sees your plaintext or the decryption key
- **Password protection** — optional passphrase layer with PBKDF2-SHA-256 (600k iterations)
- **Two sharing modes:**
  - **Multi-view (client mode)** — encrypted payload in URL fragment, no server needed
  - **One-time (server mode)** — payload stored in Redis, deleted after viewing, requires [Upstash Redis](https://upstash.com)
- **Burn after reading** — secret cleared from the page after viewing
- **Expiry** — configurable TTL for server-stored secrets
- **Rate-limited API** — protects against brute-force and abuse
- **Privacy-first** — no analytics, no cookies, no tracking, no fingerprinting
- **Dark mode** — respects `prefers-color-scheme`
- **Accessible** — keyboard-navigable, screen-reader friendly, reduced-motion support
- **Security headers** — CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy
- **Open source** — fully transparent, auditable, self-hostable

---

## How It Works

### Multi-View Mode (Client-Only, Default)

The encrypted payload and key are both stored in the URL fragment (the part after `#`). The fragment is never sent to any server. When the recipient opens the link, the page reads the fragment, decrypts the secret in the browser, and displays it.

```
/#<base64url(IV + ciphertext + auth_tag)>.<base64url(key)>
```

No server storage needed. Fully zero-knowledge. Anyone with the URL can view the secret.

### One-Time Mode (Server-Side Storage)

The encrypted payload is stored on the server (Redis). The URL contains an ID to fetch the payload and the key in the fragment. When the recipient opens the link:

1. The page fetches the encrypted payload from `/api/secret?id=<id>`
2. The API returns the payload and **deletes it immediately** from Redis
3. The page decrypts the payload using the key from the URL fragment
4. The secret is displayed once

```
/r/<id>#<key>
```

The server never has the key. The payload is destroyed after the first read.

### Password-Protected Mode (Client & Server)

Optionally protect any link with a passphrase. When enabled, the encryption key is derived from the passphrase using **PBKDF2-SHA-256** (600,000 iterations) with a random 16-byte salt. The salt is stored in the URL instead of the encryption key.

**URL formats:**

```
# <version>.<payload>.<salt>        Client mode (v2)
/r/<id>#<version>.<salt>            Server mode (v2)
```

- `version = 1` — no password (key is in the URL)
- `version = 2` — password-protected (salt is in the URL, key derived from passphrase)

**To reveal:** the recipient opens the link, is prompted for the passphrase, and the key is derived client-side. The passphrase is never transmitted or stored.

> **Backward compatible:** all existing links (no version prefix) are treated as v1 automatically.

---

## Getting Started

### One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FPatrykPanasiuk%2Fcryptsend)

### Manual Deploy

```bash
git clone https://github.com/PatrykPanasiuk/cryptsend.git
cd cryptsend
npm install
vercel --prod
```

### Local Development

```bash
npm install
npm run dev
```

### Enabling One-Time Mode (Server Storage)

For true one-time viewing with server-side storage, you need a Redis instance. [Upstash](https://upstash.com) offers a free tier (30 MB, enough for thousands of secrets).

1. Create a Redis database on [Upstash](https://console.upstash.com)
2. Copy your **REST URL** and **REST Token**
3. Add them to your Vercel project:

```bash
vercel env add KV_URL
# Paste your Upstash REST URL

vercel env add KV_REST_API_TOKEN
# Paste your Upstash REST Token

vercel env pull
```

4. Redeploy:

```bash
vercel --prod
```

Once configured, the "Burn after reading" toggle will enable server-side one-time mode with configurable expiry.

> **Alternative env var names:** You can also use `REDIS_URL` / `REDIS_TOKEN` or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.

---

## Security Model

```
Sender's Browser                        Recipient's Browser
      │                                        │
      │  AES-256-GCM Encrypt                    │
      │  ┌─────────────────┐                   │
      │  │ Secret + Key →   │                   │
      │  │ Encrypted Payload│                   │
      │  └─────────────────┘                   │
      │         │                               │
      │         ├── Client mode ────────────────┤
      │         │   URL: /#<payload>.<key>      │
      │         │                               │
      │         └── Server mode ────────────────┤
      │             POST /api/secret → id       │
      │             URL: /r/<id>#<key>          │
      │                               │         │
      │         ─── Share Link ───────→         │
      │                                        │
      │       Client mode:                       │
      │         Decrypt from URL fragment        │
      │                                        │
      │       Server mode:                       │
      │         GET /api/secret?id=<id>          │
      │         → Encrypted payload (deleted)     │
      │         → Decrypt with key from hash     │
      │         → Secret shown once              │
```

- **Key generation:** `crypto.getRandomValues()` — cryptographically secure 256-bit key
- **Password-based key derivation:** PBKDF2-SHA-256, 600,000 iterations, 16-byte random salt
- **Encryption:** AES-256-GCM with 96-bit random IV and 128-bit authentication tag
- **Fragment security:** The URL fragment (`#...`) is never sent in HTTP requests
- **No persistence:** No cookies, localStorage, or IndexedDB
- **CSP:** Content Security Policy restricts scripts, connections, and inline styles
- **Rate limiting:** API limited to 20 requests per IP per 60-second window

---

## Project Structure

```
cryptsend/
├── index.html              # Main page (single-page application)
├── style.css               # Styles (dark/light mode)
├── script.js               # Client-side logic + Web Crypto API
├── api/
│   └── secret.mjs          # Serverless API (Redis storage, rate-limited)
├── package.json            # Dependencies and scripts
├── vercel.json             # Vercel deployment config + security headers
├── README.md               # This file
├── LICENSE                 # MIT License
├── CONTRIBUTING.md         # Contribution guidelines
├── CODE_OF_CONDUCT.md      # Code of Conduct
├── SECURITY.md             # Security policy
└── .gitignore              # Git ignore rules
```

---

## API Reference

### `POST /api/secret`

Store an encrypted payload server-side (requires Redis).

**Request:**

```json
{
  "encrypted": "<base64url-encoded AES-GCM payload>",
  "ttl": 86400
}
```

| Field       | Type     | Required | Default | Description                    |
|-------------|----------|----------|---------|--------------------------------|
| `encrypted` | string   | yes      | —       | Base64url-encoded encrypted payload |
| `ttl`       | number   | no       | 86400   | Time-to-live in seconds (60–604800) |

**Response `201 Created`:**

```json
{
  "id": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  "ttl": 86400
}
```

**Response `429 Too Many Requests`:** Rate limit exceeded.

**Response `503 Service Unavailable`:** Redis not configured.

### `GET /api/secret?id=<id>`

Retrieve a secret. The secret is **deleted immediately** after retrieval (one-time read).

| Parameter | Type   | Required | Description                    |
|-----------|--------|----------|--------------------------------|
| `id`      | string | yes      | 32-character hex secret ID     |

**Response `200 OK`:**

```json
{
  "encrypted": "<base64url-encoded AES-GCM payload>"
}
```

**Response `404 Not Found`:** Secret already viewed, expired, or never existed.

**Response `429 Too Many Requests`:** Rate limit exceeded.

---

## Future Improvements

- [x] **Password-protected secrets** — passphrase derived via PBKDF2-SHA-256 (600k iterations)
- [ ] **Custom expiry per view** — sender sets exact expiration date/time
- [ ] **Browser extension** — right-click → send as encrypted secret
- [ ] **CLI tool** — `npx cryptsend send "my secret"` for terminal usage
- [ ] **QR code sharing** — scan to open the secret on mobile
- [ ] **Email delivery** — optional email sending via Resend / SendGrid
- [ ] **Webhook notifications** — notify sender when secret is viewed
- [ ] **Bulk operations** — share multiple secrets in a single batch
- [ ] **Teams & workspaces** — shared team secret inboxes
- [ ] **Audit log** — record who viewed what (for enterprise deployments)
- [ ] **i18n** — internationalization for non-English interfaces

---

## Tech Stack

- **Runtime:** Browser (Web Crypto API + vanilla JS)
- **Encryption:** AES-256-GCM
- **Serverless:** Vercel Functions (Node.js)
- **Storage:** Upstash Redis (optional, for one-time mode)
- **Deployment:** Vercel

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before submitting a pull request.

---

## License

[MIT](LICENSE) © [Patryk Panasiuk](https://github.com/PatrykPanasiuk)

---

## Why CryptSend?

- **No brand, no BS** — a tool, not a product
- **No accounts** — anonymous by design
- **No tracking** — no analytics, no cookies, no fingerprinting
- **Open source** — fully transparent, auditable, and self-hostable
