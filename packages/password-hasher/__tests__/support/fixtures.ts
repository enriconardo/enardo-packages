// Hashes made with argon2 0.45.2, unless stated: they show that a hash of a
// second implementation verifies, on the parameters it holds.
export const BASE_PASSWORD = "P@ssword123";
export const WRONG_PASSWORD = "P@ssword124";

/** `m=1024,t=1,p=1`: the base of the variations of the parser's cases. */
export const BASE_HASH =
  "$argon2id$v=19$m=1024,t=1,p=1$Pt1RAjrZoLbGkgAzMx50AQ$t0+r5GK5fEH7yWcUkRng8o5I73owQxp4dIGyttHBTlA";
export const BASE_SALT = "Pt1RAjrZoLbGkgAzMx50AQ";
export const BASE_TAG = "t0+r5GK5fEH7yWcUkRng8o5I73owQxp4dIGyttHBTlA";

export const T2_P2_HASH =
  "$argon2id$v=19$m=1024,t=2,p=2$uNgbAqSpLM/meHf2XJLR5g$kCOc5cQXqWVZJAa69UqZzeCa550V5vTNOlQZHoqquss";
export const SHORT_TAG_HASH =
  "$argon2id$v=19$m=1024,t=1,p=1$nKmutj2bbZz+v+FVa2MxWw$fl27dxNMjDWIONGgOjXOyA";

export const CAFE_NFC = "café";
export const CAFE_NFD = "café";
export const CAFE_NFC_HASH =
  "$argon2id$v=19$m=1024,t=1,p=1$j5fUHlX0a4XftdkQfmZgQQ$Xu4rqQ4fEZciUHlmy627xkyJdvmOnqCBfvX5TpFIcNs";

export const LONG_PASSWORD = "a".repeat(100);
export const LONG_PASSWORD_HASH =
  "$argon2id$v=19$m=1024,t=1,p=1$p/Zre/2BHtEnIJm+TY2Kug$uwPoXdIK5v/j1FaA13EIltaJD1r6JK83h5yCozaM9H8";

export const TOO_LONG_PASSWORD = "a".repeat(1025);
/**
 * Made with `crypto.argon2` from `TOO_LONG_PASSWORD`: on any other hash, a
 * `compare` with no check of the length also resolves `false`.
 */
export const TOO_LONG_PASSWORD_HASH =
  "$argon2id$v=19$m=1024,t=1,p=1$xchqjJLkT1RFtcNUl8dHzw$RK3NCAX5ys5acHqu7Ucw8DJohGP+nUHFPiYPBDBzNkM";

export const BCRYPT_HASH =
  "$2b$04$K3jkotAxEI6VAxGGMsYVBua0nImI9fCxSsOQhpjcvi0DKZ/zmbUWS";

/** Unpadded standard base64 of `bytes` bytes, as a salt or a tag. */
export function base64OfLength(bytes: number): string {
  return Buffer.alloc(bytes, 0x5a).toString("base64").replace(/=+$/, "");
}
