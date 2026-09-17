const { BaseChannelProvider } = require('../BaseChannelProvider');
const { FULL_API_CAPABILITIES } = require('../capabilities');

/**
 * Stub for Booking.com Connectivity APIs (availability, rates, reservations).
 * Credentials and live calls are intentionally not wired until partnership keys exist.
 */
class BookingApiProvider extends BaseChannelProvider {
  constructor() {
    super({
      key: 'booking_api',
      label: 'Booking.com (API)',
      connectionType: 'api',
      capabilities: FULL_API_CAPABILITIES,
      configured: false,
    });
  }

  async authenticate() {
    throw new Error(
      'Booking.com API is not configured. Use iCal as a fallback, or add Connectivity credentials when available.'
    );
  }

  async pullAvailability() {
    return this.authenticate();
  }

  async pushAvailability() {
    return this.authenticate();
  }

  async pullReservations() {
    return this.authenticate();
  }

  async pullCancellations() {
    return this.authenticate();
  }

  async pullModifications() {
    return this.authenticate();
  }

  async pushRates() {
    return this.authenticate();
  }
}

module.exports = { BookingApiProvider };
