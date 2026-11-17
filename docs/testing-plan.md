# Soul PMS and website: testing plan

Run this before every release that touches money, bookings or permissions, and in full once a month.
Each case has an expected result; anything else is a defect (log it with the page, the role, the steps and a screenshot).

## How to run it

| Pass | Who | What | Time |
| --- | --- | --- | --- |
| 1. Automated sweep | Developer | Every admin and website page opened in a browser and every button clicked against a test database; every server read endpoint called. Fails on crashes, blank pages and server errors. | 30 min |
| 2. Money paths | Finance + developer | Section 4 and 7 on the staging site with Paymob test cards and small real InstaPay amounts. | 2 h |
| 3. Role walk-through | One person per role | Sign in as each role (section 12) and do that role's daily work end to end. | 30 min per role |
| 4. Phone pass | Ops + housekeeping | Sections 8 and 10 on a real phone (Android and iPhone): clock-in, door collection, photos, cleaning. | 1 h |
| 5. Arabic and phone layout | Anyone | Every guest page and the Financial System in Arabic, at phone width. | 1 h |

Test accounts: one per role, plus the demo owner. Use test units only for bookings that take real money, and cancel them afterwards.

## 1. Guest website

| # | Function | Steps | Expected |
| --- | --- | --- | --- |
| 1.1 | Home page | Open `/` on desktop and phone | Hero photos sharp and moving, destinations, featured homes, partners, no broken images |
| 1.2 | Search | Pick destination, dates, guests; apply filters; clear filters | Results match; price per night shown; empty state when none |
| 1.3 | Listing page | Open a home; change dates in the booking card | Gallery, details, rules, reviews; price updates; blocked dates cannot be picked |
| 1.4 | Minimum stay and blocked dates | Pick fewer nights than the project minimum; pick a booked night | Booking refused with a clear message |
| 1.5 | Promo code | Apply a valid, an expired and a wrong code | Discount only for the valid one |
| 1.6 | Sign up / sign in / forgot password | Each flow | Account created, email received, reset works |
| 1.7 | Wishlist | Add and remove a home while signed in | Saved across sessions |
| 1.8 | Contact, owners and host onboarding forms | Submit each | Lead appears in Leads / Owner leads |
| 1.9 | Language and currency | Switch to Arabic and to USD | Layout right-to-left; prices converted |
| 1.10 | Chatbot | Ask for a stay; give name and phone; ask for a manager | Asks once for details with the reason; shows units; urgent call created |
| 1.11 | Portfolio page `/portfolio` | Open by link | No link back to the site; content matches Website › Portfolio page |

## 2. Booking and payment (guest)

| # | Function | Steps | Expected |
| --- | --- | --- | --- |
| 2.1 | Card payment | Book with a Paymob test card | Redirect to Paymob, back to success page, booking appears in Website Requests, payment recorded once |
| 2.2 | Failed card | Use a declining test card | Failure page; no booking confirmed; dates released after the hold expires |
| 2.3 | InstaPay / cash request | Book with InstaPay | Booking waits for staff; no payment until accepted |
| 2.4 | ID upload | Book without ID photos | Refused with a message |
| 2.5 | Receipt link | Open the receipt link from the confirmation | Branded receipt, correct totals |
| 2.6 | Double booking | Two browsers book the same dates | Only one succeeds |

## 3. Overview: dashboard, KPI, audit log, website

| # | Function | Expected |
| --- | --- | --- |
| 3.1 | Dashboard figures | Month revenue, paid this month and still owed match the Financial System for the same month |
| 3.2 | KPI page | Targets save; progress updates after a booking |
| 3.3 | Audit log | Every edit, payment, refund and approval appears with user and time |
| 3.4 | Website › Homepage, Partners, Property order, Entry popup, Portfolio page | Each change publishes and shows on the site; empty fields fall back to the default |
| 3.5 | Report button (header) | On any page with tables: PDF, Excel, CSV and Print each produce the table on screen |

## 4. Reservations

| # | Function | Steps | Expected |
| --- | --- | --- | --- |
| 4.1 | Manual reservation | Create with down payment, with and without the 15% service | Total correct; service only when ticked; down payment waits in Reservation collection |
| 4.2 | Owner stay / hold | Create each | No charge; dates blocked |
| 4.3 | Edit dates / unit / price | Edit an upcoming stay | Calendar, bill and books update; closed month changes post as a correction |
| 4.4 | Record payment | Cash, InstaPay (ADIB / CIB), card | Paid and balance update; treasury correct in the books |
| 4.5 | Cancel with refund | Cancel as reservations, then as CEO | Staff path asks for approval; CEO path refunds at once from the chosen treasury |
| 4.6 | Transfer to another unit | Use Transfer | Old dates freed, new blocked, money follows |
| 4.7 | Receipt | Open and download | Branded receipt with the right lines |
| 4.8 | Website Requests | Accept, reject, assign | Accepted booking becomes a reservation; guest notified |
| 4.9 | Schedule | Drag a stay, change a price, block dates | Saves; no overlap allowed |
| 4.10 | Calendar sync | Add an iCal feed; run sync | Bookings imported; our calendar exported |

## 5. Inventory

| # | Function | Expected |
| --- | --- | --- |
| 5.1 | Units: add, edit, photos, publish / unpublish | Changes show on the website; unpublished units hidden |
| 5.2 | Destinations: add project, photo, rules, minimum stay | Shown in the catalog and destination grid |
| 5.3 | Owner leads pipeline | Lead moves through stages; converts to a unit |
| 5.4 | Owner statement | PDF for an owner and period matches the owner portal |

## 6. Inbox and CRM

| # | Function | Expected |
| --- | --- | --- |
| 6.1 | Live inbox | Messages from Instagram, Messenger, WhatsApp and website arrive; replies deliver |
| 6.2 | Assignment and SLA | Unanswered chats escalate; badges count correctly |
| 6.3 | Leads and urgent calls | Created from chat; status changes save |
| 6.4 | Inbox settings and analytics | Settings save; charts load for any period |

## 7. Financial System (finance roles)

| # | Function | Expected |
| --- | --- | --- |
| 7.1 | Today and Data health | Counts match the pages they link to; no unbalanced entries |
| 7.2 | Outstanding and collect | Balance matches the bill; collecting records the payment once |
| 7.3 | Reservation collection | Down payments listed; confirm moves them out |
| 7.4 | Door collections, insurance deposits, refunds | Each action posts to the right treasury |
| 7.5 | Payments calendar and fixed charges | Paid items post on their date |
| 7.6 | Vendors and bills | Approve books the cost; Pay asks Paid from; payment run posts all |
| 7.7 | Petty cash | Drawer balances match entries |
| 7.8 | Owners | Withdrawal queue: approve, reject with reason, pay with treasury and reference; owner notified |
| 7.9 | Chart of accounts, journal, manual entries | Entries balance; account drill-down lists every line |
| 7.10 | Bank and cards reconciliation | Statement snapshot saved; matched lines ticked |
| 7.11 | Close month | Checklist; closing freezes the month; later edits show as a correction in the open month |
| 7.12 | Statements and report builder | Trial balance agrees; balance sheet balances; every report exports |
| 7.13 | Tax desk | VAT and WHT match the journal |

## 8. Operations

| # | Function | Expected |
| --- | --- | --- |
| 8.1 | Check-ins today | Assign agent (reason when reassigning); collect at the door (cash goes to the drawer); custom bill (CEO applies, others need review); ID photos; handover |
| 8.2 | Change dates / cancel at the door | Calendar and money update |
| 8.3 | Checkouts | Assign; inspect; refund insurance in full or with damage photos; share damage with owner |
| 8.4 | Cleaning today | Tasks created the day before arrival; assign, start, cleaned with checklist; unit becomes available |
| 8.5 | Cleans history and unit cleans | Counts per unit and per cleaner |
| 8.6 | Check-in comments and history | Comments saved; supervisor marks reviewed |
| 8.7 | New unit inspections | Inspection with photos; shared to owner portal |
| 8.8 | Damage reports | List matches insurance deductions |
| 8.9 | Attendance and performance (ops team) | Selfie attendance and figures per agent |

## 9. HR

| # | Function | Expected |
| --- | --- | --- |
| 9.1 | User management | New user gets a role Staff ID (e.g. RS-4827); CEO none; role change keeps the number; deactivate blocks sign-in |
| 9.2 | Clock in (phone) | Inside the area: clock in; outside: refused; leaving the area clocks out; 19:00 clocks out; after 19:00 refused |
| 9.3 | Attendance import (door machine) | Door numbers match the right person |
| 9.4 | Requests | Excuse (2 per month, any length), leave, WFH, loan: request, manager and HR approval |
| 9.5 | Early leave | Leaving before 19:00 without an excuse adds a "Left early" deduction; an excuse removes it |
| 9.6 | Deductions / bonus, HR rules, holidays access | Saved and reflected in payroll |
| 9.7 | Payroll and payslip | Totals match attendance, deductions and bonuses; staff see only their own payslip |
| 9.8 | Job offers | Created and tracked |

## 10. Owner portal (demo owner)

| # | Function | Expected |
| --- | --- | --- |
| 10.1 | Dashboard | Available balance, upcoming, chart, next stays without guest names |
| 10.2 | Payouts | Save account; request up to the available amount; cancel; receipt after payment |
| 10.3 | Block dates | Preview and apply; shows on the schedule |
| 10.4 | Statement, reservations, inspections, comments | Load for any period; comment reaches the team |

## 11. Sales portal `/sales`

| # | Function | Expected |
| --- | --- | --- |
| 11.1 | Sign in, listings, leads, notifications | Load and save |

## 12. Roles and permissions

For each role, sign in and confirm the sidebar shows only that role's pages, the server refuses the rest (open their links directly: expect "no access"), and read-only pages have no save buttons.

Roles: CEO, Reservations, Reservations Manager, Unit Acquisition Agent / Manager, Operations, Operations Manager, Housekeeping, Housekeeping Supervisor, Resale, Resale Manager, Finance, Financial Manager, HR, HR Manager, Owner Experience, Marketing and PR, Web Developer, Owner.

## 13. Non-functional

| # | Check | Expected |
| --- | --- | --- |
| 13.1 | Phone width (390 px) | No sideways scrolling; buttons reachable |
| 13.2 | Arabic | Every guest page and the Financial System right-to-left, no missing translations |
| 13.3 | Speed | Home page usable in under 3 s on 4G |
| 13.4 | Session | Signing out ends access; expired token sends to sign-in |
| 13.5 | Backups | Database restore tested once a quarter |
