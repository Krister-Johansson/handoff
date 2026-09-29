import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies X-Hub-Signature-256 (HMAC-SHA256 of the raw body). Never throws. */
export function verifyGitHubSignature(rawBody: string | Buffer, header: string | null | undefined, secret: string): boolean {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const received = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(received)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}
