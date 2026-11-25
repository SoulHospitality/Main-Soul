const { escapeHtml: e } = require('./escapeHtml');

/** Staff email for a website inquiry. Every value is guest input or listing data, so all are escaped. */
function inquiryEmailHtml({ guestName, guestPhone, unitTitle, checkin, checkout, guests, message }) {
  return `<p><strong>${e(guestName)}</strong> (${e(guestPhone)}) inquired about <em>${e(unitTitle)}</em></p>
               <p>${e(checkin)} → ${e(checkout)}, ${e(guests)} guests</p>
               <p>${e(message || '')}</p>`;
}

/** Staff email for a "Become a Host" request from the public website form. */
function hostRequestEmailHtml({ fullName, email, phone, destination, project, propertyType, furnishing, preferredContact, leadId }) {
  return `<p><strong>${e(fullName)}</strong> requested to list a property.</p>
               <ul>
                 <li>Email: ${e(email)}</li>
                 <li>Phone: ${e(phone)}</li>
                 <li>Destination: ${e(destination)}</li>
                 <li>Project: ${e(project)}</li>
                 <li>Property type: ${e(propertyType)}</li>
                 <li>Furnishing: ${e(furnishing)}</li>
                 <li>Preferred contact: ${e(preferredContact)}</li>
                 <li>Lead #${e(leadId)}</li>
               </ul>`;
}

module.exports = { inquiryEmailHtml, hostRequestEmailHtml };
