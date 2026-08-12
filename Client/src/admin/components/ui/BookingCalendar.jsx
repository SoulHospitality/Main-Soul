import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';


const isoStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function nightsBetween(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function normaliseDate(d) {
  
  return String(d).replace('T', ' ').split(' ')[0];
}


function addOneDayStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1); 
  return isoStr(next);
}

function formatPill(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

function formatNights(checkIn, checkOut) {
  const n = nightsBetween(checkIn, checkOut);
  if (!n) return null;
  const ci = new Date(checkIn);
  const co = new Date(checkOut);
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return { nights: n, label: `${fmt(ci)} → ${fmt(co)}` };
}


function MonthGrid({ year, month, checkIn, checkOut, hovering, blockedSet, checkoutOnlySet, onDayClick, onDayHover, today, allowPastDates }) {
  const total = daysInMonth(year, month);
  const firstDow = new Date(year, month, 1).getDay(); 
  const header = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(new Date(year, month, d));

  return (
    <div className="min-w-0">
      <p className="text-center text-sm font-semibold text-gray-900 mb-3">{header}</p>

      
      <div className="grid grid-cols-7 mb-1">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(h => (
          <div key={h} className="text-center text-xs font-medium text-gray-400 py-1">{h}</div>
        ))}
      </div>

      
      <div className="grid grid-cols-7">
        {cells.map((date, idx) => {
          if (!date) return <div key={`e-${idx}`} className="h-10" />;

          const ds = isoStr(date);
          const isPast       = ds < today;
          
          const isBlocked    = blockedSet.has(ds) && !checkoutOnlySet.has(ds);
          
          
          const isCoOnly     = checkoutOnlySet.has(ds) && !blockedSet.has(ds);
          const isDisabled   = (isPast && !allowPastDates) || isBlocked;
          const isToday      = ds === today;

          const isCheckIn    = ds === checkIn;
          const isCheckOut   = ds === checkOut;
          const hasRange     = !!(checkIn && checkOut);
          const inRange      = hasRange && ds > checkIn && ds < checkOut;

          
          const hoverEnd     = hovering && hovering > checkIn ? hovering : null;
          const inHover      = !hasRange && checkIn && hoverEnd && ds > checkIn && ds <= hoverEnd;
          const isHoverEnd   = !hasRange && ds === hovering && hovering > checkIn;

          
          
          let bandLeft  = false;  
          let bandRight = false;  

          if (hasRange) {
            if (isCheckIn)  bandRight = true;
            if (isCheckOut) bandLeft  = true;
            if (inRange)    { bandLeft = true; bandRight = true; }
          } else if (checkIn && hoverEnd) {
            if (isCheckIn)   bandRight = true;
            if (isHoverEnd)  bandLeft  = true;
            if (inHover && !isHoverEnd) { bandLeft = true; bandRight = true; }
          }

          
          let circleClass = 'relative z-10 w-9 h-9 flex items-center justify-center rounded-full text-sm font-medium transition-colors ';
          if (isCheckIn || isCheckOut || isHoverEnd) {
            circleClass += 'bg-gray-900 text-white ';
          } else if (isDisabled) {
            circleClass += 'text-gray-300 cursor-not-allowed line-through ';
          } else if (isCoOnly) {
            
            
            circleClass += 'text-emerald-700 font-semibold cursor-pointer hover:bg-emerald-50 ring-1 ring-emerald-300 ';
          } else {
            circleClass += 'text-gray-700 cursor-pointer hover:bg-gray-100 ';
          }

          
          if (isToday && !isCheckIn && !isCheckOut) circleClass += 'ring-1 ring-gray-400 ';

          return (
            <div
              key={ds}
              className="relative h-10 flex items-center justify-center"
              onClick={() => !isDisabled && onDayClick(ds)}
              onMouseEnter={() => !isDisabled && onDayHover(ds)}
              title={
                isBlocked ? 'Unavailable — already booked' :
                isCoOnly  ? '✓ Turnover day — free to check in or check out here' :
                undefined
              }
            >
              
              {bandLeft && (
                <div className={`absolute inset-y-1 left-0 w-1/2 ${(inHover && !isHoverEnd) || (!hasRange && inHover) ? 'bg-blue-50' : 'bg-blue-100'}`} />
              )}
              
              {bandRight && (
                <div className={`absolute inset-y-1 right-0 w-1/2 ${inHover || !hasRange ? 'bg-blue-50' : 'bg-blue-100'}`} />
              )}

              
              <div className={circleClass}>
                {date.getDate()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


export default function BookingCalendar({ checkIn, checkOut, onChange, unitId, excludeId, allowPastDates = false }) {
  const today = isoStr(new Date());

  const startDate = new Date();
  const [leftYear,  setLeftYear]  = useState(startDate.getFullYear());
  const [leftMonth, setLeftMonth] = useState(startDate.getMonth());

  const [hovering, setHovering] = useState(null);

  
  const rightRaw   = new Date(leftYear, leftMonth + 1);
  const rightYear  = rightRaw.getFullYear();
  const rightMonth = rightRaw.getMonth();

  
  const { data: reservedRanges = [], isLoading: loadingDates } = useQuery({
    queryKey: ['blocked-dates', unitId, excludeId],
    queryFn: () => api.get('/reservations/blocked-dates', {
      params: { unit_id: unitId, exclude_id: excludeId || undefined },
    }).then(r => r.data),
    enabled: !!unitId,
    staleTime: 30000,
  });

  
  
  
  
  const { blockedSet, checkoutOnlySet } = useMemo(() => {
    const blocked = new Set();
    const turnover = new Set(); 
    reservedRanges.forEach(r => {
      
      if (r._guest_block || r.date) {
        blocked.add(normaliseDate(r.date || r.check_in));
        return;
      }
      const ci = normaliseDate(r.check_in);
      const co = normaliseDate(r.check_out);
      
      let cur = addOneDayStr(ci);
      while (cur < co) {
        blocked.add(cur);
        cur = addOneDayStr(cur);
      }
      
      turnover.add(ci); 
      turnover.add(co); 
    });
    return { blockedSet: blocked, checkoutOnlySet: turnover };
  }, [reservedRanges]);

  
  const rangeHasConflict = useCallback((from, to) => {
    let cur = addOneDayStr(from);
    while (cur < to) {
      
      if (blockedSet.has(cur) && !checkoutOnlySet.has(cur)) return true;
      cur = addOneDayStr(cur);
    }
    return false;
  }, [blockedSet, checkoutOnlySet]);

  
  const handleDayClick = useCallback((ds) => {
    
    if (blockedSet.has(ds) && !checkoutOnlySet.has(ds)) {
      toast.error('This date is unavailable');
      return;
    }

    if (!checkIn || (checkIn && checkOut)) {
      
      onChange(ds, '');
      setHovering(null);
      return;
    }

    
    if (ds <= checkIn) {
      
      if (blockedSet.has(ds) && !checkoutOnlySet.has(ds)) return;
      onChange(ds, '');
      setHovering(null);
      return;
    }

    
    if (rangeHasConflict(checkIn, ds)) {
      toast.error('Your selection includes unavailable dates — please choose different dates');
      return;
    }

    onChange(checkIn, ds);
    setHovering(null);
  }, [checkIn, checkOut, onChange, blockedSet, checkoutOnlySet, rangeHasConflict]);

  
  const goPrev = () => {
    if (leftMonth === 0) { setLeftYear(y => y - 1); setLeftMonth(11); }
    else setLeftMonth(m => m - 1);
  };
  const goNext = () => {
    if (leftMonth === 11) { setLeftYear(y => y + 1); setLeftMonth(0); }
    else setLeftMonth(m => m + 1);
  };

  const nightsInfo = formatNights(checkIn, checkOut);

  
  const gridProps = {
    checkIn, checkOut, hovering,
    blockedSet, checkoutOnlySet,
    onDayClick: handleDayClick,
    onDayHover: setHovering,
    today,
    allowPastDates,
  };

  if (!unitId) {
    return (
      <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center text-gray-400">
        <CalendarDays className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">Select a unit to open the availability calendar</p>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">

      
      <div className="px-6 pt-5 pb-4 border-b border-gray-100">
        {nightsInfo ? (
          <div className="mb-4">
            <span className="text-xl font-bold text-gray-900">
              {nightsInfo.nights} night{nightsInfo.nights !== 1 ? 's' : ''}
            </span>
            <span className="text-sm text-gray-400 ml-3">{nightsInfo.label}</span>
          </div>
        ) : checkIn ? (
          <p className="text-sm text-gray-500 mb-4 font-medium">Now select a check-out date</p>
        ) : (
          <p className="text-sm text-gray-500 mb-4 font-medium">Select a check-in date</p>
        )}

        
        <div className="flex gap-3">
          
          <div className={`flex-1 border rounded-xl px-4 py-2.5 transition-all
            ${!checkIn ? 'border-gray-900 ring-1 ring-gray-900 bg-white' :
              (!checkOut ? 'border-gray-300' : 'border-gray-200')} `}>
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-0.5">Check-in</div>
            <div className="flex items-center justify-between">
              <span className={`text-sm font-semibold ${checkIn ? 'text-gray-900' : 'text-gray-400'}`}>
                {checkIn ? formatPill(checkIn) : 'mm/dd/yyyy'}
              </span>
              {checkIn && (
                <button
                  onClick={() => { onChange('', ''); setHovering(null); }}
                  className="w-5 h-5 rounded-full bg-gray-200 text-gray-500 hover:bg-gray-300 flex items-center justify-center text-xs leading-none ml-2"
                  type="button"
                >×</button>
              )}
            </div>
          </div>

          
          <div className={`flex-1 border rounded-xl px-4 py-2.5 transition-all
            ${checkIn && !checkOut ? 'border-gray-900 ring-1 ring-gray-900 bg-white' :
              checkOut ? 'border-gray-200' : 'border-gray-200'}`}>
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-0.5">Checkout</div>
            <div className="flex items-center justify-between">
              <span className={`text-sm font-semibold ${checkOut ? 'text-gray-900' : 'text-gray-400'}`}>
                {checkOut ? formatPill(checkOut) : 'mm/dd/yyyy'}
              </span>
              {checkOut && (
                <button
                  onClick={() => { onChange(checkIn, ''); setHovering(null); }}
                  className="w-5 h-5 rounded-full bg-gray-200 text-gray-500 hover:bg-gray-300 flex items-center justify-center text-xs leading-none ml-2"
                  type="button"
                >×</button>
              )}
            </div>
          </div>
        </div>
      </div>

      
      <div className="px-6 pt-4">
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={goPrev}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-800"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex-1" /> 
          <button
            type="button"
            onClick={goNext}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-800"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        
        <div
          className="grid gap-8 pb-5"
          style={{ gridTemplateColumns: '1fr 1fr' }}
          onMouseLeave={() => setHovering(null)}
        >
          <MonthGrid {...gridProps} year={leftYear}  month={leftMonth}  />
          <MonthGrid {...gridProps} year={rightYear} month={rightMonth} />
        </div>
      </div>

      
      <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-5 text-xs text-gray-500 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full bg-gray-900 inline-flex items-center justify-center text-white text-[10px] font-bold">1</span>
          Selected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-6 h-4 rounded-sm bg-blue-100 inline-block" />
          Your stay
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full bg-gray-100 inline-flex items-center justify-center text-gray-300 text-[10px] line-through">1</span>
          Unavailable
        </span>
        {loadingDates && (
          <span className="ml-auto text-gray-400 animate-pulse">Loading availability…</span>
        )}
      </div>

    </div>
  );
}
