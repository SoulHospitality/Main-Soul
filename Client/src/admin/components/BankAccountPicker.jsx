import { BANK_ACCOUNTS, BANK_ACCOUNT_LABELS } from '../utils/formatters';

/** InstaPay / bank transfers land in either the ADIB or the CIB account. */
export default function BankAccountPicker({ value, onChange, label = 'InstaPay to account', compact = false }) {
  return (
    <div>
      <p className={compact ? 'text-[10px] uppercase text-gray-500' : 'label'}>
        {label} <span className="text-red-500">*</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        {BANK_ACCOUNTS.map((account) => {
          const active = value === account;
          return (
            <button
              key={account}
              type="button"
              onClick={() => onChange(account)}
              className={`rounded-lg border px-3 ${compact ? 'py-1.5 text-xs' : 'py-2 text-sm'} font-semibold transition ${
                active
                  ? 'border-[#1e5fbf] bg-[#eef4ff] text-[#1e5fbf]'
                  : 'border-[#e6ebf2] bg-white text-[#5b6b80] hover:bg-[#f6f8fb]'
              }`}
            >
              {BANK_ACCOUNT_LABELS[account]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
