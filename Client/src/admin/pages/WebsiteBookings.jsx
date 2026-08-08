import WebsiteBookingsNav from '../components/WebsiteBookingsNav';
import WebsiteBookingRequests from '../components/WebsiteBookingRequests';

export default function WebsiteBookings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Website Bookings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Accept or reject website requests assigned to you. Claim new ones from Unassigned.
        </p>
      </div>
      <WebsiteBookingsNav />
      <WebsiteBookingRequests />
    </div>
  );
}
