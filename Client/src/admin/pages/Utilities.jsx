import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import api from '../api/axios';
import { useSortableTable } from '../hooks/useSortableTable';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import SortTh from '../components/ui/SortTh';
import { currency, formatDate } from '../utils/formatters';
import SearchableSelect from '../components/ui/SearchableSelect';

export default function Utilities() {
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterUnit, setFilterUnit] = useState('');

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get('/units/projects').then(r => r.data).catch(() => [])
  });

  const { data: units = [] } = useQuery({
    queryKey: ['units', filterProject],
    queryFn: () => api.get('/units', { params: { project: filterProject || undefined } }).then(r => r.data),
  });

  const { data: utilities = {}, isLoading } = useQuery({
    queryKey: ['utilities', filterFromDate, filterToDate, filterProject, filterUnit],
    queryFn: () => api.get('/utilities', {
      params: {
        from_date: filterFromDate || undefined,
        to_date: filterToDate || undefined,
        project: filterProject || undefined,
        unit_id: filterUnit || undefined,
      }
    }).then(r => r.data),
  });

  const data = utilities.data || [];
  const summary = utilities.summary || { total_utilities_deducted: 0, total_reservations: 0 };

  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(data, 'check_in', 'desc');

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Utilities Tracking</h1>
        <p className="page-subtitle">Track utilities deductions from reservations</p>
      </div>

      <SearchFilter>
        <SearchableSelect className="w-40" value={filterProject} onChange={v => { setFilterProject(v); setFilterUnit(''); }}
          placeholder="All Projects"
          options={[{ value: '', label: 'All Projects' }, ...projects.map(p => ({ value: p, label: p }))]}
        />
        {filterProject && (
          <SearchableSelect className="w-40" value={filterUnit} onChange={setFilterUnit}
            placeholder="All Units"
            options={[{ value: '', label: 'All Units' }, ...units.map(u => ({ value: String(u.id), label: u.title || u.unit_number || u.name || u.id }))]}
          />
        )}
        <input type="date" className="input w-32" value={filterFromDate} onChange={e => setFilterFromDate(e.target.value)} />
        <input type="date" className="input w-32" value={filterToDate} onChange={e => setFilterToDate(e.target.value)} />
      </SearchFilter>

      {isLoading ? (
        <LoadingSpinner />
      ) : data.length === 0 ? (
        <EmptyState icon={Zap} title="No utilities data found" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4">
              <div className="text-sm text-gray-500 mb-1">Total Reservations</div>
              <div className="text-3xl font-bold text-gray-900">{summary.total_reservations}</div>
            </div>
            <div className="card p-4">
              <div className="text-sm text-gray-500 mb-1">Total Utilities Deducted</div>
              <div className="text-3xl font-bold text-orange-600">{currency(summary.total_utilities_deducted)}</div>
            </div>
            <div className="card p-4">
              <div className="text-sm text-gray-500 mb-1">Average Per Reservation</div>
              <div className="text-3xl font-bold text-gray-900">
                {summary.total_reservations > 0
                  ? currency(summary.total_utilities_deducted / summary.total_reservations)
                  : currency(0)
                }
              </div>
            </div>
          </div>

          <div className="card p-0">
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <SortTh col="unit_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Unit</SortTh>
                    <SortTh col="project" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Project</SortTh>
                    <SortTh col="guest_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Guest</SortTh>
                    <SortTh col="check_in" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Check-in</SortTh>
                    <SortTh col="check_out" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Check-out</SortTh>
                    <SortTh col="nights" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Nights</SortTh>
                    <SortTh col="total_amount" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Total Amount</SortTh>
                    <SortTh col="utilities_cost" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Utilities Cost/Night</SortTh>
                    <SortTh col="total_utilities_deducted" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Total Utilities Deducted</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => (
                    <tr key={row.id}>
                      <td className="font-medium text-gray-900">{row.unit_name}</td>
                      <td className="text-sm text-gray-500">{row.project}</td>
                      <td className="text-gray-900">{row.guest_name}</td>
                      <td className="text-sm">{formatDate(row.check_in)}</td>
                      <td className="text-sm">{formatDate(row.check_out)}</td>
                      <td className="text-center font-medium">{row.nights}</td>
                      <td className="font-medium">{currency(row.total_amount)}</td>
                      <td className="text-orange-600 font-medium">{currency(row.utilities_cost)}</td>
                      <td className="text-orange-600 font-bold">{currency(row.total_utilities_deducted)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
