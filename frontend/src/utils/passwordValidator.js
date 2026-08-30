/**
 * Password validation utility matching backend rules
 * Rules: min 8 chars, uppercase, lowercase, digit, special character
 */

export function getPasswordStrength(password) {
  const checks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };

  const score = Object.values(checks).filter(Boolean).length;
  const levels = ['', 'weak', 'fair', 'strong', 'very strong'];
  const colors = ['', 'bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500'];
  const textColors = ['', 'text-red-500', 'text-orange-500', 'text-yellow-500', 'text-green-500'];

  return {
    checks,
    score,
    label: levels[score],
    barColor: colors[score],
    textColor: textColors[score],
    isValid: score >= 4, // Must meet all 5 requirements
  };
}

/**
 * Issue #656: 4-level password strength model for the Register page.
 *
 * Scored across four dimensions surfaced in the checklist (length, uppercase,
 * number, special character) and four character classes used for the level
 * thresholds (lowercase, uppercase, number, special):
 *   - Weak (red):        < 8 chars OR only one character class
 *   - Fair (orange):     >= 8 chars and 2 character classes
 *   - Strong (blue):     >= 8 chars and 3 character classes
 *   - Very Strong (green): >= 12 chars and all 4 character classes
 *
 * Returns score 0 for an empty password (nothing to render).
 */
export function getRegisterPasswordStrength(password = '') {
  const checks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };

  const classes =
    (/[a-z]/.test(password) ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0);

  const len = password.length;

  // 0 = empty, 1 = weak, 2 = fair, 3 = strong, 4 = very strong
  let score;
  if (len === 0) {
    score = 0;
  } else if (len >= 12 && classes === 4) {
    score = 4;
  } else if (len >= 8 && classes >= 3) {
    score = 3;
  } else if (len >= 8 && classes >= 2) {
    score = 2;
  } else {
    score = 1;
  }

  const meta = [
    { label: '', barColor: '', textColor: '' },
    { label: 'Weak', barColor: 'bg-red-500', textColor: 'text-red-500' },
    { label: 'Fair', barColor: 'bg-orange-500', textColor: 'text-orange-500' },
    { label: 'Strong', barColor: 'bg-blue-500', textColor: 'text-blue-500' },
    { label: 'Very Strong', barColor: 'bg-green-500', textColor: 'text-green-500' },
  ][score];

  return {
    score,
    classes,
    checks,
    label: meta.label,
    barColor: meta.barColor,
    textColor: meta.textColor,
    // The Create Account button is enabled at "Fair" strength or above.
    isAcceptable: score >= 2,
  };
}

export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function getEmailError(email) {
  if (!email) return 'Email is required';
  if (!validateEmail(email)) return 'Please enter a valid email address';
  return '';
}

export function getPasswordError(password) {
  if (!password) return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';

  const strength = getPasswordStrength(password);
  const unmet = [];

  if (!strength.checks.uppercase) unmet.push('uppercase letter');
  if (!strength.checks.lowercase) unmet.push('lowercase letter');
  if (!strength.checks.number) unmet.push('number');
  if (!strength.checks.special) unmet.push('special character');

  if (unmet.length > 0) {
    return `Password must contain at least one ${unmet.join(', ')}`;
  }

  return '';
}
