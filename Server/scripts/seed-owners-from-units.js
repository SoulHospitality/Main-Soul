require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { seedOwnersFromUnits } = require('../src/lib/seedOwnersFromUnits');
const { normalizeOwnerPhone, ownerPhoneLoginVariants } = require('../src/lib/ownerPhone');

console.log('normalize 01271711901 →', normalizeOwnerPhone('01271711901'));
console.log('normalize +201271711901 →', normalizeOwnerPhone('+201271711901'));
console.log('variants', ownerPhoneLoginVariants('+201271711901'));

seedOwnersFromUnits()
  .then((r) => {
    console.log(r);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
