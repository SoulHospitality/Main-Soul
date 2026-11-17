import { useSearchParams } from 'react-router-dom';
import {
  KeyRound,
  History,
  MessageSquareText,
  LogOut,
  SprayCan,
  Building2,
  ClipboardCheck,
  Camera,
  Trophy,
  ShieldAlert,
  LayoutDashboard,
  LayoutGrid,
  Sun,
  Users,
  Home,
  UserCog,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { canAccess } from '../utils/permissions';
import { CheckinsTodaySection } from './OpsCheckinsToday';
import { CheckinsHistorySection } from './OpsCheckinsHistory';
import { CheckinCommentsSection } from './OpsCheckinComments';
import { CheckoutsTodaySection } from './OpsCheckoutsToday';
import { TodayCleansSection } from './HkTodayCleans';
import { CleansHistorySection } from './HkCleansHistory';
import { UnitCleansSummarySection } from './HkUnitCleansSummary';
import { UnitInspectionsSection } from './OpsUnitInspections';
import { AttendanceSection } from './OpsAttendance';
import { PerformanceSection } from './OpsPerformance';
import { DamageReportsSection } from './OpsDamageReports';
import { TodayBoardSection } from './OpsTodayBoard';
import { UnitBoardSection } from './OpsUnitBoard';
import { summarizeOpsDay, useHkCleans, useOpsCheckins, useOpsCheckouts } from '../hooks/useOpsDay';

const TABS = [
  { id: 'board', group: 'today', label: 'Today board', icon: LayoutDashboard, pages: ['ops_checkins', 'hk_today'] },
  { id: 'units', group: 'today', label: 'Unit status', icon: LayoutGrid, pages: ['ops_checkins'] },
  { id: 'today', group: 'guests', label: 'Check-ins', icon: KeyRound, pages: ['ops_checkins'], badge: 'arrivals' },
  { id: 'checkouts', group: 'guests', label: 'Checkouts', icon: LogOut, pages: ['ops_checkins'], badge: 'departures' },
  { id: 'history', group: 'guests', label: 'Check-ins history', icon: History, pages: ['ops_checkins'] },
  { id: 'comments', group: 'guests', label: 'Check-in comments', icon: MessageSquareText, pages: ['ops_comments'] },
  { id: 'cleans', group: 'cleaning', label: 'Cleaning', icon: SprayCan, pages: ['hk_today'], badge: 'cleans' },
  { id: 'cleans-history', group: 'cleaning', label: 'Cleans history', icon: History, pages: ['hk_today'] },
  { id: 'unit-cleans', group: 'cleaning', label: 'Unit cleans', icon: Building2, pages: ['hk_today'] },
  { id: 'inspections', group: 'units', label: 'New unit inspections', icon: ClipboardCheck, pages: ['unit_inspections'] },
  { id: 'damages', group: 'units', label: 'Damage reports', icon: ShieldAlert, pages: ['damage_reports'] },
  { id: 'attendance', group: 'team', label: 'Attendance', icon: Camera, pages: ['ops_team'] },
  { id: 'performance', group: 'team', label: 'Performance', icon: Trophy, pages: ['ops_team'] },
];

const GROUPS = [
  { id: 'today', label: 'Overview', icon: Sun },
  { id: 'guests', label: 'Guests', icon: Users },
  { id: 'cleaning', label: 'Cleaning', icon: SprayCan },
  { id: 'units', label: 'Units', icon: Home },
  { id: 'team', label: 'Team', icon: UserCog },
];

const TAB_ALIASES = {
  board: 'board',
  dashboard: 'board',
  units: 'units',
  'unit-status': 'units',
  today: 'today',
  'checkins-today': 'today',
  checkouts: 'checkouts',
  'checkouts-today': 'checkouts',
  cleans: 'cleans',
  'today-cleans': 'cleans',
  'cleans-history': 'cleans-history',
  'unit-cleans': 'unit-cleans',
  'units-cleans': 'unit-cleans',
  history: 'history',
  'checkins-history': 'history',
  comments: 'comments',
  'checkin-comments': 'comments',
  inspections: 'inspections',
  'unit-inspections': 'inspections',
  damages: 'damages',
  attendance: 'attendance',
  performance: 'performance',
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Badge({ n, active }) {
  if (!n) return null;
  return (
    <span
      className={`min-w-[1.25rem] h-5 px-1.5 rounded-full text-[11px] font-bold inline-flex items-center justify-center tabular-nums ${
        active ? 'bg-soul-blue text-white' : 'bg-amber-100 text-amber-800'
      }`}
    >
      {n}
    </span>
  );
}

export default function Operations() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'board';
  const range = ['today', 'tomorrow', 'week', 'month'].includes(searchParams.get('range'))
    ? searchParams.get('range')
    : 'today';
  const activeTab = TAB_ALIASES[rawTab] || 'board';

  const visibleTabs = TABS.filter((tab) => tab.pages.some((p) => canAccess(user, p)));
  const resolvedTab = visibleTabs.some((t) => t.id === activeTab) ? activeTab : visibleTabs[0]?.id || 'today';
  const current = TABS.find((t) => t.id === resolvedTab);
  const visibleGroups = GROUPS.filter((g) => visibleTabs.some((t) => t.group === g.id));
  const groupTabs = visibleTabs.filter((t) => t.group === current?.group);

  // Open work for today, shared with the tabs' own cache.
  const seesGuests = canAccess(user, 'ops_checkins');
  const seesCleans = canAccess(user, 'hk_today');
  const checkins = useOpsCheckins('today', seesGuests).data?.items || [];
  const checkouts = useOpsCheckouts('today', seesGuests).data?.items || [];
  const cleans = useHkCleans('today', seesCleans).data?.items || [];
  const sum = summarizeOpsDay({ checkins, checkouts, cleans });
  const badges = { arrivals: sum.arrivals.open, departures: sum.departures.open, cleans: sum.cleans.open };
  const groupBadge = (g) => visibleTabs.filter((t) => t.group === g && t.badge).reduce((n, t) => n + (badges[t.badge] || 0), 0);

  function setTab(id, nextRange) {
    const params = { tab: id };
    if (nextRange && nextRange !== 'today') params.range = nextRange;
    setSearchParams(params, { replace: true });
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }
  function setGroup(groupId) {
    const first = visibleTabs.find((t) => t.group === groupId);
    if (first) setTab(first.id);
  }

  return (
    <div className="space-y-5">
      <div className="page-header mb-0 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Operations</h1>
          <p className="page-subtitle">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' })}
            {seesGuests || seesCleans
              ? ` · ${plural(sum.arrivals.open, 'check-in')}, ${plural(sum.departures.open, 'checkout')} and ${plural(sum.cleans.open, 'clean')} still open today`
              : ''}
          </p>
        </div>
      </div>

      <nav className="space-y-2" aria-label="Operations sections">
        <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
          {visibleGroups.map((g) => {
            const Icon = g.icon;
            const active = current?.group === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroup(g.id)}
                className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                  active
                    ? 'bg-soul-blue text-white border-soul-blue shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-soul-blue/40 hover:text-gray-900'
                }`}
              >
                <Icon className="w-4 h-4" />
                {g.label}
                {!active ? <Badge n={groupBadge(g.id)} /> : null}
              </button>
            );
          })}
        </div>
        {groupTabs.length > 1 ? (
          <div className="flex gap-1 p-1 bg-gray-100 rounded-xl overflow-x-auto no-scrollbar">
            {groupTabs.map((tab) => {
              const Icon = tab.icon;
              const active = resolvedTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTab(tab.id)}
                  className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active ? 'bg-white text-soul-blue shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                  <Badge n={tab.badge ? badges[tab.badge] : 0} active={active} />
                </button>
              );
            })}
          </div>
        ) : null}
      </nav>

      {resolvedTab === 'board' ? <TodayBoardSection onOpen={setTab} /> : null}
      {resolvedTab === 'units' ? <UnitBoardSection key={range} onOpen={setTab} initialRange={range} /> : null}
      {resolvedTab === 'today' ? <CheckinsTodaySection key={range} embedded initialRange={range} /> : null}
      {resolvedTab === 'checkouts' ? <CheckoutsTodaySection key={range} embedded initialRange={range} /> : null}
      {resolvedTab === 'cleans' ? <TodayCleansSection key={range} embedded initialRange={range} /> : null}
      {resolvedTab === 'cleans-history' ? <CleansHistorySection embedded /> : null}
      {resolvedTab === 'unit-cleans' ? <UnitCleansSummarySection embedded /> : null}
      {resolvedTab === 'history' ? <CheckinsHistorySection embedded /> : null}
      {resolvedTab === 'comments' ? <CheckinCommentsSection embedded /> : null}
      {resolvedTab === 'inspections' ? <UnitInspectionsSection /> : null}
      {resolvedTab === 'damages' ? <DamageReportsSection /> : null}
      {resolvedTab === 'attendance' ? <AttendanceSection /> : null}
      {resolvedTab === 'performance' ? <PerformanceSection /> : null}
    </div>
  );
}
