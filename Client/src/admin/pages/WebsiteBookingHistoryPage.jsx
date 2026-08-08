import WebsiteBookingsNav from '../components/WebsiteBookingsNav';
import WebsiteBookingHistory from '../components/WebsiteBookingHistory';

export default function WebsiteBookingHistoryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Website History</h1>
        <p className="mt-1 text-sm text-gray-500">
          Accepted, pending balance, and rejected website bookings.
        </p>
      </div>
      <WebsiteBookingsNav />
      <WebsiteBookingHistory />
    </div>
  );
}
