// Base64 <-> ArrayBuffer helpers (internal)
function b64ToBuffer(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function bufferToB64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export const DEFAULT_ITERATIONS = 250000;

export const SENTINEL_VALUE = 'MASSIV_VAULT_OK';

export function generateSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bufferToB64(bytes.buffer);
}

export async function deriveKey(passphrase, saltB64, iterations) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: b64ToBuffer(saltB64),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptSecret(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  return { cipher: bufferToB64(cipherBuf), iv: bufferToB64(iv.buffer) };
}

export async function decryptSecret(key, cipherB64, ivB64) {
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuffer(ivB64) },
    key,
    b64ToBuffer(cipherB64)
  );
  return new TextDecoder().decode(plainBuf);
}

export async function makeSentinel(key) {
  return encryptSecret(key, SENTINEL_VALUE);
}

export async function verifyKey(key, sentinelCipherB64, sentinelIvB64) {
  try {
    const plain = await decryptSecret(key, sentinelCipherB64, sentinelIvB64);
    return plain === SENTINEL_VALUE;
  } catch (_) {
    return false;
  }
}
