const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const MAX_LENGTH = 5000;
const CLIENT_BURN_DELAY = 30000;

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

async function createEncryptedPayload(plaintext) {
  const key = await generateKey();
  const combined = await encrypt(plaintext, key);
  const payload = base64UrlEncode(combined);
  const keyStr = await exportKey(key);
  return { payload, key: keyStr };
}

async function decryptPayload(payload, keyStr) {
  const combined = base64UrlDecode(payload);
  const key = await importKey(keyStr);
  return await decrypt(combined, key);
}

function buildClientUrl(payload, key) {
  return `${window.location.origin}${window.location.pathname}#${payload}.${key}`;
}

function buildServerUrl(id, key) {
  return `${window.location.origin}/r/${id}#${key}`;
}

function parseClientHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  const dotIndex = hash.lastIndexOf('.');
  if (dotIndex === -1) return null;
  return {
    payload: hash.slice(0, dotIndex),
    key: hash.slice(dotIndex + 1),
  };
}

function parseServerRoute() {
  const match = window.location.pathname.match(/^\/r\/([a-f0-9]{32})$/);
  if (!match) return null;
  return { id: match[1] };
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

  const revealLoading = document.getElementById('reveal-loading');
  const revealSuccess = document.getElementById('reveal-success');
  const revealBurned = document.getElementById('reveal-burned');
  const revealError = document.getElementById('reveal-error');
  const revealContent = document.getElementById('reveal-content');
  const revealWarning = document.getElementById('reveal-warning');
  const revealCopyBtn = document.getElementById('reveal-copy-btn');
  const revealNewBtn = document.getElementById('reveal-new-btn');
  const burnedNewBtn = document.getElementById('burned-new-btn');

  let serverAvailable = false;
  let clientBurnTimer = null;

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

  secretInput.addEventListener('input', updateCharCounter);

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const secret = secretInput.value.trim();
    if (!secret) return;

    createBtn.disabled = true;
    createBtn.querySelector('.btn-label').textContent = 'Encrypting…';

    try {
      const { payload, key } = await createEncryptedPayload(secret);
      const useServer = burnToggle.checked && serverAvailable;

      if (useServer) {
        const ttlValue = expireSelect.value;
        const ttl = ttlValue === 'never' ? 604800 : parseInt(ttlValue, 10);
        createBtn.querySelector('.btn-label').textContent = 'Storing on server…';
        try {
          const { id } = await storeOnServer(payload, ttl);
          const url = buildServerUrl(id, key);
          resultLink.value = url;
          resultModeBadge.textContent = 'one-time';
          resultModeBadge.className = 'badge badge-server';
          resultDesc.textContent = 'This link works once. After viewing, the secret is permanently deleted from the server.';
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

      const url = buildClientUrl(payload, key);
      resultLink.value = url;
      resultModeBadge.textContent = 'multi-view';
      resultModeBadge.className = 'badge badge-client';
      resultDesc.textContent = 'Secret is embedded in the link. Anyone with the URL can view it.';
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

  function showRevealState(state) {
    revealLoading.classList.add('hidden');
    revealSuccess.classList.add('hidden');
    revealBurned.classList.add('hidden');
    revealError.classList.add('hidden');
    state.classList.remove('hidden');
  }

  async function handleRoute() {
    const serverRoute = parseServerRoute();
    const clientHash = parseClientHash();

    if (!serverRoute && !clientHash) {
      showView(createView);
      secretInput.focus();
      await checkServer();
      updateBurnBadge();
      return;
    }

    showView(revealView);
    showRevealState(revealLoading);

    try {
      if (serverRoute) {
        const hashData = parseClientHash();
        if (!hashData) {
          showRevealState(revealError);
          return;
        }
        const data = await fetchFromServer(serverRoute.id);
        if (!data) {
          showRevealState(revealBurned);
          return;
        }
        const plaintext = await decryptPayload(data.encrypted, hashData.key);
        revealContent.textContent = plaintext;
        revealWarning.textContent = 'This secret was stored server-side and has been permanently deleted. Copy it now.';
        revealWarning.style.color = 'var(--danger)';
        showRevealState(revealSuccess);
        history.replaceState(null, '', window.location.origin + window.location.pathname);
      } else {
        const plaintext = await decryptPayload(clientHash.payload, clientHash.key);
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
      }
    } catch (err) {
      showRevealState(revealError);
    }
  }

  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('popstate', handleRoute);
  handleRoute();
});
