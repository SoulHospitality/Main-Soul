const env = process.env;

const isProduction = env.NODE_ENV === 'production';

const config = {
  isProduction,
  timezone: env.INBOX_TIMEZONE || 'Africa/Cairo',
  get tokenSecret() {
    return env.INBOX_TOKEN_KEY || env.JWT_SECRET || 'dev-only-inbox-token-key';
  },
  meta: {
    get appId() { return env.META_APP_ID || ''; },
    get appSecret() { return env.META_APP_SECRET || ''; },
    get verifyToken() { return env.META_VERIFY_TOKEN || ''; },
    get graphVersion() { return env.META_GRAPH_VERSION || 'v23.0'; },
  },
  ai: {
    get apiKey() { return env.ANTHROPIC_API_KEY || ''; },
    get model() { return env.AI_MODEL || 'claude-opus-5-5'; },
  },
  /** Simulated customers never reach Meta, so the simulator stays on unless explicitly disabled. */
  get simulatorEnabled() {
    return env.INBOX_SIMULATOR ? env.INBOX_SIMULATOR === 'true' : true;
  },
};

module.exports = { config };
