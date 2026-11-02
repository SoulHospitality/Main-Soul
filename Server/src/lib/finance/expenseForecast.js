const history = require('./expenseHistory.json');

const WINDOW = 6;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Predicts monthly spending per category from the workbook history (expenseHistory.json).
 * Read-only: it never touches the books. Each category's forecast is a weighted average of its last
 * six complete months, newest month weighted most (6, 5, … 1).
 */
function buildExpenseForecast({ today = new Date().toISOString().slice(0, 10), horizon = 6 } = {}) {
  const currentMonth = today.slice(0, 7);
  const complete = history.months.filter((m) => m < currentMonth);
  const lastFull = complete[complete.length - 1] || addMonths(currentMonth, -1);
  const window = Array.from({ length: WINDOW }, (_, i) => addMonths(lastFull, i - WINDOW + 1));
  const shown = Array.from({ length: 12 }, (_, i) => addMonths(lastFull, i - 11)).filter((m) => m >= history.months[0]);
  const ahead = Array.from({ length: horizon }, (_, i) => addMonths(lastFull, i + 1));

  const weights = window.map((_, i) => i + 1);
  const weightSum = weights.reduce((s, w) => s + w, 0);

  const categories = history.categories.map((c) => {
    const series = window.map((m) => Number(c.monthly[m]) || 0);
    const predicted = round2(series.reduce((s, v, i) => s + v * weights[i], 0) / weightSum);
    const average = round2(series.reduce((s, v) => s + v, 0) / series.length);
    return {
      key: c.key,
      label: c.label,
      history: Object.fromEntries(shown.map((m) => [m, round2(Number(c.monthly[m]) || 0)])),
      forecast: Object.fromEntries(ahead.map((m) => [m, predicted])),
      monthly_prediction: predicted,
      six_month_average: average,
      last_month: round2(series[series.length - 1]),
      top_labels: c.top_labels,
    };
  });
  categories.sort((a, b) => b.monthly_prediction - a.monthly_prediction);

  const sumBy = (key, months) =>
    Object.fromEntries(months.map((m) => [m, round2(categories.reduce((s, c) => s + (c[key][m] || 0), 0))]));

  return {
    source_files: history.source_files,
    generated_at: history.generated_at,
    last_complete_month: lastFull,
    window_months: window,
    history_months: shown,
    forecast_months: ahead,
    categories,
    totals: {
      history: sumBy('history', shown),
      forecast: sumBy('forecast', ahead),
      monthly_prediction: round2(categories.reduce((s, c) => s + c.monthly_prediction, 0)),
    },
    excluded: history.excluded,
    unclassified: history.unclassified.slice(0, 30),
    unclassified_total: round2(history.unclassified.reduce((s, u) => s + u.amount, 0)),
  };
}

module.exports = { buildExpenseForecast };
