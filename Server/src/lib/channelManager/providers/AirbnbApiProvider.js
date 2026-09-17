const { BaseChannelProvider } = require('../BaseChannelProvider');
const { FULL_API_CAPABILITIES } = require('../capabilities');

/**
 * Stub for Airbnb Connectivity / partner APIs.
 * Until API access is provisioned, use the iCal provider for calendar blocking only.
 */
class AirbnbApiProvider extends BaseChannelProvider {
  constructor() {
    super({
      key: 'airbnb_api',
      label: 'Airbnb (API)',
      connectionType: 'api',
      capabilities: FULL_API_CAPABILITIES,
      configured: false,
    });
  }

  async authenticate() {
    throw new Error(
      'Airbnb API is not configured. Use iCal calendar sync for availability blocking until Connectivity is enabled.'
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

module.exports = { AirbnbApiProvider };
