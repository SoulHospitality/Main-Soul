const {
  assessUnitCompleteness,
  resolveListingStatus,
} = require('../src/lib/unitCompleteness');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const incomplete = assessUnitCompleteness({
  title: 'X',
  compound: 'Y',
  property_type: 'Chalet',
  beds: 2,
  baths: 1,
  guests: 4,
  price_fallback: 0,
  cover_url: '',
  photo_urls: [],
}, { hasPrice: false });
assert(!incomplete.complete, 'should be incomplete');
assert(incomplete.missing.includes('photos'), 'missing photos');
assert(incomplete.missing.includes('price (fallback or daily rates)'), 'missing price');

const createIncomplete = resolveListingStatus({
  unit: {
    title: 'X',
    compound: 'Y',
    property_type: 'Chalet',
    beds: 2,
    baths: 1,
    guests: 4,
    price_fallback: 1000,
    cover_url: '',
    photo_urls: [],
  },
  hasPrice: true,
  requestedStatus: 'published',
  isCreate: true,
});
assert(createIncomplete.status === 'draft', 'incomplete create must be draft');

const createComplete = resolveListingStatus({
  unit: {
    title: 'X',
    compound: 'Y',
    property_type: 'Chalet',
    beds: 2,
    baths: 1,
    guests: 4,
    price_fallback: 1000,
    cover_url: 'https://example.com/a.jpg',
    photo_urls: ['https://example.com/a.jpg'],
  },
  hasPrice: true,
  requestedStatus: 'draft',
  isCreate: true,
});
assert(createComplete.status === 'published', 'complete create publishes even if draft requested');

const demote = resolveListingStatus({
  unit: {
    title: 'X',
    compound: 'Y',
    property_type: 'Chalet',
    beds: 2,
    baths: 1,
    guests: 4,
    price_fallback: 0,
    cover_url: 'https://example.com/a.jpg',
    photo_urls: [],
  },
  hasPrice: false,
  requestedStatus: 'published',
  previousStatus: 'published',
  isCreate: false,
});
assert(demote.status === 'draft', 'incomplete update demotes published');

console.log('unitCompleteness tests passed');
