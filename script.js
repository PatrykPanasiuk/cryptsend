const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

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

function buildSecretUrl(payload, key) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#${payload}.${key}`;
}

function parseHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  const dotIndex = hash.lastIndexOf('.');
  if (dotIndex === -1) return null;
  return {
    payload: hash.slice(0, dotIndex),
    key: hash.slice(dotIndex + 1),
  };
}

const MAX_LENGTH = 5000;

document.addEventListener('DOMContentLoaded', () => {
  const createView = document.getElementById('create-view');
  const revealView = document.getElementById('reveal-view');
  const createForm = document.getElementById('create-form');
  const secretInput = document.getElementById('secret-input');
  const charCounter = document.getElementById('char-counter');
  const createBtn = document.getElementById('create-btn');
  const resultCard = document.getElementById('result-card');
  const resultLink = document.getElementById('result-link');
  const copyBtn = document.getElementById('copy-btn');
  const newSecretBtn = document.getElementById('new-secret-btn');
  const revealLoading = document.getElementById('reveal-loading');
  const revealSuccess = document.getElementById('reveal-success');
  const revealError = document.getElementById('reveal-error');
  const revealContent = document.getElementById('reveal-content');
  const revealCopyBtn = document.getElementById('reveal-copy-btn');
  const revealNewBtn = document.getElementById('reveal-new-btn');

  function showView(view) {
    createView.classList.remove('active');
    revealView.classList.remove('active');
    view.classList.add('active');
  }

  function updateCharCounter() {
    const len = secretInput.value.length;
    charCounter.textContent = `${len} / ${MAX_LENGTH}`;
  }

  secretInput.addEventListener('input', updateCharCounter);

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const secret = secretInput.value.trim();
    if (!secret) return;

    createBtn.disabled = true;
    createBtn.querySelector('.btn-label').textContent = 'Encrypting…';

    try {
      const { payload, key } = await createEncryptedPayload(secret);
      const url = buildSecretUrl(payload, key);
      resultLink.value = url;
      resultCard.classList.remove('hidden');
      resultLink.focus();
      resultLink.select();
      window.location.hash = '';
    } catch (err) {
      alert('Encryption failed. Please try again.');
      console.error('Encryption error:', err);
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
    resultCard.classList.add('hidden');
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

  revealNewBtn.addEventListener('click', () => {
    window.location.hash = '';
    showView(createView);
    secretInput.focus();
  });

  async function handleHash() {
    const parsed = parseHash();
    if (!parsed) {
      showView(createView);
      secretInput.focus();
      return;
    }

    showView(revealView);
    revealLoading.classList.remove('hidden');
    revealSuccess.classList.add('hidden');
    revealError.classList.add('hidden');

    try {
      const plaintext = await decryptPayload(parsed.payload, parsed.key);
      revealContent.textContent = plaintext;
      revealLoading.classList.add('hidden');
      revealSuccess.classList.remove('hidden');
      history.replaceState(null, '', window.location.pathname);
    } catch (err) {
      revealLoading.classList.add('hidden');
      revealError.classList.remove('hidden');
      console.error('Decryption error:', err);
    }
  }

  window.addEventListener('hashchange', handleHash);
  handleHash();
});
