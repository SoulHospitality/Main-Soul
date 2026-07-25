import { Users2 } from 'lucide-react';
import CategoryLedgerPage from '../components/finance/CategoryLedgerPage';

export default function Salaries() {
  return (
    <CategoryLedgerPage
      category="salary"
      title="Salaries"
      subtitle="Salary payments recorded in the books — deducted from revenue in profit"
      icon={Users2}
      entryLabel="payment"
      descriptionPlaceholder="e.g. July payroll — Ahmed"
    />
  );
}
