import { Megaphone } from 'lucide-react';
import CategoryLedgerPage from '../components/finance/CategoryLedgerPage';

export default function Marketing() {
  return (
    <CategoryLedgerPage
      category="marketing"
      title="Marketing"
      subtitle="Marketing spend — deducted from revenue in profit"
      icon={Megaphone}
      entryLabel="expense"
      descriptionPlaceholder="e.g. Instagram ads July"
    />
  );
}
