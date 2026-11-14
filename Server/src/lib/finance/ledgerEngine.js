const { query } = require('../../config/db');
const { FINANCE_BOOKS_START: FINANCIAL_EPOCH } = require('../financialEpoch');
const { calcReservationFinancials, reservationUtilitiesAmount, round2 } = require('../commission');
const { isWebsiteOriginReservation } = require('../reservationScope');
const { reservationBill } = require('../reservationBill');
const {
  CHART_OF_ACCOUNTS,
  EXPENSE_CATEGORY_TO_ACCOUNT,
  TREASURY_CODES,
  treasuryCodes,
  isTreasuryCode,
  INPUT_VAT_CATEGORIES,
  WHT_SKIP_CATEGORIES,
  getAccount,
  accountsByGroup,
  signedBalance,
} = require('./chartOfAccounts');
const { refreshCustomAccounts } = require('./customAccounts');
const { refreshBooksReset, booksResetAt, afterReset } = require('./booksReset');
const { bookingSplit, withholdingTax, extractInputVat } = require('./taxEngine');
const { reservationPeriodSql, currentPeriodBasis, STAY } = require('./periodBasis');

/** Cairo calendar day of the books restart ('' when the books were never restarted). */
function resetDay() {
  const reset = booksResetAt();
  if (!reset) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(reset));
}

/**
 * Which reservations the books read after a restart. On the stay basis a stay booked before the restart
 * but staying after it still belongs to the new books: its revenue is earned after the restart.
 */
function reservationResetFilter(alias) {
  const reset = booksResetAt();
  if (!reset) return '';
  if (currentPeriodBasis() !== STAY) return afterReset(`${alias}.created_at`);
  return ` AND (${alias}.created_at >= '${reset}'::timestamptz OR ${alias}.check_in >= '${resetDay()}'::date)`;
}

function isoDate(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const matched = value.match(/(\d{4}-\d{2}-\d{2})/);
    if (matched) return matched[1];
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const matched = String(value).match(/(\d{4}-\d{2}-\d{2})/);
  return matched ? matched[1] : '';
}

/** Financial period date for a reservation (check-in or created date, per the active period basis). */
function reservationBookedDate(r) {
  return isoDate(r?.period_date) || isoDate(r?.created_at) || isoDate(r?.check_in);
}

function inRange(date, from, to) {
  const d = isoDate(date);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function accountLabel(code) {
  return getAccount(code)?.name || code;
}

function journalLine(account, debit, credit, memo) {
  return {
    account,
    account_name: accountLabel(account),
    debit: round2(debit),
    credit: round2(credit),
    memo: memo || '',
  };
}

function bankTreasury(bankAccount) {
  return String(bankAccount || '').toLowerCase() === 'cib' ? '102000' : '101000';
}

/** Bank methods land in ADIB or CIB; cash lands in Cash EGP, or Cash USD for USD reservations. */
function treasuryAccountForMethod(method, { bankAccount, currency } = {}) {
  const m = String(method || '').toLowerCase();
  if (m === 'instapay' || m === 'bank_transfer') return bankTreasury(bankAccount);
  if (m === 'credit_card' || m === 'online' || m === 'paymob_card') return '106000';
  return String(currency || '').toUpperCase() === 'USD' ? '104000' : '103000';
}

function reservationUsdRate(r) {
  if (String(r?.currency || '').toUpperCase() !== 'USD') return 0;
  const rate = parseFloat(r?.exchange_rate);
  return rate > 0 ? rate : 0;
}

/** Cash USD lines also carry the dollar amount (EGP book amount ÷ the reservation's rate). */
function withUsd(line, egpAmount, reservation) {
  const rate = reservationUsdRate(reservation);
  if (line.account === '104000' && rate > 0) line.usd = round2(egpAmount / rate);
  return line;
}

function isGatewayMethod(method) {
  const m = String(method || '').toLowerCase();
  return m === 'credit_card' || m === 'online' || m === 'paymob_card';
}

function paymentCollected(p) {
  const status = String(p.status || 'successful').toLowerCase();
  if (['failed', 'cancelled'].includes(status)) return false;
  if (status === 'pending' && Number(p.is_approved) !== 1) return false;
  return (parseFloat(p.amount) || 0) !== 0;
}

/** Business date of a payment: the date it was paid, not the moment it was typed in. */
function paymentBusinessDate(p) {
  return isoDate(p?.payment_date) || isoDate(p?.created_at) || isoDate(p?.paid_at);
}

function isCancelledStay(r) {
  return String(r?.status || '').toLowerCase() === 'cancelled';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthsInRange(from, to) {
  const start = from || new Date().toISOString().slice(0, 10);
  const end = to || new Date().toISOString().slice(0, 10);
  const out = [];
  const d = new Date(`${start.slice(0, 7)}-01T00:00:00`);
  const last = new Date(`${end.slice(0, 7)}-01T00:00:00`);
  while (d <= last) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    out.push(`${y}-${m}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

function lastDayOfMonth(yearMonth) {
  const [y, m] = String(yearMonth).split('-').map(Number);
  return isoDate(new Date(y, m, 0));
}

function makeEntry({ id, date, type, description, lines, meta }) {
  const clean = (lines || []).filter((l) => (l.debit || 0) > 0.0001 || (l.credit || 0) > 0.0001);
  const debit = round2(clean.reduce((s, l) => s + (l.debit || 0), 0));
  const credit = round2(clean.reduce((s, l) => s + (l.credit || 0), 0));
  return {
    id,
    date: isoDate(date),
    type,
    reference: id,
    description,
    lines: clean,
    debit,
    credit,
    balanced: Math.abs(debit - credit) < 0.02,
    meta: meta || {},
  };
}

function reservationFinancials(r) {
  const utilitiesAmount = reservationUtilitiesAmount(r, r.utilities_cost);
  const fin = calcReservationFinancials(r, { ...r, utilities_amount: utilitiesAmount });
  return { fin, split: bookingSplit(fin, r) };
}

function guestQuotedTotal(r, split) {
  return round2(parseFloat(r.total_amount) || split.gross_booking || 0);
}

function stayExtras(r, fin) {
  const insurance = round2(parseFloat(r.insurance) || 0);
  const utilities = round2(fin.utilitiesDeduction || 0);
  const broker = round2(fin.brokerDeduction || 0);
  const tenant = round2(fin.tenantDeduction || 0);
  const beach = round2(parseFloat(r.beach_access_fees) || 0);
  const cleaning = round2(fin.housekeepingFees || 0);
  const agentPct = parseFloat(r.agent_commission_pct) || 0;
  const agent = agentPct > 0 ? round2((fin.companyCommission || 0) * (agentPct / 100)) : 0;
  return { insurance, utilities, broker, tenant, beach, cleaning, agent };
}

function addCredit(lines, account, amount, memo) {
  const amt = round2(amount);
  if (amt > 0.009) lines.push(journalLine(account, 0, amt, memo));
  return amt > 0.009 ? amt : 0;
}

/**
 * Split a stay from the commission engine, not from leftover guest total.
 * Accommodation → owner / commission / broker / tenant.
 * Amounts already inside total_amount (website quotes) are taken from the remainder.
 * Housekeeping / insurance / utilities / beach billed on top of total_amount
 * increase AR instead of debiting miscellaneous revenue.
 */
function allocateStayCredits(r, fin, split) {
  const extras = stayExtras(r, fin);
  const guestTotal = guestQuotedTotal(r, split);
  const commission = round2(split.soul_commission || 0);
  let owner = round2(split.owner_trust_credit || 0);
  const lines = [];

  let rem = round2(guestTotal - extras.broker - owner - commission - extras.tenant);
  if (rem < -0.009) {
    owner = round2(Math.max(0, owner + rem));
    rem = 0;
  }

  addCredit(lines, '208000', extras.broker, 'Broker payable');
  addCredit(lines, '404000', owner, 'Accommodation (owner slice of nightly × nights)');
  addCredit(lines, '401000', commission, 'Company share of nightly × nights');
  addCredit(lines, '403000', extras.tenant, 'Tenant markup');

  const consume = (amount, account, memo) => {
    const want = round2(amount);
    if (!(want > 0.009)) return 0;
    if (rem > 0.009) {
      const take = round2(Math.min(want, rem));
      addCredit(lines, account, take, memo);
      rem = round2(rem - take);
      return round2(want - take);
    }
    return want;
  };

  const unbilledCleaning = consume(extras.cleaning, '402000', 'Cleaning & turnover');
  const unbilledInsurance = consume(extras.insurance, '204000', 'Guest insurance escrow (refundable)');
  consume(extras.utilities, '110000', 'Guest utilities (owner recoverable)');
  const unbilledBeach = consume(extras.beach, '409000', 'Beach access fees');

  const serviceFee = rem > 0.009 ? rem : 0;
  addCredit(lines, '403000', serviceFee, 'Guest service fee / markup');
  rem = 0;

  // The optional 15% service on a manual stay is its own line, billed on top of the stay total.
  const billedService = round2(parseFloat(r.service_fees) || 0);
  const extraAr = round2(
    addCredit(lines, '402000', unbilledCleaning, 'Cleaning billed in addition to stay total') +
      addCredit(lines, '204000', unbilledInsurance, 'Insurance billed in addition to stay total') +
      addCredit(lines, '409000', unbilledBeach, 'Beach access billed in addition to stay total') +
      addCredit(lines, '403000', billedService, 'Service charge billed in addition to stay total')
  );

  const vat = split.vat_on_commission || 0;
  const stayInvoice = round2(guestTotal + extraAr);
  const ar = round2(stayInvoice + vat);
  const dueOwner = round2(split.owner_trust_credit || fin.ownerNet || 0);
  if (dueOwner > 0.009) {
    lines.push(journalLine('506000', dueOwner, 0, 'Owner share expense (unit % of nightly rate × nights)'));
    lines.push(journalLine('202000', 0, dueOwner, 'Amount the company must pay the owner'));
  }
  const debitLines = [journalLine('105000', stayInvoice, 0, extraAr > 0.009 ? 'Guest invoice (stay + billed extras)' : 'Guest invoice / receivable')];
  if (vat > 0.009) {
    debitLines.push(journalLine('105000', vat, 0, 'Output VAT 14% on commission + cleaning'));
    addCredit(lines, '205000', vat, 'Output VAT 14% on commission + cleaning');
  }

  return {
    lines: [...debitLines, ...lines],
    extras,
    guestTotal,
    extraAr,
    stayInvoice,
    ar,
    vat,
    serviceFee: round2(serviceFee + billedService),
    owner: dueOwner,
    commission,
  };
}

function shouldRecognizeStay(r, asOf) {
  if (isCancelledStay(r)) return false;
  const booked = reservationBookedDate(r);
  if (!booked) return false;
  return booked <= (asOf || todayIso());
}

function bookingEntry(r, asOf) {
  const { fin, split } = reservationFinancials(r);
  const posted = allocateStayCredits(r, fin, split);
  const checkIn = isoDate(r.check_in);
  const booked = reservationBookedDate(r);
  const paid = round2(parseFloat(r.amount_paid) || 0);
  const outstanding = round2(Math.max(0, posted.guestTotal - paid));

  return makeEntry({
    id: `BK-${r.id}`,
    date: booked || r.check_in,
    type: 'booking',
    description: `${r.guest_name || 'Guest'} — ${r.unit_name || 'Unit'}`,
    lines: posted.lines,
    meta: {
      reservation_id: r.id,
      guest_name: r.guest_name,
      unit_name: r.unit_name,
      project: r.project,
      unit_id: r.unit_id,
      created_at: isoDate(r.created_at) || booked,
      check_in: checkIn,
      check_out: isoDate(r.check_out),
      nights: r.nights,
      payment_method: r.payment_method,
      payment_status: r.payment_status,
      stay_invoice: posted.stayInvoice,
      total_amount: parseFloat(r.total_amount) || 0,
      guest_total: posted.guestTotal,
      invoice_amount: posted.ar,
      amount_paid: paid,
      outstanding,
      vat: posted.vat,
      recognized: shouldRecognizeStay(r, asOf),
      from_website: isWebsiteOriginReservation(r),
      sales_person: r.sales_person_name,
      owner_share: posted.owner,
      commission: posted.commission,
      cleaning: posted.extras.cleaning,
      insurance: posted.extras.insurance,
      utilities: posted.extras.utilities,
      broker: posted.extras.broker,
      tenant_markup: posted.extras.tenant,
      service_fee: posted.serviceFee,
      beach: posted.extras.beach,
      agent_commission: posted.extras.agent,
      channel: isWebsiteOriginReservation(r) ? 'Website' : 'Manual',
    },
  });
}

function agentAccrualEntry(r, asOf) {
  const { fin } = reservationFinancials(r);
  const extras = stayExtras(r, fin);
  if (!(extras.agent > 0.009) || !shouldRecognizeStay(r, asOf)) return null;
  return makeEntry({
    id: `AG-${r.id}`,
    date: reservationBookedDate(r) || r.check_in,
    type: 'agent_commission',
    description: `Sales agent commission — ${r.sales_person_name || 'Agent'}`,
    lines: [
      journalLine('609000', extras.agent, 0, 'Sales agent commission expense'),
      journalLine('209000', 0, extras.agent, 'Commission payable'),
    ],
    meta: {
      reservation_id: r.id,
      sales_person: r.sales_person_name,
      from_account: '209000',
      to_account: '609000',
    },
  });
}

const INSURANCE_REFUND_TRACKING_START = '2026-08-24';

function insuranceRefundSettled(r) {
  const status = String(r?.insurance_refund_status || '').toLowerCase();
  if (['refunded', 'partial', 'forfeited'].includes(status)) return true;
  const held = round2(parseFloat(r?.insurance) || 0);
  const checkOut = isoDate(r?.check_out);
  // Ops already returned insurance before tracking started
  return held > 0.009 && checkOut && checkOut < INSURANCE_REFUND_TRACKING_START;
}

/** Release 204000 at checkout: cash back to guest + optional damage retained as 410000. */
function insuranceRefundEntry(r) {
  if (!insuranceRefundSettled(r)) return null;
  const held = round2(parseFloat(r.insurance) || 0);
  if (!(held > 0.009)) return null;

  const status = String(r?.insurance_refund_status || '').toLowerCase();
  const checkOut = isoDate(r.check_out);
  const inferredHistorical =
    !['refunded', 'partial', 'forfeited'].includes(status) &&
    checkOut &&
    checkOut < INSURANCE_REFUND_TRACKING_START;

  const refunded = round2(parseFloat(r.insurance_refunded_amount) || 0);
  const damage = round2(parseFloat(r.insurance_damage_amount) || 0);
  const method = inferredHistorical
    ? 'historical'
    : r.insurance_refund_method || 'cash';
  const treasury =
    r.insurance_refund_treasury_code ||
    treasuryAccountForMethod(method, {
      bankAccount: r.insurance_refund_bank_account || r.bank_account,
      currency: r.currency,
    });
  const date = isoDate(r.insurance_refunded_at) || checkOut || todayIso();
  const historical = String(method).toLowerCase() === 'historical';
  const checkIn = isoDate(r.check_in);

  // Pre-tracking settlements: clear escrow only when the stay was recognized on the books.
  if (historical && (!checkIn || checkIn < FINANCIAL_EPOCH)) return null;

  const lines = [journalLine('204000', held, 0, 'Release guest insurance escrow')];
  if (historical) {
    lines.push(journalLine('302000', 0, held, 'Historical insurance settlement (pre-tracking)'));
  } else {
    if (refunded > 0.009) {
      lines.push(withUsd(journalLine(treasury, 0, refunded, `Insurance refund to guest (${method})`), refunded, r));
    }
    if (damage > 0.009) {
      lines.push(journalLine('410000', 0, damage, 'Damage retained from insurance'));
    }

    const posted = round2(refunded + damage);
    if (Math.abs(posted - held) > 0.05) {
      const gap = round2(held - posted);
      if (gap > 0.009) {
        lines.push(journalLine('410000', 0, gap, 'Insurance escrow residual (auto)'));
      }
    }
  }

  return makeEntry({
    id: `INS-${r.id}`,
    date,
    type: 'insurance_refund',
    description: `Insurance refund — ${r.guest_name || 'Guest'} · ${r.unit_name || 'Unit'}`,
    lines,
    meta: {
      reservation_id: r.id,
      guest_name: r.guest_name,
      unit_name: r.unit_name,
      check_out: checkOut,
      insurance: held,
      refunded_amount: historical ? held : refunded,
      damage_amount: historical ? 0 : damage,
      payment_method: method,
      status: historical ? 'refunded' : r.insurance_refund_status,
      historical,
      from_account: '204000',
      to_account: historical ? '302000' : refunded > 0.009 ? treasury : '410000',
    },
  });
}

function collectionEntry(p, reservation) {
  const amt = round2(parseFloat(p.amount) || 0);
  const method = p.payment_method || reservation?.payment_method || 'cash';
  const treasury =
    p.treasury_account_code ||
    treasuryAccountForMethod(method, {
      bankAccount: p.bank_account || reservation?.bank_account,
      currency: reservation?.currency,
    });
  const checkIn = isoDate(reservation?.check_in);
  const payDate = paymentBusinessDate(p);
  const cancelled = isCancelledStay(reservation);
  const unearned = !cancelled && checkIn && payDate && payDate < checkIn;
  const refund = amt < 0;
  const abs = round2(Math.abs(amt));
  // A stay the new books never opened (booked and started before a restart): its balance was outside the
  // opening figures, so collecting or refunding it corrects opening equity.
  const creditAccount = reservation?.legacy_outside
    ? '302000'
    : unearned || (cancelled && payDate && checkIn && payDate < checkIn) ? '203000' : '105000';

  if (refund) {
    return makeEntry({
      id: p.synthetic ? `PAYX-${p.reservation_id}` : `PAY-${p.id}`,
      date: payDate,
      type: 'refund',
      description: `Refund ${method} — ${reservation?.guest_name || 'Guest'}`,
      lines: [
        journalLine(creditAccount, abs, 0, unearned ? 'Return advance deposit' : 'Reverse guest receivable'),
        withUsd(journalLine(treasury, 0, abs, `Treasury out (${method})`), abs, reservation),
      ],
      meta: {
        reservation_id: p.reservation_id,
        payment_id: p.synthetic ? null : p.id,
        guest_name: reservation?.guest_name,
        unit_name: reservation?.unit_name,
        payment_method: method,
        treasury_account: treasury,
        from_account: treasury,
        to_account: creditAccount,
        collected: false,
        refund: true,
      },
    });
  }

  return makeEntry({
    id: p.synthetic ? `PAYX-${p.reservation_id}` : `PAY-${p.id}`,
    date: payDate,
    type: 'collection',
    description: `Collected ${method} — ${reservation?.guest_name || 'Guest'}`,
    lines: [
      withUsd(journalLine(treasury, abs, 0, `Treasury in (${method})`), abs, reservation),
      journalLine(creditAccount, 0, abs, unearned ? 'Advance deposit (unearned)' : 'Settle guest receivable'),
    ],
    meta: {
      reservation_id: p.reservation_id,
      payment_id: p.synthetic ? null : p.id,
      guest_name: reservation?.guest_name,
      unit_name: reservation?.unit_name,
      payment_method: method,
      treasury_account: treasury,
      treasury_name: accountLabel(treasury),
      from_account: creditAccount,
      to_account: treasury,
      collected: true,
      synthetic: Boolean(p.synthetic),
      unearned: Boolean(unearned),
      reference_number: p.reference_number || p.transaction_reference || null,
    },
  });
}

function depositReclassEntry(r, prepaid, asOf) {
  const amt = round2(prepaid);
  if (!(amt > 0.009) || !shouldRecognizeStay(r, asOf)) return null;
  return makeEntry({
    id: `DEP-${r.id}`,
    date: r.check_in,
    type: 'deposit_reclass',
    description: `Apply deposit — ${r.guest_name || 'Guest'}`,
    lines: [
      journalLine('203000', amt, 0, 'Clear unearned deposit'),
      journalLine('105000', 0, amt, 'Apply to guest receivable'),
    ],
    meta: {
      reservation_id: r.id,
      guest_name: r.guest_name,
      from_account: '203000',
      to_account: '105000',
    },
  });
}

function cancelForfeitEntry(r, prepaid) {
  const amt = round2(prepaid);
  if (!(amt > 0.009) || !isCancelledStay(r)) return null;
  const date = isoDate(r.updated_at || r.cancelled_at || r.check_in);
  return makeEntry({
    id: `CXL-${r.id}`,
    date,
    type: 'cancellation',
    description: `Forfeit deposit — ${r.guest_name || 'Guest'}`,
    lines: [
      journalLine('203000', amt, 0, 'Release unearned deposit'),
      journalLine('409000', 0, amt, 'Cancelled stay forfeiture'),
    ],
    meta: {
      reservation_id: r.id,
      guest_name: r.guest_name,
      from_account: '203000',
      to_account: '409000',
    },
  });
}

function gatewaySettleEntry(collection, mdrPct) {
  const gross = round2(collection.debit || 0);
  if (!(gross > 0.009)) return null;
  const mdr = round2(gross * ((Number(mdrPct) || 0) / 100));
  const net = round2(gross - mdr);
  return makeEntry({
    id: `GW-${collection.id}`,
    date: collection.date,
    type: 'gateway_settle',
    description: `Settle gateway — ${collection.description}`,
    lines: [
      journalLine('101000', net, 0, 'Bank ADIB after MDR'),
      ...(mdr > 0.009 ? [journalLine('504000', mdr, 0, `Merchant discount ${mdrPct}%`)] : []),
      journalLine('106000', 0, gross, 'Clear Paymob / card clearing'),
    ],
    meta: {
      payment_id: collection.meta?.payment_id,
      reservation_id: collection.meta?.reservation_id,
      mdr_pct: mdrPct,
      mdr_amount: mdr,
      gross,
      net,
      from_account: '106000',
      to_account: '101000',
    },
  });
}

function expenseEntries(e) {
  const amt = round2(parseFloat(e.amount) || 0);
  if (!(amt > 0.009)) return [];
  const acct = EXPENSE_CATEGORY_TO_ACCOUNT[e.category] || '605000';
  const companyPaid = String(e.paid_by || 'company') !== 'owner';
  const taxed = String(e.tax_mode || 'auto') !== 'none';
  const inputVat = companyPaid && taxed && INPUT_VAT_CATEGORIES.includes(e.category) ? extractInputVat(amt) : null;
  const expenseNet = inputVat ? inputVat.net : amt;
  const vatAmt = inputVat ? inputVat.vat : 0;
  const skipWht = WHT_SKIP_CATEGORIES.includes(e.category);
  const wht = companyPaid && taxed && !skipWht
    ? withholdingTax(expenseNet, { ratePct: e.category === 'professional' ? 1 : 3 })
    : { wht_amount: 0 };
  const payTreasury = String(e.paid_from_account || '').trim() || '101000';
  const vendorNet = round2(amt - (wht.wht_amount || 0));
  const periodDate = isoDate(e.expense_date) || isoDate(e.created_at);

  if (!companyPaid) {
    // Charged to the owner; when the company paid it from a drawer or bank, that account is credited.
    const ownerPaidFrom = String(e.paid_from_account || '').trim();
    return [
      makeEntry({
        id: `EXP-${e.id}`,
        date: periodDate,
        type: 'expense',
        description: e.description || 'Owner-charged expense',
        lines: [
          journalLine('202000', amt, 0, 'Charge against owner trust'),
          ownerPaidFrom
            ? journalLine(ownerPaidFrom, 0, amt, `Paid from ${accountLabel(ownerPaidFrom)}`)
            : journalLine('201000', 0, amt, 'Vendor payable (owner bill)'),
        ],
        meta: { expense_id: e.id, category: e.category, paid_by: e.paid_by, unit_id: e.unit_id },
      }),
    ];
  }

  const accrueLines = [
    journalLine(acct, expenseNet, 0, e.category || 'expense'),
    ...(vatAmt > 0.009 ? [journalLine('107000', vatAmt, 0, 'Input VAT 14/114')] : []),
    journalLine('201000', 0, amt, 'Vendor bill accrued'),
  ];
  const payLines = [
    journalLine('201000', amt, 0, 'Settle vendor bill'),
    journalLine(payTreasury, 0, vendorNet, `Paid from ${accountLabel(payTreasury)}`),
    ...(wht.wht_amount > 0.009 ? [journalLine('206000', 0, wht.wht_amount, 'WHT withheld')] : []),
  ];

  return [
    makeEntry({
      id: `EXP-${e.id}-ACC`,
      date: periodDate,
      type: 'expense_accrual',
      description: e.description || 'Expense accrued',
      lines: accrueLines,
      meta: { expense_id: e.id, category: e.category, paid_by: e.paid_by, unit_id: e.unit_id, input_vat: vatAmt },
    }),
    makeEntry({
      id: `EXP-${e.id}-PAY`,
      date: periodDate,
      type: 'expense_payment',
      description: `${e.description || 'Expense'} — paid`,
      lines: payLines,
      meta: {
        expense_id: e.id,
        category: e.category,
        from_account: payTreasury,
        to_account: '201000',
        wht: wht.wht_amount || 0,
      },
    }),
  ];
}

function recurringEntries(rec, month, from, to) {
  if (!rec.is_active || !(Number(rec.amount_egp) > 0)) return [];
  const day = String(rec.day_of_month || 1).padStart(2, '0');
  const date = `${month}-${day}`;
  if (!inRange(date, from, to)) return [];
  const amt = round2(Number(rec.amount_egp) || 0);
  const vatKinds = rec.kind === 'rent' || rec.kind === 'utilities';
  const inputVat = vatKinds ? extractInputVat(amt) : { net: amt, vat: 0 };
  const expenseNet = inputVat.net;
  const vatAmt = inputVat.vat;

  return [
    makeEntry({
      id: `REC-${rec.kind}-${month}-ACC`,
      date,
      type: 'recurring_accrual',
      description: `Accrue monthly ${rec.label}`,
      lines: [
        journalLine(rec.account_code, expenseNet, 0, rec.label),
        ...(vatAmt > 0.009 ? [journalLine('107000', vatAmt, 0, 'Input VAT 14/114')] : []),
        journalLine('201000', 0, amt, 'Vendor / landlord payable'),
      ],
      meta: { recurring_kind: rec.kind, month, automatic: true, input_vat: vatAmt },
    }),
    makeEntry({
      id: `REC-${rec.kind}-${month}-PAY`,
      date,
      type: 'recurring_payment',
      description: `Pay monthly ${rec.label}`,
      lines: [
        journalLine('201000', amt, 0, 'Settle monthly charge'),
        journalLine('101000', 0, amt, 'Paid from bank (ADIB)'),
      ],
      meta: {
        recurring_kind: rec.kind,
        month,
        from_account: '101000',
        to_account: '201000',
        automatic: true,
      },
    }),
  ];
}

function closeMonthEntry(yearMonth, monthJournal) {
  const map = {};
  for (const entry of monthJournal) {
    if (String(entry.type) === 'period_close') continue;
    for (const line of entry.lines) {
      if (!map[line.account]) map[line.account] = { debit: 0, credit: 0 };
      map[line.account].debit += line.debit || 0;
      map[line.account].credit += line.credit || 0;
    }
  }
  const lines = [];
  let revenue = 0;
  let expense = 0;
  for (const acct of CHART_OF_ACCOUNTS) {
    const raw = map[acct.code] || { debit: 0, credit: 0 };
    const bal = round2(signedBalance(acct.type, raw.debit, raw.credit, acct.contra));
    if (acct.type === 'revenue' && Math.abs(bal) > 0.009) {
      lines.push(journalLine(acct.code, bal, 0, `Close ${acct.name}`));
      revenue += bal;
    } else if (acct.type === 'expense' && Math.abs(bal) > 0.009) {
      lines.push(journalLine(acct.code, 0, bal, `Close ${acct.name}`));
      expense += bal;
    }
  }
  const pnl = round2(revenue - expense);
  if (pnl >= 0) lines.push(journalLine('302000', 0, pnl, 'Transfer profit to retained earnings'));
  else lines.push(journalLine('302000', Math.abs(pnl), 0, 'Transfer loss to retained earnings'));

  return makeEntry({
    id: `CLOSE-${yearMonth}`,
    date: lastDayOfMonth(yearMonth),
    type: 'period_close',
    description: `Close books ${yearMonth}`,
    lines,
    meta: { year_month: yearMonth, pnl, revenue: round2(revenue), expense: round2(expense) },
  });
}

/** Nights of a stay per calendar month, e.g. { '2026-11': 2, '2026-12': 3 }. */
function nightsByMonth(checkIn, checkOut) {
  const out = {};
  const start = isoDate(checkIn);
  const end = isoDate(checkOut);
  if (!start || !end || end <= start) return out;
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  let guard = 0;
  while (d < last && guard < 400) {
    const ym = d.toISOString().slice(0, 7);
    out[ym] = (out[ym] || 0) + 1;
    d.setUTCDate(d.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

const DEFERRABLE_REVENUE = ['401000', '403000', '404000'];

/**
 * Revenue is earned night by night (IFRS 15, over time). A stay that crosses a month end
 * moves the share of nights in later months to deferred revenue at check-in, then releases
 * it on the 1st of each later month. The owner share expense follows the same nights.
 */
function stayRecognitionEntries(r, asOf) {
  if (currentPeriodBasis() !== STAY || isCancelledStay(r)) return [];
  const checkIn = isoDate(r.check_in);
  if (!checkIn || reservationBookedDate(r) !== checkIn || !shouldRecognizeStay(r, asOf)) return [];
  const byMonth = nightsByMonth(r.check_in, r.check_out);
  const months = Object.keys(byMonth).sort();
  if (months.length < 2) return [];
  const totalNights = months.reduce((s, m) => s + byMonth[m], 0);
  const { fin, split } = reservationFinancials(r);
  const posted = allocateStayCredits(r, fin, split);
  const revenue = {};
  let ownerShare = 0;
  for (const line of posted.lines) {
    if (DEFERRABLE_REVENUE.includes(line.account)) revenue[line.account] = round2((revenue[line.account] || 0) + (line.credit || 0));
    if (line.account === '506000') ownerShare = round2(ownerShare + (line.debit || 0));
  }
  const later = months.slice(1);
  const laterNights = later.reduce((s, m) => s + byMonth[m], 0);
  const portion = (amount, nights) => round2((amount * nights) / totalNights);
  const guest = r.guest_name || 'Guest';
  const unit = r.unit_name || 'Unit';
  const meta = { reservation_id: r.id, guest_name: r.guest_name, unit_name: r.unit_name, nights: totalNights };

  const deferLines = [];
  let deferredRevenue = 0;
  for (const [acct, amt] of Object.entries(revenue)) {
    const part = portion(amt, laterNights);
    if (part > 0.009) {
      deferLines.push(journalLine(acct, part, 0, `Nights after ${checkIn.slice(0, 7)} not yet earned`));
      deferredRevenue = round2(deferredRevenue + part);
    }
  }
  if (deferredRevenue > 0.009) deferLines.push(journalLine('210000', 0, deferredRevenue, 'Deferred stay revenue'));
  const deferredOwner = portion(ownerShare, laterNights);
  if (deferredOwner > 0.009) {
    deferLines.push(journalLine('111000', deferredOwner, 0, 'Owner share of nights not yet stayed'));
    deferLines.push(journalLine('506000', 0, deferredOwner, 'Owner share follows the nights'));
  }
  if (!deferLines.length) return [];
  const entries = [
    makeEntry({
      id: `DEF-${r.id}`,
      date: checkIn,
      type: 'revenue_deferral',
      description: `Defer later nights — ${guest} · ${unit}`,
      lines: deferLines,
      meta: { ...meta, deferred_nights: laterNights, from_account: '210000', to_account: '401000' },
    }),
  ];

  // Release month by month; the last month takes the rounding remainder.
  const left = { ...revenue };
  for (const acct of Object.keys(left)) left[acct] = portion(revenue[acct], laterNights);
  let ownerLeft = deferredOwner;
  later.forEach((month, idx) => {
    const isLast = idx === later.length - 1;
    const lines = [];
    let total = 0;
    for (const acct of Object.keys(left)) {
      const part = isLast ? left[acct] : Math.min(left[acct], portion(revenue[acct], byMonth[month]));
      if (part > 0.009) {
        lines.push(journalLine(acct, 0, part, `${byMonth[month]} night(s) earned in ${month}`));
        left[acct] = round2(left[acct] - part);
        total = round2(total + part);
      }
    }
    if (total > 0.009) lines.unshift(journalLine('210000', total, 0, 'Release deferred stay revenue'));
    const ownerPart = isLast ? ownerLeft : Math.min(ownerLeft, portion(ownerShare, byMonth[month]));
    if (ownerPart > 0.009) {
      lines.push(journalLine('506000', ownerPart, 0, `Owner share of ${byMonth[month]} night(s)`));
      lines.push(journalLine('111000', 0, ownerPart, 'Release deferred owner share'));
      ownerLeft = round2(ownerLeft - ownerPart);
    }
    if (lines.length) {
      entries.push(
        makeEntry({
          id: `REV-${r.id}-${month}`,
          date: `${month}-01`,
          type: 'revenue_recognition',
          description: `Earn ${byMonth[month]} night(s) — ${guest} · ${unit}`,
          lines,
          meta: { ...meta, month, nights_in_month: byMonth[month], from_account: '210000', to_account: '401000' },
        })
      );
    }
  });
  return entries;
}

/** Approved vendor bill: cost and payable on the invoice date; payment from the chosen treasury. */
function vendorBillEntries(vi) {
  const amt = round2(parseFloat(vi.amount) || 0);
  if (!(amt > 0.009)) return [];
  const wht = round2(parseFloat(vi.wht_amount) || 0);
  const net = round2(parseFloat(vi.net_payable) || amt - wht);
  const expenseAcct = String(vi.expense_account || '').trim() || EXPENSE_CATEGORY_TO_ACCOUNT[vi.category] || '605000';
  const vendor = vi.vendor_name || 'Vendor';
  const ref = vi.invoice_number ? ` #${vi.invoice_number}` : '';
  const meta = { vendor_invoice_id: vi.id, vendor_id: vi.vendor_id, vendor_name: vendor, invoice_number: vi.invoice_number, unit_id: vi.unit_id };
  const entries = [];
  if (!vi.expense_id) {
    entries.push(
      makeEntry({
        id: `VI-${vi.id}-ACC`,
        date: isoDate(vi.invoice_date) || isoDate(vi.approved_at),
        type: 'vendor_bill',
        description: `Vendor bill${ref} — ${vendor}`,
        lines: [
          journalLine(expenseAcct, amt, 0, vi.description || vi.category || 'Vendor bill'),
          journalLine('201000', 0, amt, 'Vendor payable'),
        ],
        meta: { ...meta, from_account: '201000', to_account: expenseAcct },
      })
    );
  }
  if (String(vi.status) === 'paid') {
    const treasury =
      String(vi.paid_from_account || '').trim() ||
      treasuryAccountForMethod(vi.payment_method || 'bank_transfer', { bankAccount: 'adib' });
    entries.push(
      makeEntry({
        id: `VI-${vi.id}-PAY`,
        date: isoDate(vi.paid_at) || isoDate(vi.updated_at),
        type: 'vendor_payment',
        description: `Pay vendor bill${ref} — ${vendor}`,
        lines: [
          journalLine('201000', amt, 0, 'Settle vendor payable'),
          journalLine(treasury, 0, net, `Paid from ${accountLabel(treasury)}`),
          ...(wht > 0.009 ? [journalLine('206000', 0, wht, 'WHT withheld')] : []),
        ],
        meta: { ...meta, from_account: treasury, to_account: '201000', wht, reference_number: vi.payment_reference || null },
      })
    );
  }
  return entries;
}

/** Approved write-off: the uncollectable part of a guest bill becomes bad-debt expense. */
function writeOffEntry(w) {
  const amt = round2(parseFloat(w.amount) || 0);
  if (!(amt > 0.009) || w.legacy_outside) return null;
  return makeEntry({
    id: `WO-${w.id}`,
    date: isoDate(w.approved_at) || isoDate(w.created_at),
    type: 'write_off',
    description: `Write-off — ${w.guest_name || 'Guest'}${w.reason ? ` (${w.reason})` : ''}`,
    lines: [
      journalLine('620000', amt, 0, 'Bad debt written off'),
      journalLine('105000', 0, amt, 'Remove uncollectable receivable'),
    ],
    meta: { write_off_id: w.id, reservation_id: w.reservation_id, guest_name: w.guest_name, from_account: '105000', to_account: '620000' },
  });
}

/** Expected credit loss (IFRS 9): the allowance is moved to each month's aging estimate. */
function provisionEntries(provisions) {
  const entries = [];
  let previous = 0;
  for (const p of [...(provisions || [])].sort((a, b) => String(a.period_month).localeCompare(String(b.period_month)))) {
    const target = round2(parseFloat(p.total_provision) || 0);
    const change = round2(target - previous);
    previous = target;
    if (Math.abs(change) < 0.01) continue;
    const up = change > 0;
    entries.push(
      makeEntry({
        id: `ECL-${p.period_month}`,
        date: lastDayOfMonth(p.period_month),
        type: 'credit_loss_provision',
        description: `Expected credit loss ${p.period_month} (allowance ${target.toLocaleString('en-US')})`,
        lines: up
          ? [journalLine('620000', change, 0, 'Increase allowance for doubtful accounts'), journalLine('105900', 0, change, 'Allowance for doubtful accounts')]
          : [journalLine('105900', -change, 0, 'Release allowance for doubtful accounts'), journalLine('620000', 0, -change, 'Lower expected credit loss')],
        meta: { period_month: p.period_month, allowance: target, from_account: '105900', to_account: '620000' },
      })
    );
  }
  return entries;
}

function prepaidAmount(r, payments) {
  const checkIn = isoDate(r.check_in);
  let fromRows = 0;
  for (const p of payments || []) {
    if (String(p.reservation_id) !== String(r.id) || !paymentCollected(p)) continue;
    const amt = parseFloat(p.amount) || 0;
    if (amt <= 0) continue;
    const payDate = paymentBusinessDate(p);
    if (checkIn && payDate && payDate < checkIn) fromRows += amt;
  }
  const claimed = round2(parseFloat(r.amount_paid) || 0);
  if (fromRows > 0.009) return round2(fromRows);
  if (isCancelledStay(r) || (checkIn && checkIn > todayIso())) return claimed;
  return 0;
}

async function loadPortalData(from, to) {
  await refreshCustomAccounts();
  await refreshBooksReset();
  const period = reservationPeriodSql('r');
  const resParams = [from];
  let resSql = `(
      ${period} >= $1::date
      OR (COALESCE(r.insurance, 0) > 0.009 AND r.check_out >= $1::date)
      OR (
        r.insurance_refund_status IN ('refunded', 'partial', 'forfeited')
        AND COALESCE(r.insurance_refunded_at::date, r.check_out) >= $1::date
      )
      OR r.id IN (
        SELECT p.reservation_id FROM payments p
        WHERE COALESCE(p.payment_date, p.created_at::date) >= $1::date
          AND p.reservation_id IS NOT NULL
      )
    )`;
  if (to) {
    resParams.push(to);
    resSql = `(
      (${period} >= $1::date AND ${period} <= $2::date)
      OR (
        COALESCE(r.insurance, 0) > 0.009
        AND r.check_out >= $1::date
        AND r.check_out <= $2::date
      )
      OR (
        r.insurance_refund_status IN ('refunded', 'partial', 'forfeited')
        AND COALESCE(r.insurance_refunded_at::date, r.check_out) >= $1::date
        AND COALESCE(r.insurance_refunded_at::date, r.check_out) <= $2::date
      )
      OR r.id IN (
        SELECT p.reservation_id FROM payments p
        WHERE COALESCE(p.payment_date, p.created_at::date) >= $1::date
          AND COALESCE(p.payment_date, p.created_at::date) <= $2::date
          AND p.reservation_id IS NOT NULL
      )
    )`;
  }

  const reset = booksResetAt();
  const preResetSql = reset ? `(r.created_at < '${reset}'::timestamptz)` : 'false';
  const { rows: reservations } = await query(
    `SELECT r.*,
            ${preResetSql} AS pre_reset,
            to_char(${period}, 'YYYY-MM-DD') AS period_date,
            to_char(r.created_at, 'YYYY-MM-DD') AS created_at,
            to_char(r.check_in, 'YYYY-MM-DD') AS check_in,
            to_char(r.check_out, 'YYYY-MM-DD') AS check_out,
            COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
            COALESCE(u.project, u.compound) AS project,
            u.commission_mode, u.company_commission_pct,
            u.company_commission_owner_pct, u.commission_tenant_pct,
            COALESCE(u.utilities_cost, 0) AS utilities_cost,
            COALESCE(sp.full_name, '—') AS sales_person_name,
            COALESCE(sp.sales_commission_pct, 0) AS agent_commission_pct
     FROM reservations r
     JOIN units u ON u.id = r.unit_id
     LEFT JOIN staff_users sp ON sp.id = r.sales_person_id
     WHERE ${resSql}${reservationResetFilter('r')}
     ORDER BY r.created_at DESC`,
    resParams
  );

  // Stays that started before the period and run into it: their later nights are earned in the period.
  let spanning = [];
  if (from && currentPeriodBasis() === STAY) {
    try {
      const { rows } = await query(
        `SELECT r.*,
                ${preResetSql} AS pre_reset,
                to_char(r.check_in, 'YYYY-MM-DD') AS period_date,
                to_char(r.created_at, 'YYYY-MM-DD') AS created_at,
                to_char(r.check_in, 'YYYY-MM-DD') AS check_in,
                to_char(r.check_out, 'YYYY-MM-DD') AS check_out,
                COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
                COALESCE(u.project, u.compound) AS project,
                u.commission_mode, u.company_commission_pct,
                u.company_commission_owner_pct, u.commission_tenant_pct,
                COALESCE(u.utilities_cost, 0) AS utilities_cost,
                COALESCE(sp.full_name, '—') AS sales_person_name,
                COALESCE(sp.sales_commission_pct, 0) AS agent_commission_pct
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         LEFT JOIN staff_users sp ON sp.id = r.sales_person_id
         WHERE r.check_in < $1::date AND r.check_out > $1::date
           AND LOWER(COALESCE(r.status::text, '')) <> 'cancelled'${reservationResetFilter('r')}`,
        [from]
      );
      const loaded = new Set(reservations.map((r) => String(r.id)));
      spanning = rows.filter((r) => !loaded.has(String(r.id)));
    } catch (_) {
      spanning = [];
    }
  }

  const totPeriod = reservationPeriodSql();
  const totParams = [from];
  let totSql = `LOWER(COALESCE(status::text, '')) <> 'cancelled' AND ${totPeriod} >= $1::date${afterReset('created_at')}`;
  if (to) {
    totParams.push(to);
    totSql += ` AND ${totPeriod} <= $2::date`;
  }
  const { rows: totalRows } = await query(
    `SELECT COALESCE(SUM(total_amount), 0)::float AS stays,
            COUNT(*)::int AS stay_count
     FROM reservations
     WHERE ${totSql}`,
    totParams
  );
  const reservationTotals = {
    stays: Number(totalRows[0]?.stays) || 0,
    stay_count: Number(totalRows[0]?.stay_count) || 0,
  };

  const payParams = [from];
  let paySql = `COALESCE(p.payment_date, p.created_at::date) >= $1::date${afterReset('p.created_at')}`;
  if (to) {
    payParams.push(to);
    paySql += ` AND COALESCE(p.payment_date, p.created_at::date) <= $${payParams.length}::date`;
  }
  const { rows: payments } = await query(
    `SELECT p.*
     FROM payments p
     WHERE ${paySql}
     ORDER BY p.created_at DESC`,
    payParams
  );

  let stayPayments = payments;
  const reservationIds = (reservations || []).map((r) => r.id).filter(Boolean);
  if (reservationIds.length) {
    try {
      const { rows: extraPays } = await query(
        `SELECT p.* FROM payments p WHERE p.reservation_id = ANY($1)${afterReset('p.created_at')}`,
        [reservationIds]
      );
      const seen = new Set(payments.map((p) => p.id));
      stayPayments = [...payments];
      for (const p of extraPays) {
        if (!seen.has(p.id)) stayPayments.push(p);
      }
    } catch (_) {
      stayPayments = payments;
    }
  }

  // Stays booked before a restart: what they had paid by then is already inside the opening treasury balances.
  if (reset) {
    const postReset = {};
    for (const p of stayPayments) {
      if (String(p.kind || '') === 'forfeit' || !paymentCollected(p)) continue;
      postReset[p.reservation_id] = round2((postReset[p.reservation_id] || 0) + (parseFloat(p.amount) || 0));
    }
    for (const r of reservations) {
      if (!r.pre_reset) continue;
      r.opening_paid = round2(Math.max(0, (parseFloat(r.amount_paid) || 0) - (postReset[r.id] || 0)));
    }
  }

  // Payments after a restart for stays the new books never opened (booked and started before it).
  let legacyStays = [];
  if (reset) {
    const known = new Set(reservations.map((r) => String(r.id)));
    const missing = [...new Set(payments.map((p) => p.reservation_id).filter((id) => id && !known.has(String(id))))];
    if (missing.length) {
      try {
        const { rows } = await query(
          `SELECT r.id, r.guest_name, r.payment_method, r.bank_account, r.currency, r.exchange_rate, r.status,
                  to_char(r.check_in, 'YYYY-MM-DD') AS check_in, COALESCE(u.unit_number, u.title, 'Unit') AS unit_name
           FROM reservations r LEFT JOIN units u ON u.id = r.unit_id
           WHERE r.id = ANY($1) AND r.created_at < $2::timestamptz`,
          [missing, reset]
        );
        legacyStays = rows.map((r) => ({ ...r, legacy_outside: true }));
      } catch (_) {
        legacyStays = [];
      }
    }
  }

  const expParams = [from];
  let expSql = `COALESCE(expense_date, created_at::date) >= $1::date${afterReset('created_at')}`;
  if (to) {
    expParams.push(to);
    expSql += ` AND COALESCE(expense_date, created_at::date) <= $${expParams.length}::date`;
  }
  const { rows: expenses } = await query(
    `SELECT * FROM expenses WHERE ${expSql} ORDER BY created_at DESC`,
    expParams
  );

  let hkOrders = [];
  try {
    const hkParams = [from];
    let hkSql = `status <> 'cancelled' AND created_at::date >= $1::date${afterReset('created_at')}`;
    if (to) {
      hkParams.push(to);
      hkSql += ` AND created_at::date <= $${hkParams.length}::date`;
    }
    const { rows } = await query(
      `SELECT * FROM housekeeping_service_orders WHERE ${hkSql} ORDER BY created_at DESC`,
      hkParams
    );
    hkOrders = rows;
  } catch (_) {
    hkOrders = [];
  }

  let petty = [];
  try {
    const pcParams = [from];
    let pcSql = `COALESCE(entry_date, created_at::date) >= $1::date AND COALESCE(status, 'open') <> 'moved'${afterReset('created_at')}`;
    if (to) {
      pcParams.push(to);
      pcSql += ` AND COALESCE(entry_date, created_at::date) <= $${pcParams.length}::date`;
    }
    const { rows } = await query(`SELECT * FROM petty_cash WHERE ${pcSql} ORDER BY created_at DESC`, pcParams);
    petty = rows;
  } catch (_) {
    petty = [];
  }

  let pettyAccounts = {};
  try {
    const { rows } = await query(`SELECT location_key, account_code FROM petty_cash_accounts WHERE account_code IS NOT NULL`);
    pettyAccounts = Object.fromEntries(rows.map((r) => [r.location_key, r.account_code]));
  } catch (_) {
    pettyAccounts = {};
  }

  let manuals = [];
  try {
    const mParams = [from];
    let mSql = `COALESCE(m.entry_date, m.created_at::date) >= $1::date`;
    if (to) {
      mParams.push(to);
      mSql += ` AND COALESCE(m.entry_date, m.created_at::date) <= $${mParams.length}::date`;
    }
    const { rows } = await query(
      `SELECT m.*, COALESCE(u.unit_number, u.title) AS unit_name, su.full_name AS created_by_name
       FROM financial_manual_entries m
       LEFT JOIN units u ON u.id = m.unit_id
       LEFT JOIN staff_users su ON su.id = m.created_by
       WHERE ${mSql}
       ORDER BY m.created_at DESC`,
      mParams
    );
    manuals = rows;
  } catch (_) {
    manuals = [];
  }

  let payouts = [];
  try {
    const { rows } = await query(
      `SELECT p.*, su.full_name AS owner_name
       FROM owner_payout_requests p
       LEFT JOIN staff_users su ON su.id = p.owner_id
       WHERE TRUE${afterReset('p.created_at')}
       ORDER BY p.created_at DESC
       LIMIT 300`
    );
    payouts = rows;
  } catch (_) {
    payouts = [];
  }

  const sinceDate = from || '1900-01-01';
  let vendorBills = [];
  try {
    const { rows } = await query(
      `SELECT vi.*, v.name AS vendor_name
       FROM vendor_invoices vi LEFT JOIN vendors v ON v.id = vi.vendor_id
       WHERE vi.status IN ('approved', 'paid')${afterReset('vi.created_at')}
         AND (vi.invoice_date >= $1::date OR vi.paid_at::date >= $1::date)`,
      [sinceDate]
    );
    vendorBills = rows;
  } catch (_) {
    vendorBills = [];
  }

  let writeOffs = [];
  try {
    // A stay booked and started before a restart never had its receivable opened: writing it off only
    // clears Outstanding, there is nothing in the books to remove.
    const outsideSql = reset
      ? `(r.created_at < '${reset}'::timestamptz AND r.check_in < '${resetDay()}'::date)`
      : 'false';
    const { rows } = await query(
      `SELECT w.*, r.guest_name, ${outsideSql} AS legacy_outside
       FROM ar_write_offs w LEFT JOIN reservations r ON r.id = w.reservation_id
       WHERE w.status = 'approved'${afterReset('w.created_at')}
         AND COALESCE(w.approved_at, w.created_at)::date >= $1::date`,
      [sinceDate]
    );
    writeOffs = rows;
  } catch (_) {
    writeOffs = [];
  }

  let provisions = [];
  try {
    const resetMonth = resetDay().slice(0, 7);
    const { rows } = await query(
      `SELECT period_month, total_provision FROM ar_bad_debt_provisions
       WHERE ($1::text = '' OR period_month >= $1::text) ORDER BY period_month`,
      [resetMonth]
    );
    provisions = rows;
  } catch (_) {
    provisions = [];
  }

  // Closed months read their frozen journal; later changes arrive as dated corrections.
  let posted = [];
  let frozenMonths = [];
  if (currentPeriodBasis() === STAY) {
    try {
      const params = [sinceDate];
      let where = `entry_date >= $1::date`;
      if (to) {
        params.push(to);
        where += ` AND entry_date <= $2::date`;
      }
      const { rows } = await query(
        `SELECT year_month, kind, entry_id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date, entry
         FROM financial_posted_entries WHERE ${where} ORDER BY id`,
        params
      );
      posted = rows;
      const { rows: months } = await query(`SELECT DISTINCT year_month FROM financial_posted_entries WHERE kind = 'frozen'`);
      frozenMonths = months.map((m) => m.year_month);
    } catch (_) {
      posted = [];
      frozenMonths = [];
    }
  }

  let recurring = [];
  try {
    const { rows } = await query(
      `SELECT kind, label, account_code, amount_egp, day_of_month, is_active
       FROM financial_recurring_charges
       ORDER BY kind`
    );
    recurring = rows;
  } catch (_) {
    recurring = [];
  }

  let settings = { gateway_mdr_pct: 1.5 };
  try {
    const { rows } = await query(`SELECT key, value_num FROM financial_settings`);
    for (const row of rows) {
      if (row.key === 'gateway_mdr_pct') settings.gateway_mdr_pct = Number(row.value_num) || 1.5;
    }
  } catch (_) {}

  let closes = [];
  try {
    const { rows } = await query(
      `SELECT year_month, pnl_amount, closed_at, notes FROM financial_period_closes ORDER BY year_month`
    );
    closes = rows;
  } catch (_) {
    closes = [];
  }

  let holdbacks = [];
  try {
    const { rows } = await query(
      `SELECT h.*, su.full_name AS owner_name, COALESCE(u.unit_number, u.title) AS unit_name
       FROM financial_owner_holdbacks h
       JOIN staff_users su ON su.id = h.owner_id
       LEFT JOIN units u ON u.id = h.unit_id
       ORDER BY h.created_at DESC`
    );
    holdbacks = rows;
  } catch (_) {
    holdbacks = [];
  }

  let ownerLinks = [];
  try {
    const { rows } = await query(
      `SELECT ou.unit_id, ou.owner_id, su.full_name AS owner_name
       FROM owner_units ou
       JOIN staff_users su ON su.id = ou.owner_id`
    );
    ownerLinks = rows;
  } catch (_) {
    ownerLinks = [];
  }

  let snapshots = [];
  try {
    const { rows } = await query(
      `SELECT * FROM financial_bank_snapshots ORDER BY statement_date DESC, id DESC LIMIT 50`
    );
    snapshots = rows;
  } catch (_) {
    snapshots = [];
  }

  let reconciled = [];
  try {
    const { rows } = await query(`SELECT entry_id, account_code FROM financial_reconciled_entries`);
    reconciled = rows;
  } catch (_) {
    reconciled = [];
  }

  return {
    reservations,
    payments,
    expenses,
    hkOrders,
    petty,
    pettyAccounts,
    manuals,
    payouts,
    stayPayments,
    recurring,
    settings,
    closes,
    holdbacks,
    ownerLinks,
    snapshots,
    reconciled,
    reservationTotals,
    spanning,
    legacyStays,
    vendorBills,
    writeOffs,
    provisions,
    posted,
    frozenMonths,
    resetDay: resetDay(),
  };
}

function buildJournal(data, from, to, { includeCloses = true, useFrozen = true } = {}) {
  const journal = [];
  // A stay is earned once it happens (accrual, IFRS 15): stays that have not checked in yet stay out of
  // revenue even when the period runs past today; their deposits remain a liability until then.
  const asOf = to && to < todayIso() ? to : todayIso();
  const byResId = Object.fromEntries((data.reservations || []).map((r) => [String(r.id), r]));
  const legacyById = Object.fromEntries((data.legacyStays || []).map((r) => [String(r.id), r]));
  const openDay = data.resetDay || '';
  const mdrPct = data.settings?.gateway_mdr_pct ?? 1.5;

  for (const r of data.reservations || []) {
    if (!shouldRecognizeStay(r, asOf)) continue;
    if (!inRange(reservationBookedDate(r), from, to)) continue;
    journal.push(bookingEntry(r, asOf));
    const agent = agentAccrualEntry(r, asOf);
    if (agent) journal.push(agent);
  }

  // Nights earned month by month for stays that cross a month end.
  for (const r of [...(data.reservations || []), ...(data.spanning || [])]) {
    for (const e of stayRecognitionEntries(r, asOf)) {
      if (e.date <= asOf && inRange(e.date, from, to)) journal.push(e);
    }
  }

  const paidByRes = {};
  const prepaidByRes = {};
  const refundByRes = {};
  for (const p of data.stayPayments || data.payments || []) {
    if (String(p.kind || '') === 'forfeit') continue;
    const signed = parseFloat(p.amount) || 0;
    if (signed < 0 && p.reservation_id) {
      refundByRes[p.reservation_id] = round2((refundByRes[p.reservation_id] || 0) + Math.abs(signed));
    }
    if (!paymentCollected(p) || signed <= 0) continue;
    const res = byResId[String(p.reservation_id)];
    if (!res) continue;
    const payDate = paymentBusinessDate(p);
    const checkIn = isoDate(res.check_in);
    if (p.reservation_id) {
      paidByRes[p.reservation_id] = round2((paidByRes[p.reservation_id] || 0) + (parseFloat(p.amount) || 0));
    }
    if (checkIn && payDate && payDate < checkIn) {
      prepaidByRes[p.reservation_id] = round2((prepaidByRes[p.reservation_id] || 0) + (parseFloat(p.amount) || 0));
    }
  }
  for (const p of data.payments || []) {
    if (String(p.kind || '') === 'forfeit') continue;
    if (!paymentCollected(p)) continue;
    const res = byResId[String(p.reservation_id)] || legacyById[String(p.reservation_id)] || {
      guest_name: 'Guest',
      payment_method: p.payment_method,
      check_in: p.payment_date,
    };
    const entry = collectionEntry(p, res);
    journal.push(entry);
    if (entry.type === 'collection' && isGatewayMethod(entry.meta?.payment_method)) {
      const settled = gatewaySettleEntry(entry, mdrPct);
      if (settled) journal.push(settled);
    }
  }

  for (const r of data.reservations || []) {
    const recorded = paidByRes[r.id] || 0;
    const claimed = round2(parseFloat(r.amount_paid) || 0);
    const missing = round2(claimed - recorded - (parseFloat(r.opening_paid) || 0));
    if (missing > 0.009) {
      const payDate = isoDate(r.check_in) && claimed > 0 && isoDate(r.check_in) > todayIso()
        ? todayIso()
        : r.check_in;
      const synth = collectionEntry(
        {
          id: `x-${r.id}`,
          synthetic: true,
          reservation_id: r.id,
          amount: missing,
          payment_date: payDate,
          payment_method: r.payment_method || 'cash',
          status: 'successful',
        },
        r
      );
      if (!inRange(synth.date, from, to)) continue;
      journal.push(synth);
      if (synth.meta?.unearned) {
        prepaidByRes[r.id] = round2((prepaidByRes[r.id] || 0) + missing);
      }
      if (synth.type === 'collection' && isGatewayMethod(synth.meta?.payment_method)) {
        const settled = gatewaySettleEntry(synth, mdrPct);
        if (settled) journal.push(settled);
      }
    }
  }

  // Restart openings: money a stay paid before the restart sits in the opening treasuries,
  // so the guest deposit it created is opened against opening equity.
  for (const r of data.reservations || []) {
    const opening = round2(parseFloat(r.opening_paid) || 0);
    if (!r.pre_reset || !(opening > 0.009) || !openDay) continue;
    const cancelDate = isoDate(r.updated_at || r.cancelled_at);
    if (isCancelledStay(r) && cancelDate && cancelDate < openDay) {
      r.opening_paid = 0;
      continue;
    }
    prepaidByRes[r.id] = round2((prepaidByRes[r.id] || 0) + opening);
    const entry = makeEntry({
      id: `OPEN-DEP-${r.id}`,
      date: openDay,
      type: 'opening_balance',
      description: `Opening deposit — ${r.guest_name || 'Guest'} · ${r.unit_name || 'Unit'}`,
      lines: [
        journalLine('302000', opening, 0, 'Paid before the books restart (already in opening treasuries)'),
        journalLine('203000', 0, opening, 'Guest advance deposit carried into the new books'),
      ],
      meta: { reservation_id: r.id, guest_name: r.guest_name, opening: true, from_account: '302000', to_account: '203000' },
    });
    if (inRange(entry.date, from, to)) journal.push(entry);
  }

  for (const r of data.reservations || []) {
    const prepaidGross = prepaidByRes[r.id] != null
      ? prepaidByRes[r.id]
      : (prepaidAmount(r, data.stayPayments || data.payments) || 0);
    const prepaid = round2(Math.max(0, prepaidGross - (refundByRes[r.id] || 0)));
    if (isCancelledStay(r)) {
      const cxl = cancelForfeitEntry(r, prepaid);
      if (cxl && inRange(cxl.date, from, to)) journal.push(cxl);
    } else {
      const reclass = depositReclassEntry(r, prepaid, asOf);
      if (reclass && inRange(reclass.date, from, to)) journal.push(reclass);
    }
  }

  for (const e of data.expenses || []) {
    journal.push(...expenseEntries(e));
  }

  for (const vi of data.vendorBills || []) {
    for (const e of vendorBillEntries(vi)) if (inRange(e.date, from, to)) journal.push(e);
  }

  for (const w of data.writeOffs || []) {
    const e = writeOffEntry(w);
    if (e && inRange(e.date, from, to)) journal.push(e);
  }

  for (const e of provisionEntries(data.provisions)) {
    if (inRange(e.date, from, to)) journal.push(e);
  }

  for (const hk of data.hkOrders || []) {
    const amt = round2(parseFloat(hk.amount) || 0);
    if (!(amt > 0.009)) continue;
    const date = isoDate(hk.created_at) || isoDate(hk.period_start);
    if (!inRange(date, from, to)) continue;
    journal.push(
      makeEntry({
        id: `HK-${hk.id}`,
        date,
        type: 'housekeeping_order',
        description: `Housekeeping service — ${hk.client_name || hk.unit_number || 'Order'}`,
        lines: [
          journalLine('105000', amt, 0, 'Housekeeping service receivable'),
          journalLine('402000', 0, amt, 'Cleaning & turnover'),
        ],
        meta: { housekeeping_order_id: hk.id, unit_number: hk.unit_number },
      })
    );
  }

  for (const pc of data.petty || []) {
    if (pc.source) continue;
    const amt = parseFloat(pc.amount) || 0;
    const outflow = String(pc.entry_type || 'out') === 'out';
    // Each drawer is its own account under 108000, so petty spending never touches the treasuries.
    const drawer = (data.pettyAccounts || {})[pc.location] || '108000';
    const fundedByFinance = String(pc.entry_kind || '') === 'finance_transfer';
    const lines = outflow
      ? [
          journalLine('605000', amt, 0, pc.description || 'Petty cash out'),
          journalLine(drawer, 0, amt, 'Petty cash drawer'),
        ]
      : [
          journalLine(drawer, amt, 0, 'Petty cash in'),
          fundedByFinance
            ? journalLine('103000', 0, amt, 'Funded from Cash EGP')
            : journalLine('409000', 0, amt, pc.description || 'Petty cash in'),
        ];
    const pcDate = isoDate(pc.entry_date) || isoDate(pc.created_at);
    if (!inRange(pcDate, from, to)) continue;
    journal.push(
      makeEntry({
        id: `PC-${pc.id}`,
        date: pcDate,
        type: 'petty_cash',
        description: pc.description || (outflow ? 'Petty cash out' : 'Petty cash in'),
        lines,
        meta: { petty_cash_id: pc.id, location: pc.location, paid_by: pc.paid_by },
      })
    );
  }

  for (const row of data.manuals || []) {
    const amt = parseFloat(row.amount) || 0;
    const debitCode = String(row.debit_account_code || '').trim();
    const creditCode = String(row.credit_account_code || '').trim();
    let lines = [];
    let type = 'manual';
    if (debitCode && creditCode) {
      lines = [
        journalLine(debitCode, amt, 0, row.description || row.notes || 'Manual journal debit'),
        journalLine(creditCode, 0, amt, row.description || row.notes || 'Manual journal credit'),
      ];
      type =
        row.entry_type === 'revenue'
          ? 'manual_revenue'
          : row.entry_type === 'expense'
            ? 'manual_expense'
            : 'manual_journal';
    } else if (row.entry_type === 'revenue') {
      lines = [
        journalLine('101000', amt, 0, 'Manual revenue received'),
        journalLine('409000', 0, amt, row.description),
      ];
      type = 'manual_revenue';
    } else if (row.entry_type === 'expense') {
      lines = [
        journalLine('605000', amt, 0, row.description),
        journalLine('201000', 0, amt, 'Manual expense'),
      ];
      type = 'manual_expense';
    } else if (row.misc_flow === 'out') {
      lines = [
        journalLine('605000', amt, 0, row.description),
        journalLine('101000', 0, amt, 'Miscellaneous out'),
      ];
      type = 'miscellaneous';
    } else {
      lines = [
        journalLine('101000', amt, 0, 'Miscellaneous in'),
        journalLine('409000', 0, amt, row.description),
      ];
      type = 'miscellaneous';
    }
    journal.push(
      makeEntry({
        id: `MAN-${row.id}`,
        date: isoDate(row.entry_date) || isoDate(row.created_at),
        type,
        description: row.description || row.notes || 'Manual journal',
        lines,
        meta: {
          manual_id: row.id,
          amount: amt,
          unit_name: row.unit_name,
          created_by_name: row.created_by_name,
          notes: row.notes,
          from_account: creditCode || null,
          to_account: debitCode || null,
        },
      })
    );
  }

  for (const r of data.reservations || []) {
    const ins = insuranceRefundEntry(r);
    if (ins && inRange(ins.date, from, to)) journal.push(ins);
  }

  for (const p of data.payouts || []) {
    if (String(p.status) !== 'paid') continue;
    const amt = round2(parseFloat(p.amount) || 0);
    const date = isoDate(p.paid_at || p.reviewed_at || p.updated_at || p.created_at);
    if (!inRange(date, from, to)) continue;
    const payoutTreasury = String(p.paid_from_account || '').trim() || '101000';
    journal.push(
      makeEntry({
        id: `PO-${p.id}`,
        date,
        type: 'owner_payout',
        description: `Owner payout — ${p.owner_name || 'Owner'}`,
        lines: [
          journalLine('202000', amt, 0, 'Release owner trust'),
          journalLine(payoutTreasury, 0, amt, `Paid from ${accountLabel(payoutTreasury)}`),
        ],
        meta: {
          payout_id: p.id,
          owner_id: p.owner_id,
          owner_name: p.owner_name,
          from_account: '202000',
          to_account: payoutTreasury,
        },
      })
    );
  }

  for (const hb of data.holdbacks || []) {
    if (Number(hb.is_released) === 1) continue;
    const date = isoDate(hb.created_at);
    if (!inRange(date, from, to)) continue;
    const amt = round2(parseFloat(hb.amount) || 0);
    journal.push(
      makeEntry({
        id: `HB-${hb.id}`,
        date,
        type: 'owner_holdback',
        description: `Owner holdback — ${hb.owner_name || 'Owner'}`,
        lines: [
          journalLine('202000', amt, 0, hb.reason || 'Hold back from trust'),
          journalLine('110000', 0, amt, 'Reserve against owner recoverables'),
        ],
        meta: {
          holdback_id: hb.id,
          owner_id: hb.owner_id,
          owner_name: hb.owner_name,
        },
      })
    );
  }

  const resetDay = booksResetAt() ? booksResetAt().slice(0, 10) : '';
  for (const month of monthsInRange(from, to)) {
    for (const rec of data.recurring || []) {
      journal.push(...recurringEntries(rec, month, from, to).filter((e) => !resetDay || e.date >= resetDay));
    }
  }

  // Posted corrections are facts; closed months show exactly what was frozen when they closed.
  if (useFrozen && (data.posted || []).length) {
    const frozen = new Set(data.frozenMonths || []);
    const monthOf = (d) => String(d || '').slice(0, 7);
    const kept = journal.filter((e) => !frozen.has(monthOf(e.date)));
    journal.length = 0;
    journal.push(...kept);
    for (const row of data.posted) {
      const rowMonth = monthOf(row.entry_date);
      if (row.kind === 'frozen' && frozen.has(rowMonth)) journal.push(row.entry);
      else if (row.kind === 'adjustment' && !frozen.has(rowMonth)) journal.push(row.entry);
    }
  } else if (!useFrozen) {
    for (const row of data.posted || []) {
      if (row.kind === 'adjustment') journal.push(row.entry);
    }
  }

  if (includeCloses) {
    const closedMonths = new Set((data.closes || []).map((c) => c.year_month));
    for (const month of monthsInRange(from, to)) {
      if (!closedMonths.has(month)) continue;
      const monthFrom = `${month}-01`;
      const monthTo = lastDayOfMonth(month);
      const monthJournal = journal.filter((e) => inRange(e.date, monthFrom, monthTo) && e.type !== 'period_close');
      journal.push(closeMonthEntry(month, monthJournal));
    }
  }

  journal.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
  return journal.filter((e) => inRange(e.date, from, to) && e.lines.length);
}

function balancesFromJournal(journal) {
  const map = {};
  for (const entry of journal) {
    for (const line of entry.lines) {
      if (!map[line.account]) map[line.account] = { debit: 0, credit: 0 };
      map[line.account].debit += line.debit || 0;
      map[line.account].credit += line.credit || 0;
    }
  }
  return CHART_OF_ACCOUNTS.map((acct) => {
    const raw = map[acct.code] || { debit: 0, credit: 0 };
    const debit = round2(raw.debit);
    const credit = round2(raw.credit);
    return {
      ...acct,
      debit,
      credit,
      balance: round2(signedBalance(acct.type, debit, credit, acct.contra)),
      txn_count: journal.filter((e) => e.lines.some((l) => l.account === acct.code)).length,
    };
  });
}

function stayCountsInRevenue(r, from, to) {
  if (isCancelledStay(r)) return false;
  return inRange(reservationBookedDate(r), from, to);
}

function reservationListTotal(r) {
  return round2(parseFloat(r?.total_amount) || 0);
}

function mirrorTransactions(journal, code, opts = {}) {
  if (code === '400000') {
    const { reservations, from, to } = opts;
    const rows = [];
    for (const r of reservations || []) {
      if (!stayCountsInRevenue(r, from, to)) continue;
      rows.push({
        id: `BK-${r.id}`,
        date: reservationBookedDate(r),
        description: `${r.guest_name || 'Guest'} — ${r.unit_name || 'Unit'}`,
        amount: reservationListTotal(r),
        side: 'credit',
        counterparty: r.guest_name || r.unit_name || 'Stay',
        type: 'booking',
      });
    }
    for (const e of journal || []) {
      if (e.type !== 'manual_revenue') continue;
      rows.push({
        id: e.id,
        date: e.date,
        description: e.description,
        amount: round2(parseFloat(e.meta?.amount) || e.debit || 0),
        side: 'credit',
        counterparty: e.meta?.unit_name || 'Custom revenue',
        type: e.type,
      });
    }
    return rows;
  }

  const acct = getAccount(code);
  const look = acct?.mirror || code;
  const out = [];

  for (const e of journal) {
    const line = e.lines.find((l) => l.account === look);
    if (!line) continue;
    const amount = (line.debit || 0) > 0 ? line.debit : line.credit;
    const side = (line.debit || 0) > 0 ? 'debit' : 'credit';
    const other = e.lines.find((l) => l.account !== look);
    out.push({
      id: e.id,
      date: e.date,
      description: e.description,
      amount: round2(amount),
      side,
      counterparty: other?.account_name || other?.memo || '',
      type: e.type,
    });
  }
  return out;
}

function summarizeOutstanding(reservations, asOf) {
  let amount = 0;
  let count = 0;
  const cutoff = asOf || todayIso();
  for (const r of reservations || []) {
    if (isCancelledStay(r)) continue;
    if (isoDate(r.check_in) > cutoff) continue;
    const due = reservationBill(r).toCollect;
    if (due > 0.009) {
      amount += due;
      count += 1;
    }
  }
  return { amount: round2(amount), count };
}

function agingFromReservations(reservations, asOf) {
  const cutoff = asOf || todayIso();
  const buckets = {
    current: { label: '0–30 days', amount: 0, count: 0, rows: [] },
    d31: { label: '31–60 days', amount: 0, count: 0, rows: [] },
    d61: { label: '61–90 days', amount: 0, count: 0, rows: [] },
    d90: { label: '90+ days', amount: 0, count: 0, rows: [] },
  };
  for (const r of reservations || []) {
    if (isCancelledStay(r)) continue;
    const checkIn = isoDate(r.check_in);
    if (!checkIn || checkIn > cutoff) continue;
    const bill = reservationBill(r);
    const due = bill.toCollect;
    if (!(due > 0.009)) continue;
    const days = Math.max(0, Math.floor((new Date(`${cutoff}T00:00:00`) - new Date(`${checkIn}T00:00:00`)) / 86400000));
    const row = {
      reservation_id: r.id,
      guest_name: r.guest_name,
      guest_phone: r.guest_phone,
      unit_name: r.unit_name,
      project: r.project,
      check_in: checkIn,
      check_out: isoDate(r.check_out),
      nights: bill.nights,
      price_per_night: bill.pricePerNight,
      accommodation: bill.accommodation,
      housekeeping: bill.housekeeping,
      beach: bill.beach,
      insurance: bill.insurance,
      full_bill: bill.total,
      owner_collected: bill.ownerCollected,
      owner_collected_type: bill.ownerCollectedType,
      paid: bill.paid,
      payment_status: r.payment_status,
      sales_person: r.sales_person_name,
      days,
      amount: due,
    };
    let key = 'current';
    if (days > 90) key = 'd90';
    else if (days > 60) key = 'd61';
    else if (days > 30) key = 'd31';
    buckets[key].amount = round2(buckets[key].amount + due);
    buckets[key].count += 1;
    buckets[key].rows.push(row);
  }
  return {
    as_of: cutoff,
    total: round2(Object.values(buckets).reduce((s, b) => s + b.amount, 0)),
    buckets,
  };
}

function pnlFromBalances(bals) {
  const revenue = bals.filter((a) => a.type === 'revenue' && !a.virtual);
  const expenses = bals.filter((a) => a.group === 'expenses' || a.type === 'expense');
  // Keep legacy cogs/opex buckets by account code series for reports that still split them.
  const cogs = expenses.filter((a) => String(a.code || '').startsWith('5'));
  const opex = expenses.filter((a) => String(a.code || '').startsWith('6'));
  const revTotal = round2(revenue.reduce((s, a) => s + a.balance, 0));
  const cogsTotal = round2(cogs.reduce((s, a) => s + a.balance, 0));
  const opexTotal = round2(opex.reduce((s, a) => s + a.balance, 0));
  const expenseTotal = round2(expenses.reduce((s, a) => s + a.balance, 0));
  const gross = round2(revTotal - cogsTotal);
  const net = round2(revTotal - expenseTotal);
  return {
    revenue,
    expenses,
    cogs,
    opex,
    totals: {
      revenue: revTotal,
      expenses: expenseTotal,
      cogs: cogsTotal,
      gross,
      opex: opexTotal,
      net,
    },
  };
}

function computeGrossReceipts(journal, reservations, from, to, sqlTotals) {
  let stays = 0;
  let stayCount = 0;
  let ownerShare = 0;
  let companyShare = 0;
  const addSplit = (r) => {
    const { fin } = reservationFinancials(r);
    ownerShare += Number(fin.ownerNet) || 0;
    companyShare += Number(fin.companyCommission) || 0;
  };
  if (sqlTotals && Number.isFinite(Number(sqlTotals.stays))) {
    stays = Number(sqlTotals.stays) || 0;
    stayCount = Number(sqlTotals.stay_count) || 0;
    for (const r of reservations || []) {
      if (!stayCountsInRevenue(r, from, to)) continue;
      addSplit(r);
    }
  } else if (reservations) {
    for (const r of reservations) {
      if (!stayCountsInRevenue(r, from, to)) continue;
      stays += parseFloat(r.total_amount) || 0;
      stayCount += 1;
      addSplit(r);
    }
  } else {
    for (const e of journal || []) {
      if (e.type !== 'booking') continue;
      stays += parseFloat(e.meta?.total_amount) || 0;
      stayCount += 1;
      ownerShare += Number(e.meta?.owner_share) || 0;
      companyShare += Number(e.meta?.commission) || 0;
    }
  }

  let custom = 0;
  let customCount = 0;
  for (const e of journal || []) {
    if (e.type === 'period_close') continue;
    if (e.type === 'manual_revenue') {
      custom += parseFloat(e.meta?.amount) || e.debit || 0;
      customCount += 1;
    }
  }
  return {
    stays: round2(stays),
    custom: round2(custom),
    stay_count: stayCount,
    custom_count: customCount,
    housekeeping: 0,
    other: round2(custom),
    owner_share: round2(ownerShare),
    company_share: round2(companyShare),
    total: round2(stays + custom),
  };
}

function pnlTotalsFromReceipts(pnl, receipts) {
  const grossRevenue = round2(receipts?.total || 0);
  const ownerShare = round2(receipts?.owner_share || 0);
  const postedOwner = round2(
    (pnl.cogs || []).find((a) => a.code === '506000')?.balance || 0
  );
  const otherCogs = round2(Math.max(0, (pnl.totals.cogs || 0) - postedOwner));
  const opex = round2(pnl.totals.opex);
  const netRevenue = round2(grossRevenue - ownerShare);
  const gross = round2(netRevenue - otherCogs);
  const net = round2(gross - opex);
  return {
    ...pnl.totals,
    gross_revenue: grossRevenue,
    net_revenue: netRevenue,
    soul_fees: pnl.totals.revenue,
    owner_share: ownerShare,
    company_share: round2(receipts?.company_share || 0),
    cogs: otherCogs,
    owner_expense: ownerShare,
    opex,
    gross,
    net,
  };
}

function trialBalance(bals) {
  const rows = bals.filter((a) => a.debit > 0.009 || a.credit > 0.009 || Math.abs(a.balance) > 0.009);
  return {
    rows,
    debit: round2(rows.reduce((s, a) => s + a.debit, 0)),
    credit: round2(rows.reduce((s, a) => s + a.credit, 0)),
  };
}

function balanceSheet(bals, pnlNet) {
  const assets = bals.filter((a) => a.group === 'assets');
  const liabilities = bals.filter((a) => a.group === 'liabilities');
  const equity = bals.filter((a) => a.group === 'equity').map((a) => {
    if (a.code === '303000') return { ...a, balance: round2(pnlNet) };
    return a;
  });
  const assetTotal = round2(assets.reduce((s, a) => s + a.balance, 0));
  const liabTotal = round2(liabilities.reduce((s, a) => s + a.balance, 0));
  const equityTotal = round2(equity.reduce((s, a) => s + a.balance, 0));
  return {
    assets,
    liabilities,
    equity,
    totals: {
      assets: assetTotal,
      liabilities: liabTotal,
      equity: equityTotal,
      liabilities_and_equity: round2(liabTotal + equityTotal),
    },
  };
}

function treasuryBalancesFromJournal(journal) {
  const bals = balancesFromJournal(journal);
  const byCode = {};
  let total = 0;
  for (const code of treasuryCodes()) {
    const a = bals.find((x) => x.code === code);
    const balance = a?.balance || 0;
    byCode[code] = {
      code,
      name: a?.name || accountLabel(code),
      currency: getAccount(code)?.currency || 'EGP',
      balance: round2(balance),
      debit: a?.debit || 0,
      credit: a?.credit || 0,
    };
    total = round2(total + balance);
  }
  return { byCode, total: round2(total) };
}

const FINANCING_EQUITY_CODES = new Set(['302000']);

function entryTreasuryTotals(entry) {
  let debit = 0;
  let credit = 0;
  for (const line of entry.lines || []) {
    if (!isTreasuryCode(line.account)) continue;
    debit += Number(line.debit) || 0;
    credit += Number(line.credit) || 0;
  }
  return { debit: round2(debit), credit: round2(credit), net: round2(debit - credit) };
}

function isPureTreasuryTransfer(entry) {
  const tLines = (entry.lines || []).filter((l) => isTreasuryCode(l.account));
  if (tLines.length < 2) return false;
  const hasDebit = tLines.some((l) => (Number(l.debit) || 0) > 0.009);
  const hasCredit = tLines.some((l) => (Number(l.credit) || 0) > 0.009);
  if (!hasDebit || !hasCredit) return false;
  const other = (entry.lines || []).filter((l) => !isTreasuryCode(l.account));
  const otherAmt = other.reduce((s, l) => s + (Number(l.debit) || 0) + (Number(l.credit) || 0), 0);
  return otherAmt < 0.01;
}

function touchesCodes(entry, codeSet) {
  return (entry.lines || []).some((l) => codeSet.has(l.account));
}

function cfEntryRef(entry, amount) {
  return {
    id: entry.id,
    date: isoDate(entry.date),
    description: entry.description || entry.type || entry.id,
    amount: round2(amount),
    type: entry.type,
  };
}

function makeCfLine(id, label) {
  return { id, label, amount: 0, entries: [] };
}

function pushCfAmount(line, entry, amount) {
  const amt = round2(amount);
  if (Math.abs(amt) < 0.005) return;
  line.amount = round2(line.amount + amt);
  line.entries.push(cfEntryRef(entry, amt));
}

function sectionFromLines(lines) {
  const nonempty = lines.filter((l) => Math.abs(l.amount) >= 0.005 || (l.entries && l.entries.length));
  const total = round2(nonempty.reduce((s, l) => s + l.amount, 0));
  return { lines: nonempty, total };
}

/**
 * Direct-method Statement of Cash Flows for treasury accounts (bank, cash and their sub-accounts).
 * @param {Array} periodJournal - entries in [from, to]
 * @param {{ openingJournal?: Array, closingJournal?: Array, from?: string, to?: string }} opts
 */
function cashFlow(periodJournal, opts = {}) {
  const openingJournal = opts.openingJournal || [];
  const closingJournal = opts.closingJournal || periodJournal || [];
  const openingPos = treasuryBalancesFromJournal(openingJournal);
  const closingPos = treasuryBalancesFromJournal(closingJournal);

  const opCollections = makeCfLine('collections', 'Cash received from guests');
  const opGateway = makeCfLine('gateway_settlements', 'Gateway settlements to bank');
  const opOtherIn = makeCfLine('other_receipts', 'Other operating receipts');
  const opVendors = makeCfLine('vendor_payments', 'Cash paid to vendors / operations');
  const opRefunds = makeCfLine('guest_refunds', 'Guest / insurance cash refunds');
  const opOtherOut = makeCfLine('other_payments', 'Other operating payments');
  const opTransfers = makeCfLine('treasury_transfers', 'Treasury transfers (net)');

  const finOwner = makeCfLine('owner_payouts', 'Owner trust settlements');
  const finOther = makeCfLine('other_financing', 'Other financing');

  let operatingIn = 0;
  let operatingOut = 0;
  let financingOut = 0;

  const cashCodes = treasuryCodes();
  const byAccountFlow = {};
  for (const code of cashCodes) {
    byAccountFlow[code] = { inflows: 0, outflows: 0 };
  }

  for (const entry of periodJournal || []) {
    if (entry.type === 'depreciation' || entry.type === 'period_close') continue;
    const { debit, credit, net } = entryTreasuryTotals(entry);
    if (Math.abs(debit) < 0.005 && Math.abs(credit) < 0.005) continue;

    for (const line of entry.lines || []) {
      if (!byAccountFlow[line.account]) continue;
      byAccountFlow[line.account].inflows = round2(
        byAccountFlow[line.account].inflows + (Number(line.debit) || 0)
      );
      byAccountFlow[line.account].outflows = round2(
        byAccountFlow[line.account].outflows + (Number(line.credit) || 0)
      );
    }

    if (isPureTreasuryTransfer(entry)) {
      // Gross cancel within cash — memo at net 0 so operating in/out are not inflated
      opTransfers.entries.push({
        id: entry.id,
        date: isoDate(entry.date),
        description: `${entry.description || 'Treasury transfer'} (${round2(debit)} moved)`,
        amount: 0,
        type: entry.type,
      });
      continue;
    }

    if (entry.type === 'owner_payout') {
      const out = credit || Math.abs(Math.min(0, net));
      pushCfAmount(finOwner, entry, -out);
      financingOut = round2(financingOut + out);
      continue;
    }

    if (touchesCodes(entry, FINANCING_EQUITY_CODES)) {
      if (debit > 0.009) pushCfAmount(finOther, entry, debit);
      if (credit > 0.009) {
        pushCfAmount(finOther, entry, -credit);
        financingOut = round2(financingOut + credit);
      }
      continue;
    }

    // Operating classification
    if (debit > 0.009) {
      operatingIn = round2(operatingIn + debit);
      if (entry.type === 'collection') pushCfAmount(opCollections, entry, debit);
      else if (entry.type === 'gateway_settle') pushCfAmount(opGateway, entry, debit);
      else pushCfAmount(opOtherIn, entry, debit);
    }
    if (credit > 0.009) {
      operatingOut = round2(operatingOut + credit);
      if (
        entry.type === 'expense' ||
        entry.type === 'expense_payment' ||
        entry.type === 'recurring_payment' ||
        entry.type === 'housekeeping_order'
      ) {
        pushCfAmount(opVendors, entry, -credit);
      } else if (entry.type === 'refund' || entry.type === 'insurance_refund') {
        pushCfAmount(opRefunds, entry, -credit);
      } else {
        pushCfAmount(opOtherOut, entry, -credit);
      }
    }
  }

  const operating = sectionFromLines([
    opCollections,
    opGateway,
    opOtherIn,
    opVendors,
    opRefunds,
    opOtherOut,
    opTransfers,
  ]);
  const investing = sectionFromLines([]);
  const financing = sectionFromLines([finOwner, finOther]);

  const netChange = round2(operating.total + investing.total + financing.total);
  const openingCash = openingPos.total;
  const endingFromBridge = round2(openingCash + netChange);
  const endingFromLedger = closingPos.total;
  const variance = round2(endingFromBridge - endingFromLedger);

  const byAccount = cashCodes.map((code) => {
    const open = openingPos.byCode[code]?.balance || 0;
    const flow = byAccountFlow[code] || { inflows: 0, outflows: 0 };
    const closeLedger = closingPos.byCode[code]?.balance || 0;
    return {
      code,
      name: openingPos.byCode[code]?.name || accountLabel(code),
      currency: getAccount(code)?.currency || 'EGP',
      opening: round2(open),
      inflows: round2(flow.inflows),
      outflows: round2(flow.outflows),
      closing: round2(closeLedger),
    };
  });

  return {
    method: 'direct',
    cash_definition: cashCodes,
    from_date: opts.from || null,
    to_date: opts.to || null,
    opening_cash: openingCash,
    ending_cash: endingFromLedger,
    ending_cash_bridge: endingFromBridge,
    net_change: netChange,
    by_account: byAccount,
    operating,
    investing,
    financing,
    reconciliation: {
      opening_plus_net: endingFromBridge,
      ending_from_ledger: endingFromLedger,
      variance,
      balanced: Math.abs(variance) <= 0.05,
    },
    operating_in: operatingIn,
    operating_out: operatingOut,
    operating_net: operating.total,
    financing_out: financingOut,
    note:
      'Direct method. Cash = Bank ADIB 101000, Bank CIB 102000, Cash EGP 103000 and Cash USD 104000 (booked in EGP) plus their sub-accounts. Gateway clearing (106000) is not cash until settled.',
  };
}

async function buildCashFlowStatement(from, to) {
  const asOf = to || todayIso();
  const start = from || FINANCIAL_EPOCH;
  const hist = await loadPortalData(FINANCIAL_EPOCH, asOf);
  const full = buildJournal(hist, FINANCIAL_EPOCH, asOf);
  const openingJournal = full.filter((e) => {
    const d = isoDate(e.date);
    return d && d < start;
  });
  const periodJournal = full.filter((e) => inRange(e.date, start, asOf));
  return cashFlow(periodJournal, {
    openingJournal,
    closingJournal: full,
    from: start,
    to: asOf,
  });
}

function ownerTrustSubledger(journal, data) {
  const byOwner = {};
  const linksByUnit = {};
  for (const link of data.ownerLinks || []) {
    const key = String(link.unit_id);
    if (!linksByUnit[key]) linksByUnit[key] = [];
    linksByUnit[key].push(link);
  }
  function touch(ownerId, name) {
    const id = String(ownerId || 'unassigned');
    if (!byOwner[id]) {
      byOwner[id] = {
        owner_id: ownerId || null,
        owner_name: name || 'Unassigned unit',
        credits: 0,
        payouts: 0,
        holdbacks: 0,
        expenses: 0,
        balance: 0,
      };
    }
    return byOwner[id];
  }

  for (const e of journal) {
    if (e.type === 'booking') {
      const share = round2(e.meta?.owner_share || 0);
      if (!(share > 0.009)) continue;
      const links = linksByUnit[String(e.meta?.unit_id)] || [];
      if (!links.length) {
        touch(null, e.meta?.unit_name).credits += share;
      } else {
        const each = round2(share / links.length);
        for (const link of links) touch(link.owner_id, link.owner_name).credits += each;
      }
    }
    if (e.type === 'owner_payout') {
      touch(e.meta?.owner_id, e.meta?.owner_name).payouts += e.debit || 0;
    }
    if (e.type === 'owner_holdback') {
      const amt = e.lines.find((l) => l.account === '202000')?.debit || e.debit || 0;
      touch(e.meta?.owner_id, e.meta?.owner_name).holdbacks += round2(amt);
    }
    if (e.type === 'expense' && e.lines.some((l) => l.account === '202000' && l.debit > 0)) {
      const amt = e.lines.find((l) => l.account === '202000')?.debit || 0;
      const links = linksByUnit[String(e.meta?.unit_id)] || [];
      if (!links.length) touch(null, 'Owner expense').expenses += amt;
      else {
        const each = round2(amt / links.length);
        for (const link of links) touch(link.owner_id, link.owner_name).expenses += each;
      }
    }
  }

  const rows = Object.values(byOwner).map((row) => ({
    ...row,
    credits: round2(row.credits),
    payouts: round2(row.payouts),
    holdbacks: round2(row.holdbacks),
    expenses: round2(row.expenses),
    balance: round2(row.credits - row.payouts - row.holdbacks - row.expenses),
  }));
  const control = round2(
    (journal.flatMap((e) => e.lines).filter((l) => l.account === '202000').reduce((s, l) => s + (l.credit || 0) - (l.debit || 0), 0))
  );
  return {
    rows: rows.sort((a, b) => a.owner_name.localeCompare(b.owner_name)),
    control_202000: control,
    tied: Math.abs(round2(rows.reduce((s, r) => s + r.balance, 0)) - control) < 1,
  };
}

function buildPortal(journal, reservations, recurring, extras = {}) {
  const bals = balancesFromJournal(journal);
  const byCode = Object.fromEntries(bals.map((a) => [a.code, a]));
  const groups = accountsByGroup();
  const operatingJournal = journal.filter((e) => e.type !== 'period_close');
  const pnl = pnlFromBalances(balancesFromJournal(operatingJournal));
  const receipts = computeGrossReceipts(
    operatingJournal,
    reservations,
    extras.from,
    extras.to,
    extras.reservationTotals
  );
  const soulFees = pnl.totals.revenue;
  const headline = pnlTotalsFromReceipts(pnl, receipts);

  if (byCode['400000']) {
    byCode['400000'].balance = receipts.total;
    byCode['400000'].debit = 0;
    byCode['400000'].credit = receipts.total;
    byCode['400000'].txn_count = (receipts.stay_count || 0) + (receipts.custom_count || 0);
  }
  if (byCode['506000']) {
    byCode['506000'].balance = receipts.owner_share;
    byCode['506000'].debit = receipts.owner_share;
    byCode['506000'].credit = 0;
    byCode['506000'].txn_count = receipts.stay_count || 0;
  }

  const groupCards = Object.entries(groups).map(([id, g]) => {
    const accounts = g.accounts.map((a) => byCode[a.code]).filter(Boolean);
    const balance =
      id === 'revenue'
        ? receipts.total
        : round2(accounts.filter((a) => !a.virtual).reduce((s, a) => s + a.balance, 0));
    return {
      id,
      label: g.label,
      account_count: accounts.length,
      balance,
      accounts,
    };
  });

  const treasuryCard = (a, parentCode) => ({
    code: a.code,
    name: a.name,
    currency: getAccount(parentCode)?.currency || 'EGP',
    kind: getAccount(parentCode)?.treasury,
    balance: a.balance || 0,
    inflow: round2(a.debit || 0),
    outflow: round2(a.credit || 0),
    txn_count: a.txn_count || 0,
  });
  const usdByCode = {};
  for (const entry of journal) {
    for (const line of entry.lines || []) {
      if (!line.usd) continue;
      const sign = (line.debit || 0) > 0 ? 1 : -1;
      usdByCode[line.account] = round2((usdByCode[line.account] || 0) + sign * line.usd);
    }
  }
  const treasury = TREASURY_CODES.flatMap((code) => {
    const a = byCode[code] || { code, name: getAccount(code)?.name, balance: 0, debit: 0, credit: 0, txn_count: 0 };
    const children = bals.filter((b) => b.custom && b.parent_code === code);
    return [a, ...children].map((acct) => ({
      ...treasuryCard(acct, code),
      ...(getAccount(code)?.currency === 'USD' ? { usd_balance: usdByCode[acct.code] || 0 } : {}),
    }));
  });

  const outstanding = summarizeOutstanding(reservations);
  const collected = round2(
    journal.filter((e) => e.type === 'collection').reduce((s, e) => s + e.debit, 0)
  );
  const inputVat = byCode['107000']?.balance || 0;
  const outputVat = byCode['205000']?.balance || 0;
  const withChildrenBalance = (code) =>
    round2(bals.filter((b) => b.code === code || (b.custom && b.parent_code === code)).reduce((s, b) => s + (b.balance || 0), 0));
  const treasuryTotal = round2(treasury.reduce((s, t) => s + (t.balance || 0), 0));
  const treasuryIn = round2(treasury.reduce((s, t) => s + (t.inflow || 0), 0));

  return {
    groups: groupCards,
    treasury,
    outstanding,
    recurring,
    closes: extras.closes || [],
    settings: extras.settings || { gateway_mdr_pct: 1.5 },
    receipts,
    kpis: {
      collected,
      uncollected: outstanding.amount,
      commission: byCode['401000']?.balance || 0,
      owner_trust: byCode['202000']?.balance || 0,
      vat_payable: round2(Math.max(0, outputVat - inputVat)),
      vat_output: outputVat,
      vat_input: inputVat,
      cash_egp: withChildrenBalance('103000'),
      cash_usd_book: withChildrenBalance('104000'),
      cash_usd: usdByCode['104000'] || 0,
      bank_adib: withChildrenBalance('101000'),
      bank_cib: withChildrenBalance('102000'),
      bank_egp: round2(withChildrenBalance('101000') + withChildrenBalance('102000')),
      gateway_clearing: byCode['106000']?.balance || 0,
      guest_ar: byCode['105000']?.balance || 0,
      gross_revenue: receipts.total,
      revenue: receipts.total,
      net_revenue: headline.net_revenue,
      soul_fees: soulFees,
      owner_share: headline.owner_share,
      owner_expense: headline.owner_share,
      company_share: headline.company_share,
      treasury_total: treasuryTotal,
      treasury_in: treasuryIn,
      cogs: headline.cogs,
      opex: headline.opex,
      gross_profit: headline.gross,
      net_profit: headline.net,
    },
    accounts: bals,
  };
}

function buildStatements(journal, reservations, from, to, reservationTotals) {
  const bals = balancesFromJournal(journal);
  const pnl = pnlFromBalances(bals.filter((a) => a.type === 'revenue' || a.type === 'expense'));
  const receipts = computeGrossReceipts(
    journal.filter((e) => e.type !== 'period_close'),
    reservations,
    from,
    to,
    reservationTotals
  );
  const closedPnl = journal.filter((e) => e.type === 'period_close');
  const livePnl = closedPnl.length ? 0 : pnl.totals.net;
  const tb = trialBalance(bals);
  const bs = balanceSheet(bals, livePnl === 0 && closedPnl.length ? 0 : pnl.totals.net);
  return {
    trial_balance: tb,
    profit_and_loss: {
      ...pnl,
      receipts,
      totals: pnlTotalsFromReceipts(pnl, receipts),
    },
    balance_sheet: bs,
    cash_flow: cashFlow(journal, { openingJournal: [], closingJournal: journal, from, to }),
  };
}

function vatReturn(journal) {
  let output = 0;
  let input = 0;
  for (const e of journal) {
    for (const line of e.lines) {
      if (line.account === '205000') output += (line.credit || 0) - (line.debit || 0);
      if (line.account === '107000') input += (line.debit || 0) - (line.credit || 0);
    }
  }
  return {
    output_vat: round2(output),
    input_vat: round2(input),
    net_vat_payable: round2(output - input),
  };
}

async function syncClosedMonths() {
  try {
    await require('./periodFreeze').syncPriorPeriodAdjustments();
  } catch (e) {
    console.warn('[finance] closed-month sync skipped', e.message);
  }
}

async function buildFinancialPortal(from, to) {
  await syncClosedMonths();
  const data = await loadPortalData(from, to);
  const journal = buildJournal(data, from, to);
  const portal = buildPortal(journal, data.reservations, data.recurring, {
    closes: data.closes,
    settings: data.settings,
    from,
    to,
    reservationTotals: data.reservationTotals,
  });
  return {
    journal,
    ...portal,
    reservations: data.reservations,
    payouts: data.payouts,
    holdbacks: data.holdbacks,
    snapshots: data.snapshots,
    reconciled: data.reconciled,
    ownerLinks: data.ownerLinks,
    data,
  };
}

async function buildYtdStatements(to, fromDate) {
  const from = fromDate || FINANCIAL_EPOCH;
  const asOf = to || todayIso();
  await syncClosedMonths();
  const data = await loadPortalData(from, asOf);
  const journal = buildJournal(data, from, asOf);
  const statements = buildStatements(journal, data.reservations, from, asOf, data.reservationTotals);
  const cashFlowStatement = await buildCashFlowStatement(from, asOf);
  return {
    from_date: from,
    to_date: asOf,
    ...statements,
    cash_flow: cashFlowStatement,
    vat_return: vatReturn(journal),
    owner_trust: ownerTrustSubledger(journal, data),
    aging: agingFromReservations(data.reservations, asOf),
    journal,
    data,
  };
}

async function isPeriodClosed(date) {
  const ym = isoDate(date).slice(0, 7);
  if (!ym) return false;
  try {
    const { rows } = await query(`SELECT year_month FROM financial_period_closes WHERE year_month = $1`, [ym]);
    return Boolean(rows[0]);
  } catch (_) {
    return false;
  }
}

module.exports = {
  reservationResetFilter,
  buildFinancialPortal,
  buildYtdStatements,
  buildStatements,
  buildJournal,
  loadPortalData,
  balancesFromJournal,
  mirrorTransactions,
  treasuryAccountForMethod,
  accountLabel,
  monthsInRange,
  lastDayOfMonth,
  agingFromReservations,
  ownerTrustSubledger,
  vatReturn,
  isPeriodClosed,
  closeMonthEntry,
  FINANCIAL_EPOCH,
  cashFlow,
  buildCashFlowStatement,
};
