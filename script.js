const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const MAX_LENGTH = 5000;
const CLIENT_BURN_DELAY = 30000;

const PBKDF2_ITERATIONS = 600000;
const SALT_LENGTH = 16;

const VERSION_NO_PASSWORD = '1';
const VERSION_PASSWORD = '2';

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function generateKey() {
  return await crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

async function exportKey(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return base64UrlEncode(raw);
}

async function importKey(base64Url) {
  const raw = base64UrlDecode(base64Url);
  return await crypto.subtle.importKey(
    'raw',
    raw,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['decrypt']
  );
}

async function pbkdf2DeriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['decrypt']
  );
}

async function pbkdf2DeriveKeyForEncrypt(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoded
  );
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);
  return combined;
}

async function decrypt(combined, key) {
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

async function createEncryptedPayload(plaintext, password) {
  if (password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const key = await pbkdf2DeriveKeyForEncrypt(password, salt);
    const combined = await encrypt(plaintext, key);
    const payload = base64UrlEncode(combined);
    const saltStr = base64UrlEncode(salt);
    return { payload, extra: saltStr, version: VERSION_PASSWORD };
  }
  const key = await generateKey();
  const combined = await encrypt(plaintext, key);
  const payload = base64UrlEncode(combined);
  const keyStr = await exportKey(key);
  return { payload, extra: keyStr, version: VERSION_NO_PASSWORD };
}

async function decryptPayload(payload, extra, version, password) {
  if (version === VERSION_PASSWORD) {
    if (!password) throw new Error('Password required');
    const salt = base64UrlDecode(extra);
    const key = await pbkdf2DeriveKey(password, salt);
    const combined = base64UrlDecode(payload);
    return await decrypt(combined, key);
  }
  const combined = base64UrlDecode(payload);
  const key = await importKey(extra);
  return await decrypt(combined, key);
}

function buildClientUrl(payload, extra, version) {
  return `${window.location.origin}${window.location.pathname}#${version}.${payload}.${extra}`;
}

function buildServerUrl(id, extra, version) {
  return `${window.location.origin}/r/${id}#${version}.${extra}`;
}

function parseHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;

  const parts = hash.split('.');
  if (parts.length === 2) {
    return {
      version: VERSION_NO_PASSWORD,
      payload: parts[0],
      extra: parts[1],
      hasPassword: false,
    };
  }
  if (parts.length === 3 && (parts[0] === VERSION_NO_PASSWORD || parts[0] === VERSION_PASSWORD)) {
    return {
      version: parts[0],
      payload: parts[1],
      extra: parts[2],
      hasPassword: parts[0] === VERSION_PASSWORD,
    };
  }
  return null;
}

function parseHashExtraOnly() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;

  const parts = hash.split('.');

  if (parts.length === 1) {
    return {
      version: VERSION_NO_PASSWORD,
      extra: parts[0],
      hasPassword: false,
    };
  }
  if (parts.length === 2) {
    const first = parts[0];
    if (first === VERSION_NO_PASSWORD || first === VERSION_PASSWORD) {
      return {
        version: first,
        extra: parts[1],
        hasPassword: first === VERSION_PASSWORD,
      };
    }
    return {
      version: VERSION_NO_PASSWORD,
      extra: parts[1],
      hasPassword: false,
    };
  }
  if (parts.length === 3 && (parts[0] === VERSION_NO_PASSWORD || parts[0] === VERSION_PASSWORD)) {
    return {
      version: parts[0],
      extra: parts[2],
      hasPassword: parts[0] === VERSION_PASSWORD,
    };
  }
  return null;
}

function parseServerRoute() {
  const match = window.location.pathname.match(/^\/r\/([a-f0-9]{32})$/);
  if (!match) return null;
  return { id: match[1] };
}

function checkPasswordsMatch() {
  const p1 = document.getElementById('password-input').value;
  const p2 = document.getElementById('password-confirm').value;
  const hint = document.getElementById('password-match');
  if (!p1 && !p2) {
    hint.textContent = '';
    hint.className = 'password-hint';
    return true;
  }
  if (p1 !== p2) {
    hint.textContent = 'Passphrases do not match';
    hint.className = 'password-hint mismatch';
    return false;
  }
  if (p1.length < 4) {
    hint.textContent = 'Passphrase must be at least 4 characters';
    hint.className = 'password-hint mismatch';
    return false;
  }
  hint.textContent = 'Passphrases match';
  hint.className = 'password-hint match';
  return true;
}

async function storeOnServer(payload, ttl) {
  const resp = await fetch('/api/secret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted: payload, ttl }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return await resp.json();
}

async function fetchFromServer(id) {
  const resp = await fetch(`/api/secret?id=${encodeURIComponent(id)}`, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return await resp.json();
}

document.addEventListener('DOMContentLoaded', () => {
  const createView = document.getElementById('create-view');
  const revealView = document.getElementById('reveal-view');
  const createForm = document.getElementById('create-form');
  const secretInput = document.getElementById('secret-input');
  const charCounter = document.getElementById('char-counter');
  const createBtn = document.getElementById('create-btn');
  const resultCard = document.getElementById('result-card');
  const resultLink = document.getElementById('result-link');
  const resultDesc = document.getElementById('result-desc');
  const resultModeBadge = document.getElementById('result-mode-badge');
  const copyBtn = document.getElementById('copy-btn');
  const newSecretBtn = document.getElementById('new-secret-btn');
  const burnToggle = document.getElementById('burn-toggle');
  const expireSelect = document.getElementById('expire-select');
  const serverWarning = document.getElementById('server-warning');
  const burnBadge = document.getElementById('burn-badge');
  const passwordToggle = document.getElementById('password-toggle');
  const passwordFields = document.getElementById('password-fields');
  const passwordInput = document.getElementById('password-input');
  const passwordConfirm = document.getElementById('password-confirm');

  const revealLoading = document.getElementById('reveal-loading');
  const revealPasswordPrompt = document.getElementById('reveal-password-prompt');
  const revealSuccess = document.getElementById('reveal-success');
  const revealBurned = document.getElementById('reveal-burned');
  const revealError = document.getElementById('reveal-error');
  const revealContent = document.getElementById('reveal-content');
  const revealWarning = document.getElementById('reveal-warning');
  const revealCopyBtn = document.getElementById('reveal-copy-btn');
  const revealNewBtn = document.getElementById('reveal-new-btn');
  const burnedNewBtn = document.getElementById('burned-new-btn');
  const revealPasswordInput = document.getElementById('reveal-password-input');
  const revealPasswordBtn = document.getElementById('reveal-password-btn');
  const revealPasswordError = document.getElementById('reveal-password-error');

  let serverAvailable = false;
  let clientBurnTimer = null;
  let pendingHashData = null;

  function showView(view) {
    createView.classList.remove('active');
    revealView.classList.remove('active');
    view.classList.add('active');
  }

  function updateCharCounter() {
    const len = secretInput.value.length;
    charCounter.textContent = `${len} / ${MAX_LENGTH}`;
  }

  function resetCreateForm() {
    resultCard.classList.add('hidden');
    serverWarning.classList.add('hidden');
    createBtn.disabled = false;
    createBtn.querySelector('.btn-label').textContent = 'Create Encrypted Link';
  }

  function updateBurnBadge() {
    if (burnToggle.checked && serverAvailable) {
      burnBadge.textContent = 'one-time';
      burnBadge.className = 'badge badge-server';
    } else if (burnToggle.checked && !serverAvailable) {
      burnBadge.textContent = 'unavailable';
      burnBadge.className = 'badge badge-client';
    } else {
      burnBadge.textContent = 'multi-view';
      burnBadge.className = 'badge badge-client';
    }
  }

  async function checkServer() {
    try {
      const resp = await fetch('/api/secret', { method: 'OPTIONS' });
      serverAvailable = resp.ok || resp.status === 204;
    } catch {
      serverAvailable = false;
    }
    if (!burnToggle.checked) {
      expireSelect.disabled = true;
    } else if (serverAvailable) {
      expireSelect.disabled = false;
    } else {
      expireSelect.disabled = true;
    }
    updateBurnBadge();
  }

  burnToggle.addEventListener('change', () => {
    if (burnToggle.checked && serverAvailable) {
      expireSelect.disabled = false;
      serverWarning.classList.add('hidden');
    } else if (burnToggle.checked && !serverAvailable) {
      expireSelect.disabled = true;
      serverWarning.classList.remove('hidden');
    } else {
      expireSelect.disabled = true;
      serverWarning.classList.add('hidden');
    }
    updateBurnBadge();
  });

  passwordToggle.addEventListener('change', () => {
    if (passwordToggle.checked) {
      passwordFields.classList.remove('hidden');
    } else {
      passwordFields.classList.add('hidden');
      passwordInput.value = '';
      passwordConfirm.value = '';
      document.getElementById('password-match').textContent = '';
    }
  });

  passwordInput.addEventListener('input', checkPasswordsMatch);
  passwordConfirm.addEventListener('input', checkPasswordsMatch);

  secretInput.addEventListener('input', updateCharCounter);

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const secret = secretInput.value.trim();
    if (!secret) return;

    let password = null;
    if (passwordToggle.checked) {
      if (!checkPasswordsMatch()) return;
      password = passwordInput.value;
    }

    createBtn.disabled = true;
    createBtn.querySelector('.btn-label').textContent = password ? 'Encrypting with passphrase…' : 'Encrypting…';

    try {
      const { payload, extra, version } = await createEncryptedPayload(secret, password);
      const useServer = burnToggle.checked && serverAvailable;
      const usePassword = version === VERSION_PASSWORD;

      if (useServer) {
        const ttlValue = expireSelect.value;
        const ttl = ttlValue === 'never' ? 604800 : parseInt(ttlValue, 10);
        createBtn.querySelector('.btn-label').textContent = 'Storing on server…';
        try {
          const { id } = await storeOnServer(payload, ttl);
          const url = buildServerUrl(id, extra, version);
          resultLink.value = url;
          resultModeBadge.textContent = 'one-time';
          resultModeBadge.className = 'badge badge-server';
          resultDesc.textContent = usePassword
            ? 'Passphrase-protected. Share the passphrase separately. The payload will be deleted after first view.'
            : 'This link works once. After viewing, the secret is no longer available from the server.';
          resultCard.classList.remove('hidden');
          resultLink.focus();
          resultLink.select();
          window.location.hash = '';
          return;
        } catch (err) {
          serverAvailable = false;
          updateBurnBadge();
          serverWarning.classList.remove('hidden');
        }
      }

      const url = buildClientUrl(payload, extra, version);
      resultLink.value = url;
      if (usePassword) {
        resultModeBadge.textContent = 'protected';
        resultModeBadge.className = 'badge badge-server';
        resultDesc.textContent = 'Passphrase-protected. Share the passphrase with the recipient separately from this link.';
      } else {
        resultModeBadge.textContent = 'multi-view';
        resultModeBadge.className = 'badge badge-client';
        resultDesc.textContent = 'Secret is embedded in the link. Anyone with the URL can view it.';
      }
      resultCard.classList.remove('hidden');
      resultLink.focus();
      resultLink.select();
      window.location.hash = '';
    } finally {
      createBtn.disabled = false;
      createBtn.querySelector('.btn-label').textContent = 'Create Encrypted Link';
    }
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(resultLink.value);
      copyBtn.querySelector('.btn-label').textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.querySelector('.btn-label').textContent = 'Copy';
      }, 2000);
    } catch {
      resultLink.select();
      document.execCommand('copy');
    }
  });

  newSecretBtn.addEventListener('click', () => {
    resetCreateForm();
    secretInput.value = '';
    updateCharCounter();
    secretInput.focus();
    window.location.hash = '';
  });

  revealCopyBtn.addEventListener('click', async () => {
    const text = revealContent.textContent;
    try {
      await navigator.clipboard.writeText(text);
      revealCopyBtn.querySelector('.btn-label').textContent = 'Copied!';
      setTimeout(() => {
        revealCopyBtn.querySelector('.btn-label').textContent = 'Copy Secret';
      }, 2000);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(revealContent);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });

  function goToCreate() {
    window.location.hash = '';
    showView(createView);
    secretInput.focus();
    resetCreateForm();
  }

  revealNewBtn.addEventListener('click', goToCreate);
  burnedNewBtn.addEventListener('click', goToCreate);

  revealPasswordBtn.addEventListener('click', async () => {
    const password = revealPasswordInput.value;
    if (!password) return;

    if (!pendingHashData) return;

    revealPasswordBtn.disabled = true;
    revealPasswordBtn.querySelector('.btn-label').textContent = 'Decrypting…';
    revealPasswordError.classList.add('hidden');

    try {
      let encryptedPayload, extra, version;

      if (pendingHashData.serverRoute) {
        const data = await fetchFromServer(pendingHashData.serverRoute.id);
        if (!data) {
          showRevealState(revealBurned);
          return;
        }
        encryptedPayload = data.encrypted;
        extra = pendingHashData.extra;
        version = pendingHashData.version;
      } else {
        encryptedPayload = pendingHashData.payload;
        extra = pendingHashData.extra;
        version = pendingHashData.version;
      }

      const plaintext = await decryptPayload(encryptedPayload, extra, version, password);
      revealContent.textContent = plaintext;
      revealWarning.textContent = pendingHashData.serverRoute
        ? 'This secret was stored server-side and is no longer available. Copy it now.'
        : 'This link can be viewed again if the URL is saved. Copy it now.';
      revealWarning.style.color = pendingHashData.serverRoute ? 'var(--danger)' : 'var(--warning)';
      showRevealState(revealSuccess);
      history.replaceState(null, '', window.location.origin + window.location.pathname);
      if (!pendingHashData.serverRoute) {
        if (clientBurnTimer) clearTimeout(clientBurnTimer);
        clientBurnTimer = setTimeout(() => {
          if (!revealSuccess.classList.contains('hidden')) {
            showRevealState(revealBurned);
            revealBurned.querySelector('p').textContent =
              'The secret was cleared from this page for security.';
          }
        }, CLIENT_BURN_DELAY);
      }
    } catch (err) {
      revealPasswordError.classList.remove('hidden');
      revealPasswordBtn.disabled = false;
      revealPasswordBtn.querySelector('.btn-label').textContent = 'Reveal Secret';
    }
  });

  revealPasswordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') revealPasswordBtn.click();
  });

  function showRevealState(state) {
    revealLoading.classList.add('hidden');
    revealPasswordPrompt.classList.add('hidden');
    revealSuccess.classList.add('hidden');
    revealBurned.classList.add('hidden');
    revealError.classList.add('hidden');
    state.classList.remove('hidden');
  }

  async function handleRoute() {
    const serverRoute = parseServerRoute();
    const hashData = parseHash();
    const hashExtra = parseHashExtraOnly();

    if (!serverRoute && !hashData) {
      showView(createView);
      secretInput.focus();
      await checkServer();
      updateBurnBadge();
      return;
    }

    showView(revealView);

    if (serverRoute) {
      if (!hashExtra) {
        showRevealState(revealError);
        return;
      }
      if (hashExtra.hasPassword) {
        pendingHashData = {
          serverRoute,
          extra: hashExtra.extra,
          version: hashExtra.version,
        };
        revealPasswordInput.value = '';
        revealPasswordError.classList.add('hidden');
        revealPasswordBtn.disabled = false;
        revealPasswordBtn.querySelector('.btn-label').textContent = 'Reveal Secret';
        showRevealState(revealPasswordPrompt);
        revealPasswordInput.focus();
        return;
      }
      showRevealState(revealLoading);
      try {
        const data = await fetchFromServer(serverRoute.id);
        if (!data) {
          showRevealState(revealBurned);
          return;
        }
        const plaintext = await decryptPayload(data.encrypted, hashExtra.extra, hashExtra.version);
        revealContent.textContent = plaintext;
        revealWarning.textContent = 'This secret was stored server-side and is no longer available. Copy it now.';
        revealWarning.style.color = 'var(--danger)';
        showRevealState(revealSuccess);
        history.replaceState(null, '', window.location.origin + window.location.pathname);
      } catch (err) {
        showRevealState(revealError);
      }
      return;
    }

    if (hashData.hasPassword) {
      pendingHashData = {
        serverRoute: null,
        payload: hashData.payload,
        extra: hashData.extra,
        version: hashData.version,
      };
      revealPasswordInput.value = '';
      revealPasswordError.classList.add('hidden');
      revealPasswordBtn.disabled = false;
      revealPasswordBtn.querySelector('.btn-label').textContent = 'Reveal Secret';
      showRevealState(revealPasswordPrompt);
      revealPasswordInput.focus();
      return;
    }

    showRevealState(revealLoading);
    try {
      const plaintext = await decryptPayload(hashData.payload, hashData.extra, hashData.version);
      revealContent.textContent = plaintext;
      revealWarning.textContent = 'This link can be viewed again if the URL is saved. Copy it now.';
      revealWarning.style.color = 'var(--warning)';
      showRevealState(revealSuccess);
      history.replaceState(null, '', window.location.pathname);
      if (clientBurnTimer) clearTimeout(clientBurnTimer);
      clientBurnTimer = setTimeout(() => {
        if (!revealSuccess.classList.contains('hidden')) {
          showRevealState(revealBurned);
          revealBurned.querySelector('p').textContent =
            'The secret was cleared from this page for security. If you saved the URL, it can still be viewed again.';
        }
      }, CLIENT_BURN_DELAY);
    } catch (err) {
      showRevealState(revealError);
    }
  }

  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('popstate', handleRoute);
  handleRoute();
});
