const PASSWORD_POLICY_EXEMPT_EMAILS = new Set(['mayarmuhammed33@gmail.com']);

export function isPasswordPolicyExempt(email) {
  return PASSWORD_POLICY_EXEMPT_EMAILS.has(String(email || '').trim().toLowerCase());
}

export const getPasswordRuleChecks = (password, email) => {
  if (isPasswordPolicyExempt(email)) {
    const ok = Boolean(String(password || ''));
    return { minLength: ok, uppercase: ok, lowercase: ok };
  }
  const value = String(password || '');
  return {
    minLength: value.length >= 8,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
  };
};

export const passwordRuleItems = [
  { key: 'minLength', label: '8 characters minimum', labelKey: 'common.passwordMinLength' },
  { key: 'uppercase', label: 'At least one uppercase letter', labelKey: 'common.passwordUppercase' },
  { key: 'lowercase', label: 'At least one lowercase letter', labelKey: 'common.passwordLowercase' },
];

export function passwordPolicyOk(password, email) {
  return Object.values(getPasswordRuleChecks(password, email)).every(Boolean);
}

export function passwordPolicyMessage() {
  return 'Password must be at least 8 characters and include uppercase and lowercase letters';
}

export const TEMP_STAFF_PASSWORD = 'Soul@123';
