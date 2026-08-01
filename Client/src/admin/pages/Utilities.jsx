import { Zap } from 'lucide-react';
import CategoryLedgerPage from '../components/finance/CategoryLedgerPage';

export default function Utilities() {
  return (
    <CategoryLedgerPage
      category="utilities_cost"
      title="Actual utilities"
      subtitle="Manual actual utility costs — deducted from profit. Guest-collected utilities are revenue on Finance."
      icon={Zap}
      entryLabel="cost"
      descriptionPlaceholder="e.g. July electricity — Fouka Bay SA-4B-102"
    />
  );
}
