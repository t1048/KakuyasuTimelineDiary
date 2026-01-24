const textEncoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function buildSigningPayload(path: string, expires: number): string {
  return `${path}|${expires}`;
}

export async function createUploadSignature(
  path: string,
  expires: number,
  secret: string
): Promise<string> {
  const key = await importSigningKey(secret);
  const payload = buildSigningPayload(path, expires);
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function verifyUploadSignature(
  path: string,
  expires: number,
  signature: string,
  secret: string
): Promise<boolean> {
  const expected = await createUploadSignature(path, expires, secret);
  return timingSafeEqual(expected, signature);
}
