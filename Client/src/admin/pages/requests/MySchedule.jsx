import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import api from '../../api/axios';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { LEAVE_TYPE_LABELS } from '../../utils/hrPolicy';
import { CATEGORY, dayLabel } from './shared';

// Weeks run Saturday → Friday, so the usual Friday day off sits at the end of the row.
const WEEK = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export function monthShift(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function useMySchedule(user, month, enabled = true) {
  return useQuery({
    queryKey: ['hr-my-schedule', user?.id, month],
    queryFn: () => api.get('/hr/my-schedule', { params: { month } }).then((r) => r.data),
    enabled: Boolean(enabled && user?.id && month),
    placeholderData: (prev) => prev,
  });
}

const ATTENDANCE = {
  on_time: { label: 'On time', cls: 'text-emerald-700' },
  late: { label: 'Late', cls: 'text-amber-700' },
  no_show: { label: 'Absent', cls: 'text-rose-700' },
  absent: { label: 'Absent', cls: 'text-rose-700' },
};

function itemLabel(item) {
  if (item.kind === 'wfh') return 'WFH';
  if (item.category === 'excuse' || item.category === 'mission') {
    return `${item.category === 'excuse' ? 'Excuse' : 'Mission'}${item.start_time ? ` ${item.start_time}–${item.end_time}` : ''}`;
  }
  return LEAVE_TYPE_LABELS[item.leave_type] || 'Holiday';
}

/**
 * A month of the person's own schedule. In "view" mode clicking a free day starts a request for it and
 * clicking a chip opens that request; in "pick" mode (inside the new-request wizard) clicks choose dates.
 */
export function ScheduleCalendar({
  data,
  month,
  onMonth,
  today,
  onDay,
  onItem,
  selected = null,
  compact = false,
}) {
  if (!data) return <LoadingSpinner />;
  const days = data.days || [];
  const first = days[0]?.date || `${month}-01`;
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 1) % 7; // Saturday = 0
  const cells = [...Array(lead).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const inRange = (date) => selected && date >= selected.from && date <= (selected.to || selected.from);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="rounded-lg p-1.5 text-soul-muted hover:bg-slate-100 hover:text-soul-blue" onClick={() => onMonth(monthShift(month, -1))} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <p className="font-semibold text-soul-blue">
            {new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
          </p>
          {data.shift ? (
            <p className="text-[11px] text-soul-muted">
              Shift {data.shift.start}–{data.shift.end}
              {data.days_off?.length ? ` · day off ${data.days_off.map((d) => d[0].toUpperCase() + d.slice(1)).join(', ')}` : ''}
            </p>
          ) : null}
        </div>
        <button type="button" className="rounded-lg p-1.5 text-soul-muted hover:bg-slate-100 hover:text-soul-blue" onClick={() => onMonth(monthShift(month, 1))} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-soul-muted">
        {WEEK.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={`blank-${i}`} />;
          const isToday = day.date === today;
          const att = day.attendance ? ATTENDANCE[day.attendance.status] : null;
          const picked = inRange(day.date);
          const busy = day.items.length > 0;
          return (
            <div
              key={day.date}
              role="button"
              tabIndex={0}
              onClick={() => onDay?.(day)}
              onKeyDown={(e) => (e.key === 'Enter' ? onDay?.(day) : null)}
              title={`${dayLabel(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}${day.day_off ? ' · day off' : ''}`}
              className={`group relative flex flex-col rounded-lg border p-1 text-left transition sm:p-1.5 ${compact ? 'min-h-[3rem]' : 'min-h-[3.75rem] sm:min-h-[5.5rem]'} ${
                picked
                  ? 'border-soul-blue bg-soul-blue text-white'
                  : day.day_off
                    ? 'border-transparent bg-slate-50 text-slate-400 hover:border-slate-200'
                    : 'border-soul-line bg-white hover:border-soul-blue/40 hover:bg-slate-50'
              } ${isToday && !picked ? 'ring-2 ring-[var(--pms-accent,#F28C28)] ring-offset-1' : ''} cursor-pointer`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold ${picked ? 'text-white' : isToday ? 'text-soul-blue' : ''}`}>
                  {Number(day.date.slice(8, 10))}
                </span>
                {!compact && !busy && !day.day_off && onDay ? (
                  <Plus className="hidden h-3 w-3 text-soul-muted group-hover:block" />
                ) : null}
              </div>
              {day.day_off ? (
                <span className={`mt-auto hidden text-[10px] sm:block ${picked ? 'text-white/80' : ''}`}>Day off</span>
              ) : null}
              {!compact && att ? (
                <span className={`hidden text-[10px] font-medium sm:block ${picked ? 'text-white/90' : att.cls}`}>
                  {att.label}
                  {day.attendance.status === 'late' && day.attendance.check_in ? ` ${day.attendance.check_in}` : ''}
                </span>
              ) : null}
              <div className="mt-0.5 flex flex-wrap gap-0.5 sm:flex-col">
                {day.items.map((item) => {
                  const meta = CATEGORY[item.category] || CATEGORY.holiday;
                  return (
                    <button
                      key={`${item.kind}:${item.id}`}
                      type="button"
                      onClick={(e) => {
                        if (!onItem) return;
                        e.stopPropagation();
                        onItem(item);
                      }}
                      title={`${itemLabel(item)} · ${item.status}`}
                      className="min-w-0 text-left text-[10px] font-medium leading-tight"
                    >
                      <span className={`block h-1.5 w-1.5 rounded-full ${meta.dot} ${compact ? '' : 'sm:hidden'} ${item.status === 'pending' ? 'opacity-50' : ''}`} />
                      {compact ? null : (
                        <span className={`hidden truncate rounded border px-1 py-0.5 sm:block ${meta.chip} ${item.status === 'pending' ? 'border-dashed' : ''}`}>
                          {itemLabel(item)}
                          {item.status === 'pending' ? ' · pending' : ''}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {!compact ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-soul-muted">
          {['holiday', 'excuse', 'mission', 'wfh'].map((c) => (
            <span key={c} className="inline-flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${CATEGORY[c].dot}`} /> {CATEGORY[c].label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-3 rounded border border-dashed border-slate-400" /> Pending
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-3 rounded bg-slate-100" /> Day off
          </span>
        </div>
      ) : null}
    </div>
  );
}
