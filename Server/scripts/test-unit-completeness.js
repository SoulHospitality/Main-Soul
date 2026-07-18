const {
  assessUnitCompleteness,
  resolveListingStatus,
} = require('../src/lib/unitCompleteness');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function completeUnit(over = {}) {
  return {
    title: 'X',
    compound: 'Y',
    area: 'North Coast',
    property_type: 'Chalet',
    unit_number: 'A1',
    view: 'Sea view',
    beds: 2,
    baths: 1,
    floor: 0,
    guests: 4,
    min_nights: 1,
    price_fallback: 1000,
    utilities_cost: 0,
    access_fee_per_adult_egp: 100,
    access_fee_per_teen_egp: 50,
    access_card_count_included: 7,
    the_property: 'Nice chalet by the lagoon.',
    amenities: ['Wi-Fi'],
    source_url: 'https://maps.google.com/',
    cover_url: 'https://example.com/a.jpg',
    photo_urls: ['https://example.com/a.jpg'],
    ...over,
  };
}

const incomplete = assessUnitCompleteness(completeUnit({
  price_fallback: 0,
  cover_url: '',
  photo_urls: [],
  the_property: '',
  access_fee_per_adult_egp: null,
}), { hasPrice: false });
assert(!incomplete.complete, 'should be incomplete');
assert(incomplete.missing.includes('photos'), 'missing photos');
assert(incomplete.missing.includes('price (fallback or daily rates)'), 'missing price');
assert(incomplete.missing.includes('description'), 'missing description');
assert(incomplete.missing.includes('beach access price'), 'missing beach');

const createIncomplete = resolveListingStatus({
  unit: completeUnit({ the_property: '' }),
  hasPrice: true,
  requestedStatus: 'published',
  isCreate: true,
});
assert(createIncomplete.status === 'draft', 'incomplete create must be draft');

const createComplete = resolveListingStatus({
  unit: completeUnit(),
  hasPrice: true,
  requestedStatus: 'draft',
  isCreate: true,
});
assert(createComplete.status === 'published', 'complete create publishes even if draft requested');

const demote = resolveListingStatus({
  unit: completeUnit({ access_fee_per_adult_egp: null }),
  hasPrice: true,
  requestedStatus: 'published',
  previousStatus: 'published',
  isCreate: false,
});
assert(demote.status === 'draft', 'incomplete update demotes published');

const zeroBeachOk = assessUnitCompleteness(completeUnit({
  access_fee_per_adult_egp: 0,
  access_fee_per_teen_egp: 0,
}));
assert(zeroBeachOk.complete, 'zero beach fees count as filled');

console.log('unitCompleteness tests passed');
