import WebsiteBookingsNav from '../components/WebsiteBookingsNav';
import WebsiteBookingUnassigned from '../components/WebsiteBookingUnassigned';

export default function WebsiteBookingUnassignedPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Unassigned Requests</h1>
        <p className="mt-1 text-sm text-gray-500">
          New website reservations wait here until a website agent claims them.
        </p>
      </div>
      <WebsiteBookingsNav />
      <WebsiteBookingUnassigned />
    </div>
  );
}
