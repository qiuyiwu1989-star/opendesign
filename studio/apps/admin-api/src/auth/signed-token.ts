import { createHmac, timingSafeEqual } from "node:crypto";

export interface SignedTokenCodec {
  sign(value: string): string;
  verify(token: string): string | undefined;
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

export function createSignedTokenCodec(secret: string, purpose: string): SignedTokenCodec {
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("Signing secret must contain at least 32 bytes");
  if (!/^[a-z][a-z0-9:-]{2,63}$/.test(purpose)) throw new Error("Invalid signing purpose");

  const signValue = (value: string): Buffer => createHmac("sha256", secret).update(purpose).update("\0").update(value).digest();
  return {
    sign(value) {
      const encoded = base64url(value);
      return `${encoded}.${base64url(signValue(encoded))}`;
    },
    verify(token) {
      const [encoded, supplied, extra] = token.split(".");
      if (!encoded || !supplied || extra !== undefined || encoded.length > 4096 || supplied.length !== 43) return undefined;
      let suppliedBuffer: Buffer;
      try {
        suppliedBuffer = Buffer.from(supplied, "base64url");
      } catch {
        return undefined;
      }
      const expected = signValue(encoded);
      if (suppliedBuffer.byteLength !== expected.byteLength || !timingSafeEqual(suppliedBuffer, expected)) return undefined;
      try {
        return Buffer.from(encoded, "base64url").toString("utf8");
      } catch {
        return undefined;
      }
    },
  };
}
