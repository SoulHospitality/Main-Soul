import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { MapPin, Plus, Trash2 } from 'lucide-react';

import { PROJECT_CATALOG_KEY } from '../../hooks/useProjectCatalog';
import TagSelect from '../components/ui/TagSelect';
import { FACILITY_SUGGESTIONS } from '../utils/facilitySuggestions';

async function catalogFetch(path, options = {}) {
  const token = localStorage.getItem('pms_token');
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json.data || json;
}

export default function Projects() {
  const qc = useQueryClient();
  const { data: catalog, isLoading: loadingCatalog, refetch } = useQuery({
    queryKey: PROJECT_CATALOG_KEY,
    queryFn: () => catalogFetch('/projects/catalog'),
  });

  const destinations = catalog?.destinations || [];
  const projectsByDestination = catalog?.projectsByDestination || {};
  const items = catalog?.items || [];

  const [selectedDestination, setSelectedDestination] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [projectNameInput, setProjectNameInput] = useState('');
  const [createFacilities, setCreateFacilities] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editFacilities, setEditFacilities] = useState([]);

  useEffect(() => {
    if (!selectedDestination && destinations[0]) {
      setSelectedDestination(destinations[0]);
      return;
    }
    if (selectedDestination && destinations.length && !destinations.includes(selectedDestination)) {
      setSelectedDestination(destinations[0] || '');
    }
  }, [destinations, selectedDestination]);

  const selectedProjects = useMemo(() => {
    if (!selectedDestination) return [];
    return projectsByDestination[selectedDestination] || [];
  }, [projectsByDestination, selectedDestination]);

  const createMutation = useMutation({
    mutationFn: ({ destination, name, facilities }) =>
      catalogFetch('/projects', {
        method: 'POST',
        body: JSON.stringify({ destination, name, facilities }),
      }),
    onSuccess: () => {
      toast.success('Project mapping added');
      setProjectNameInput('');
      setDestinationInput('');
      setCreateFacilities([]);
      refetch();
      qc.invalidateQueries({ queryKey: PROJECT_CATALOG_KEY });
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, facilities }) =>
      catalogFetch(`/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ facilities }),
      }),
    onSuccess: () => {
      toast.success('Project facilities saved');
      setEditingId(null);
      setEditFacilities([]);
      refetch();
      qc.invalidateQueries({ queryKey: PROJECT_CATALOG_KEY });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (id) => catalogFetch(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Project removed — guest site will refresh on next load');
      refetch();
      qc.invalidateQueries({ queryKey: PROJECT_CATALOG_KEY });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteDestinationMutation = useMutation({
    mutationFn: (destination) =>
      catalogFetch(`/projects/destination/${encodeURIComponent(destination)}`, {
        method: 'DELETE',
      }),
    onSuccess: (data, destination) => {
      const units = data?.unitsStillTagged || 0;
      toast.success(
        units > 0
          ? `Deleted “${destination}” from the catalog (${data.deletedCount || 0} projects). ${units} unit(s) still have this area — reassign them if needed.`
          : `Deleted destination “${destination}” and its projects from the site catalog.`
      );
      setSelectedDestination('');
      refetch();
      qc.invalidateQueries({ queryKey: PROJECT_CATALOG_KEY });
    },
    onError: (err) => toast.error(err.message),
  });

  function handleCreate(e) {
    e.preventDefault();
    const destination = String(destinationInput || selectedDestination || '').trim();
    const name = String(projectNameInput || '').trim();
    if (!destination || !name) {
      toast.error('Both destination and project name are required');
      return;
    }
    createMutation.mutate({ destination, name, facilities: createFacilities });
    setSelectedDestination(destination);
  }

  function handleDeleteDestination(destination) {
    const count = (projectsByDestination[destination] || []).length;
    const ok = confirm(
      `Delete destination “${destination}”?\n\nThis removes it and all ${count} project mapping(s) from the catalog.\nIt will disappear from homepage, search, and unit form pickers across the site.`
    );
    if (!ok) return;
    deleteDestinationMutation.mutate(destination);
  }

  function startEditFacilities(row) {
    setEditingId(row.id);
    setEditFacilities(Array.isArray(row.facilities) ? row.facilities : []);
  }

  const selectedItems = items.filter((i) => i.destination === selectedDestination);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Destinations & Projects</h1>
        <p className="page-subtitle">
          Manage destination → project mappings and shared compound facilities. Facilities apply to all units in that project.
        </p>
      </div>

      <form onSubmit={handleCreate} className="card space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Plus className="w-5 h-5 text-primary-600" /> Add mapping
        </h2>
        <div className="form-grid">
          <div>
            <label className="label">Existing destination</label>
            <select
              className="input"
              value={selectedDestination}
              onChange={(e) => setSelectedDestination(e.target.value)}
            >
              <option value="">Select destination…</option>
              {destinations.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Or new destination</label>
            <input
              className="input"
              value={destinationInput}
              onChange={(e) => setDestinationInput(e.target.value)}
              placeholder="e.g. Cairo"
            />
          </div>
          <div className="md:col-span-2">
            <label className="label">Project name *</label>
            <input
              className="input"
              value={projectNameInput}
              onChange={(e) => setProjectNameInput(e.target.value)}
              placeholder="e.g. Marassi"
              required
            />
          </div>
          <TagSelect
            label="Facilities (shared by all units in this project)"
            placeholder="Select or type facilities…"
            suggestions={FACILITY_SUGGESTIONS}
            selectedTags={createFacilities}
            onTagsChange={setCreateFacilities}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
          {createMutation.isPending ? 'Saving…' : 'Add project'}
        </button>
      </form>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="card p-4 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Destinations</p>
          {loadingCatalog ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : destinations.length === 0 ? (
            <p className="text-sm text-gray-400 px-1 py-2">No destinations left.</p>
          ) : (
            destinations.map((d) => (
              <div
                key={d}
                className={`group flex items-center gap-1 rounded-lg ${
                  selectedDestination === d ? 'bg-primary-50' : 'hover:bg-gray-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedDestination(d)}
                  className={`min-w-0 flex-1 text-left rounded-lg px-3 py-2 text-sm font-medium ${
                    selectedDestination === d ? 'text-primary-700' : 'text-gray-700'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <MapPin className="w-4 h-4 shrink-0" />
                    <span className="truncate">{d}</span>
                  </span>
                  <span className="float-right text-xs text-gray-400 ml-2">
                    {(projectsByDestination[d] || []).length}
                  </span>
                </button>
                <button
                  type="button"
                  title={`Delete ${d}`}
                  aria-label={`Delete destination ${d}`}
                  className="mr-1 rounded-lg p-2 text-gray-400 opacity-70 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                  disabled={deleteDestinationMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteDestination(d);
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="card-header flex-wrap gap-3">
            <h2 className="text-lg font-semibold text-gray-900">
              Projects in {selectedDestination || '…'}
            </h2>
            {selectedDestination ? (
              <button
                type="button"
                className="btn-danger btn-sm"
                disabled={deleteDestinationMutation.isPending}
                onClick={() => handleDeleteDestination(selectedDestination)}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete destination
              </button>
            ) : null}
          </div>
          {selectedProjects.length === 0 ? (
            <div className="empty-state">
              <MapPin />
              <p>No projects yet for this destination.</p>
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {selectedItems.map((row) => {
                const facilities = Array.isArray(row.facilities) ? row.facilities : [];
                const isEditing = editingId === row.id;
                return (
                  <div key={row.id} className="rounded-xl border border-gray-100 p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-900">{row.name}</p>
                        <p className="text-xs text-gray-400">{row.destination}</p>
                      </div>
                      <div className="flex gap-2">
                        {!isEditing ? (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => startEditFacilities(row)}
                          >
                            Edit facilities
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn-primary btn-sm"
                              disabled={updateMutation.isPending}
                              onClick={() =>
                                updateMutation.mutate({ id: row.id, facilities: editFacilities })
                              }
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              onClick={() => {
                                setEditingId(null);
                                setEditFacilities([]);
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="btn-sm btn-danger"
                          onClick={() => {
                            if (confirm(`Remove project “${row.name}”?`)) {
                              deleteProjectMutation.mutate(row.id);
                            }
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {isEditing ? (
                      <TagSelect
                        label="Facilities"
                        placeholder="Select or type facilities…"
                        suggestions={FACILITY_SUGGESTIONS}
                        selectedTags={editFacilities}
                        onTagsChange={setEditFacilities}
                      />
                    ) : facilities.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {facilities.map((f) => (
                          <span
                            key={f}
                            className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">No facilities set yet.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
