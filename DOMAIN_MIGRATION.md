# Domain Migration Checklist

## Target Domain
`https://cryptsend.app`

## Files Requiring Updates

### 1. `index.html` — Footer link (optional)

The footer currently links to GitHub + SECURITY.md + author name.
Once the new domain is live, add a link:

```html
<a href="https://cryptsend.app" target="_blank" rel="noopener noreferrer">CryptSend</a>
```

### 2. `README.md` — Deploy button and clone URL

The Vercel Deploy button at line 100 uses a GitHub repo URL — no change needed (it's a Vercel action, not a CryptSend domain).

The `git clone` URL at line 105 is `github.com/PatrykPanasiuk/cryptsend.git` — no change needed.

### 3. Vercel Configuration

- Set primary domain to `cryptsend.app` in Vercel project settings
- Add `cryptsend.app` as a domain in Vercel
- Configure DNS (CNAME or A record) with your DNS provider
- Ensure `cryptsend.vercel.app` redirects (optional)

### 4. `vercel.json`

No changes needed — the config does not hardcode any domain.

### 5. CSP / Security Headers

No changes needed — CSP uses `'self'` which adapts to the current domain.

### 6. Dynamic URLs (`script.js`)

`buildClientUrl` and `buildServerUrl` use `window.location.origin` — no change needed. They will automatically use the new domain.

### 7. Search Engines / SEO

- Update any external links pointing to `cryptsend.vercel.app`
- Consider adding a canonical URL reference to the HTML `<head>` once migrated

## Migration Steps

1. Add `cryptsend.app` domain in Vercel project settings
2. Configure DNS with your provider (CNAME to `cname.vercel-dns.com`)
3. Wait for SSL certificate provisioning
4. Update `index.html` hardcoded URL
5. Deploy
6. Set up redirect from `cryptsend.vercel.app` (optional)
7. Update footer link to point to the new domain after deployment
