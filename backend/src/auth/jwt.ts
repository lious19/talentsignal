import jwt from "jsonwebtoken";

const MIN_SECRET_LENGTH = 32;
const ACCESS_TOKEN_TTL = "1h";

/**
 * Reads and validates JWT_SECRET on every call rather than caching it once
 * at import time, so server.ts can call this first thing at boot to fail
 * fast, and the same check applies consistently wherever a token is signed
 * or verified.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be set to a string of at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  return secret;
}

export interface AccessTokenClaims {
  sub: string;
  role: string;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, getJwtSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, getJwtSecret()) as AccessTokenClaims;
}
