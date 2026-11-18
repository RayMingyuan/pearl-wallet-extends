export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 1024;
// Below this length, a letters-only or digits-only password is rejected in the UI. A longer single character class is still allowed.
export const UNIFORM_PASSWORD_MIN_LENGTH = 12;

const PASSWORD_PADDING = /[\s\u200B-\u200D\uFEFF]/gu;

export function isShortUniformPassword(password) {
  if (typeof password !== "string") return false;
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) return false;
  const value = password.replace(PASSWORD_PADDING, "");
  if (value.length >= UNIFORM_PASSWORD_MIN_LENGTH) return false;
  if (value.length < MIN_PASSWORD_LENGTH) return true;
  return /^\p{L}+$/u.test(value) || /^\p{N}+$/u.test(value);
}
