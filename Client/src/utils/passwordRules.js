export const getPasswordRuleChecks = (password) => {
  const value = String(password || '');
  return {
    minLength: value.length >= 8,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
  };
};

export const passwordRuleItems = [
  { key: 'minLength', label: '8 characters minimum' },
  { key: 'uppercase', label: 'At least one uppercase letter' },
  { key: 'lowercase', label: 'At least one lowercase letter' },
];

export function passwordPolicyOk(password) {
  return Object.values(getPasswordRuleChecks(password)).every(Boolean);
}

export function passwordPolicyMessage() {
  return 'Password must be at least 8 characters and include uppercase and lowercase letters';
}

export const TEMP_STAFF_PASSWORD = 'Soul@123';
