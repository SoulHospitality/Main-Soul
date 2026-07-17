import { passwordRuleItems } from '../../utils/passwordRules';

/** Live checklist matching SoulHospitality change/reset password UX */
export default function PasswordChecklist({ checks, className = '' }) {
  return (
    <div
      className={`grid gap-2 rounded-xl border border-soul-line bg-[var(--pms-header-tint,rgba(40,63,94,0.04))] p-3 sm:grid-cols-2 ${className}`}
    >
      {passwordRuleItems.map((rule) => {
        const passed = checks[rule.key];
        return (
          <div
            key={rule.key}
            className={`flex items-center gap-2 text-xs sm:text-sm ${
              passed ? 'text-emerald-700' : 'text-soul-muted'
            }`}
          >
            <span
              className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-[10px] ${
                passed
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-soul-line bg-white'
              }`}
            >
              {passed ? '✓' : '×'}
            </span>
            <span>{rule.label}</span>
          </div>
        );
      })}
    </div>
  );
}
