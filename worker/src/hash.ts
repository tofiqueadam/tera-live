/**
 * Salted SHA-256, hex-encoded and truncated to 128 bits.
 * Used for device ids and IP addresses so neither is ever stored raw.
 */
export async function saltedHash(salt: string, value: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}\u0000${value}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
