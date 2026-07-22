// bcrypt cost factor 12: ~250-300ms per hash on typical hardware. Deliberately
// slow — that cost is bcrypt's entire brute-force defense, not incidental
// latency, which is why auth endpoints are exempt from REQ-017's general p95
// target (see 06_decisions/006-bcrypt-cost-factor.md).
export const BCRYPT_COST = 12;

// bcrypt only hashes the first 72 bytes of its input; anything past that is
// silently ignored. We enforce a max length at validation time instead of
// letting a longer password quietly collapse to the same hash as its first
// 72 characters.
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 72;
