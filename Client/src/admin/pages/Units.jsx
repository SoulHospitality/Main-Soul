import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Building2, BedDouble, Bath, Layers, Eye, ExternalLink, DollarSign } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { usePermissions } from '../hooks/usePermissions';
import { useSortableTable } from '../hooks/useSortableTable';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import SortTh from '../components/ui/SortTh';
import { currency, UNIT_TYPES, normalizePropertyType } from '../utils/formatters';
import SearchableSelect from '../components/ui/SearchableSelect';
import { useProjectCatalog } from '../../hooks/useProjectCatalog';
import { AREAS, COMPOUNDS } from '../../data/compounds';
import { normalizeProjectName } from '../../utils/projectNames';
import {
  beachAccessFormDefaults,
  beachAccessRequiresManualEntry,
  isFreeBeachProject,
} from '../../utils/beachAccess';
import { isGaiaUnit } from '../../utils/bookingRules';
import TagSelect from '../components/ui/TagSelect';

const FALLBACK_PROJECTS_BY_DEST = COMPOUNDS.reduce((acc, c) => {
  if (!acc[c.area]) acc[c.area] = [];
  if (!acc[c.area].includes(c.name)) acc[c.area].push(c.name);
  return acc;
}, {});

const COMMISSION_MODES = [
  { value: 'A', label: 'Fixed Rate', desc: 'Commission = nightly rate × % (all bookings)' },
  { value: 'B', label: 'Split Rate', desc: 'Nightly rate × owner % + nightly rate × tenant %' },
  { value: 'C', label: 'Source-Based', desc: 'Nightly rate × via-us/via-owner % (+ tenant %)' },
];

const VIEW_OPTIONS = [
  'Sea view',
  'Pool view',
  'Double View (Sea and Pool)',
  'Side view',
  'Street view',
  'Back View',
  'Garden View',
  'Lagoon View',
];

const BEACH_ACCESS_PERIODS = [
  { value: 1, label: 'Every 1 day' },
  { value: 3, label: 'Every 3 days' },
  { value: 7, label: 'Every 7 days' },
  { value: 14, label: 'Every 14 days' },
];

/** In-unit amenity suggestions for new units (existing published amenities are unchanged). */
const AMENITY_SUGGESTIONS = [
  'Wi-Fi',
  'Bed Lines',
  'Beach Access',
  'Cooking Basics',
  'Free Parking',
  'Heating',
  'Stove',
  'Microwave',
  'Hot Watter Kettls',
  'Refrigerator',
  'Air conditioning',
  'Smart TV',
  'Washer',
  'Dryer',
  'Dishwasher',
  'Oven',
  'Coffee maker',
  'Toaster',
  'Blender',
  'Dining table',
  'Private balcony',
  'Private terrace',
  'Blackout curtains',
  'Extra pillows and blankets',
  'Hangers',
  'Iron',
  'Hair dryer',
  'Shampoo',
  'Body soap',
  'Hot water',
  'Bathtub',
  'Shower',
  'Bidet',
  'Dedicated workspace',
  'Safe',
  'Elevator access',
  'Ground-floor access',
  'Keyless smart lock',
  'Self check-in',
  'Kitchenette',
  'Full kitchen',
  'Outdoor dining area',
  'BBQ grill',
  'Private pool access',
  'Housekeeping available',
];

const FLOOR_OPTIONS = [
  { value: 0, label: 'Ground' },
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: 5, label: '5th' },
];

const EMPTY_FORM = {
  name: '', destination: '', project: '', unit_number: '', type: 'Apartment',
  bedrooms: 1, bathrooms: 1, floor: 0, guests: 2,
  owner_name: '', owner_email: '', owner_phone: '',
  commission_mode: 'A',
  company_commission_pct: 20,
  company_commission_owner_pct: 10,
  commission_tenant_pct: 0,
  photo_urls: [],
  photos_folder_url: '',
  price_per_night: '',
  utilities_cost: '',
  ops_status: 'available',
  listing_status: 'published',
  view: '',
  description: '',
  amenities: [],
  location_link: '',
  beach_access_price: '',
  beach_access_days: 7,
  beach_access_extra_guest: '',
  unit_area: '',
};

/** Capacity rule: studio (0 BR) → 2 guests; otherwise 2 × bedrooms. */
function guestsFromBedrooms(bedrooms) {
  const n = Number(bedrooms);
  if (!Number.isFinite(n) || n <= 0) return 2;
  return Math.round(n) * 2;
}

function toTagList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function CommissionSection({ form, setForm }) {
  const mode = form.commission_mode;
  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-4">
      <div>
        <label className="label">Commission Structure</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
          {COMMISSION_MODES.map(m => (
            <button
              key={m.value}
              type="button"
              onClick={() => setForm(f => ({ ...f, commission_mode: m.value }))}
              className={`text-left px-3 py-2.5 rounded-lg border-2 transition-colors ${
                mode === m.value
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className={`text-xs font-bold ${mode === m.value ? 'text-primary-700' : 'text-gray-700'}`}>
                Mode {m.value} — {m.label}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{m.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="form-grid">
        {mode === 'A' && (
          <div>
            <label className="label">Commission % (All Bookings)</label>
            <input type="number" min="0" max="100" step="0.5" className="input"
              value={form.company_commission_pct}
              onChange={e => setForm(f => ({ ...f, company_commission_pct: e.target.value }))} />
          </div>
        )}

        {mode === 'B' && (
          <>
            <div>
              <label className="label">Owner Commission %</label>
              <input type="number" min="0" max="100" step="0.5" className="input"
                value={form.company_commission_pct}
                onChange={e => setForm(f => ({ ...f, company_commission_pct: e.target.value }))} />
            </div>
            <div>
              <label className="label">Tenant Commission %</label>
              <input type="number" min="0" max="100" step="0.5" className="input"
                value={form.commission_tenant_pct}
                onChange={e => setForm(f => ({ ...f, commission_tenant_pct: e.target.value }))} />
            </div>
          </>
        )}

        {mode === 'C' && (
          <>
            <div>
              <label className="label">Owner Commission % — Via Us</label>
              <input type="number" min="0" max="100" step="0.5" className="input"
                value={form.company_commission_pct}
                onChange={e => setForm(f => ({ ...f, company_commission_pct: e.target.value }))} />
            </div>
            <div>
              <label className="label">Owner Commission % — Via Owner</label>
              <input type="number" min="0" max="100" step="0.5" className="input"
                value={form.company_commission_owner_pct}
                onChange={e => setForm(f => ({ ...f, company_commission_owner_pct: e.target.value }))} />
            </div>
            <div>
              <label className="label">Tenant Commission %</label>
              <input type="number" min="0" max="100" step="0.5" className="input"
                value={form.commission_tenant_pct}
                onChange={e => setForm(f => ({ ...f, commission_tenant_pct: e.target.value }))} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function UnitForm({ form, setForm, listingType = 'rent' }) {
  const { isAdmin, canManageUnits } = usePermissions();
  const canSeeOwner = isAdmin || canManageUnits;
  const isSale = listingType === 'sale';
  const { destinations, projectsByDestination } = useProjectCatalog();
  const effectiveDestinations = destinations.length ? destinations : AREAS;
  const catalogProjects = projectsByDestination[form.destination] || [];
  const fallbackProjects = FALLBACK_PROJECTS_BY_DEST[form.destination] || [];
  const projectOptions = catalogProjects.length ? catalogProjects : fallbackProjects;
  const projectCtx = { project: form.project, compound: form.project, listing_type: listingType };
  const showBeachFields = !isSale && beachAccessRequiresManualEntry(projectCtx);
  const gaiaProject = !isSale && isGaiaUnit(projectCtx);
  const freeBeach = !isSale && isFreeBeachProject(projectCtx);

  function applyProjectChange(project) {
    const beachDefaults = beachAccessFormDefaults(project);
    setForm((f) => ({
      ...f,
      project,
      compound: project,
      ...(beachDefaults || {}),
    }));
  }

  return (
    <div className="space-y-4">
      <div className="form-grid">
        <div><label className="label">Unit Name *</label><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Marina Heights A101" /></div>
        <div>
          <label className="label">Destination *</label>
          <select
            className="input"
            value={form.destination || ''}
            onChange={(e) => setForm((f) => ({
              ...f,
              destination: e.target.value,
              area: e.target.value,
              project: '',
            }))}
          >
            <option value="">Select destination…</option>
            {effectiveDestinations.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
            {form.destination && !effectiveDestinations.includes(form.destination) && (
              <option value={form.destination}>{form.destination}</option>
            )}
          </select>
        </div>
        <div>
          <label className="label">Project *</label>
          <select
            className="input"
            value={form.project || ''}
            onChange={(e) => applyProjectChange(e.target.value)}
            disabled={!form.destination}
          >
            <option value="">{form.destination ? 'Select project…' : 'Pick destination first'}</option>
            {projectOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
            {form.project && !projectOptions.includes(form.project) && (
              <option value={form.project}>{form.project}</option>
            )}
          </select>
        </div>
        <div><label className="label">Unit Number *</label><input className="input" value={form.unit_number} onChange={e => setForm(f => ({ ...f, unit_number: e.target.value }))} placeholder="e.g. A101" /></div>
        <div>
          <label className="label">Type *</label>
          <SearchableSelect value={form.type} onChange={v => setForm(f => ({ ...f, type: v }))}
            placeholder="Select type…"
            options={UNIT_TYPES.map(t => ({ value: t, label: t }))}
          />
        </div>
        <div>
          <label className="label">View</label>
          <select className="input" value={form.view || ''} onChange={e => setForm(f => ({ ...f, view: e.target.value }))}>
            <option value="">Select view…</option>
            {VIEW_OPTIONS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Bedrooms</label>
          <input
            type="number"
            min="0"
            className="input"
            value={form.bedrooms}
            onChange={(e) => {
              const bedrooms = e.target.value;
              setForm((f) => ({ ...f, bedrooms, guests: guestsFromBedrooms(bedrooms) }));
            }}
          />
        </div>
        <div><label className="label">Bathrooms</label><input type="number" min="0" className="input" value={form.bathrooms} onChange={e => setForm(f => ({ ...f, bathrooms: e.target.value }))} /></div>
        <div>
          <label className="label">Floor</label>
          <select
            className="input"
            value={FLOOR_OPTIONS.some((o) => String(o.value) === String(form.floor)) ? form.floor : 0}
            onChange={(e) => setForm((f) => ({ ...f, floor: Number(e.target.value) }))}
          >
            {FLOOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Guests / capacity</label>
          <input type="number" className="input bg-gray-50" value={guestsFromBedrooms(form.bedrooms)} readOnly />
          <p className="text-xs text-gray-400 mt-1">Auto: 2 × bedrooms (studio = 2)</p>
        </div>
        {isSale ? (
          <div>
            <label className="label">Area (m²) *</label>
            <input
              type="number"
              min="1"
              step="1"
              className="input"
              value={form.unit_area}
              onChange={(e) => setForm((f) => ({ ...f, unit_area: e.target.value }))}
              placeholder="e.g. 145"
            />
          </div>
        ) : (
          <>
            <div>
              <label className="label">Fallback nightly (EGP)</label>
              <input type="number" min="0" step="0.01" className="input" value={form.price_per_night} onChange={e => setForm(f => ({ ...f, price_per_night: e.target.value }))} placeholder="Display price per night" />
            </div>
            <div>
              <label className="label">Utilities Cost Per Night (EGP)</label>
              <input type="number" min="0" step="0.01" className="input" value={form.utilities_cost} onChange={e => setForm(f => ({ ...f, utilities_cost: e.target.value }))} placeholder="0.00" />
            </div>
            {showBeachFields ? (
              <>
                <div>
                  <label className="label">Beach access price (EGP)</label>
                  <input type="number" min="0" step="0.01" className="input" value={form.beach_access_price} onChange={e => setForm(f => ({ ...f, beach_access_price: e.target.value }))} placeholder="Per person / period" />
                </div>
                <div>
                  <label className="label">Beach access period</label>
                  <select
                    className="input"
                    value={form.beach_access_days || 7}
                    onChange={e => setForm(f => ({ ...f, beach_access_days: Number(e.target.value) }))}
                  >
                    {BEACH_ACCESS_PERIODS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Beach access — extra guest (EGP)</label>
                  <input type="number" min="0" step="0.01" className="input" value={form.beach_access_extra_guest} onChange={e => setForm(f => ({ ...f, beach_access_extra_guest: e.target.value }))} placeholder="Per extra guest / period" />
                </div>
              </>
            ) : gaiaProject ? (
              <div className="sm:col-span-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
                <strong>GAIA beach access</strong> is automatic by stay length (no fields needed):
                3 nights → 1,900 / extra 2,500 · 4 nights → 2,500 / extra 3,100 · 5+ nights → 3,500 / extra 4,100 (per 7 nights).
              </div>
            ) : freeBeach ? (
              <div className="sm:col-span-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
                <strong>Free beach access</strong> for this project (Hacienda West / D-Bay). No beach fees are charged.
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="border-t border-gray-100 pt-4 space-y-3">
        <h4 className="text-sm font-semibold text-gray-700">{isSale ? 'Listing details' : 'Guest listing'}</h4>
        <div>
          <label className="label">Description</label>
          <textarea className="input resize-none" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="The property…" />
        </div>
        <div className="form-grid">
          <TagSelect
            label="Amenities"
            placeholder="Select or type amenities…"
            suggestions={AMENITY_SUGGESTIONS}
            selectedTags={form.amenities || []}
            onTagsChange={(tags) => setForm((f) => ({ ...f, amenities: tags }))}
          />
          <p className="sm:col-span-2 text-xs text-gray-400 -mt-2">
            Compound facilities are managed on Destinations → project (shared by all units in that project).
          </p>
          <div className="sm:col-span-2">
            <label className="label">Location / maps link</label>
            <input type="url" className="input" value={form.location_link} onChange={e => setForm(f => ({ ...f, location_link: e.target.value }))} placeholder="https://maps.google.com/…" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Google Drive folder (photos)</label>
            <input
              type="url"
              className="input"
              value={form.photos_folder_url || ''}
              onChange={(e) => setForm((f) => ({ ...f, photos_folder_url: e.target.value }))}
              placeholder="https://drive.google.com/drive/folders/…"
            />
            <p className="text-xs text-gray-400 mt-1">
              Folder must be shared as “Anyone with the link”. On save we load all images inside into the listing gallery.
            </p>
            {!!form.photo_urls?.length && (
              <p className="text-xs text-emerald-700 mt-1">{form.photo_urls.length} photo{form.photo_urls.length === 1 ? '' : 's'} currently linked</p>
            )}
          </div>
        </div>
      </div>

      {canSeeOwner && (
        <div className="border-t border-gray-100 pt-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Owner Details</h4>
          <div className="form-grid">
            <div><label className="label">Owner Name</label><input className="input" value={form.owner_name} onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))} /></div>
            <div><label className="label">Owner Email</label><input type="email" className="input" value={form.owner_email} onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))} /></div>
            <div><label className="label">Owner Phone</label><input className="input" value={form.owner_phone} onChange={e => setForm(f => ({ ...f, owner_phone: e.target.value }))} /></div>
          </div>
        </div>
      )}

      <div className="border-t border-gray-100 pt-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Commission Structure</h4>
        <CommissionSection form={form} setForm={setForm} />
      </div>

      <div className="border-t border-gray-100 pt-4">
        <div className="form-grid">
          <div>
            <label className="label">Ops status</label>
            <SearchableSelect value={form.ops_status} onChange={v => setForm(f => ({ ...f, ops_status: v }))}
              options={[{ value: 'available', label: 'Available' }, { value: 'occupied', label: 'Occupied' }, { value: 'maintenance', label: 'Maintenance' }]}
            />
          </div>
          <div>
            <label className="label">Listing status</label>
            <div className="input bg-gray-50 text-sm text-gray-700 flex items-center">
              Auto — published when every field is filled, otherwise draft
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Status is set automatically. Missing required fields keeps the unit as draft and hidden from guests. GAIA and free-beach projects do not need beach access fields.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommissionBadge({ unit }) {
  const mode = unit.commission_mode || 'A';
  if (mode === 'A') return <span className="text-xs text-gray-500">Fixed: <strong className="text-gray-700">{unit.company_commission_pct}%</strong></span>;
  if (mode === 'B') return <span className="text-xs text-gray-500">Owner: <strong className="text-gray-700">{unit.company_commission_pct}%</strong> · Tenant: <strong className="text-gray-700">{unit.commission_tenant_pct || 0}%</strong></span>;
  return <span className="text-xs text-gray-500">Via Us: <strong className="text-gray-700">{unit.company_commission_pct}%</strong> · Via Owner: <strong className="text-gray-700">{unit.company_commission_owner_pct || 10}%</strong> · Tenant: <strong className="text-gray-700">{unit.commission_tenant_pct || 0}%</strong></span>;
}

export default function Units({ listingType = 'rent' }) {
  const qc = useQueryClient();
  const { canDeleteUnits, canManageUnits, isResale } = usePermissions();
  const isSale = listingType === 'sale';
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterBedrooms, setFilterBedrooms] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const [handoffUnit, setHandoffUnit] = useState(null);

  const { data: units = [], isLoading } = useQuery({
    queryKey: ['units', listingType, search, filterStatus, filterProject, filterBedrooms],
    queryFn: () => api.get('/units', {
      params: {
        listing_type: listingType,
        search: search || undefined,
        status: filterStatus || undefined,
        project: filterProject || undefined,
        bedrooms: filterBedrooms || undefined,
      },
    }).then(r => r.data),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['unit-projects'],
    queryFn: () => api.get('/units/projects').then(r => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const res = editId
        ? await api.put(`/units/${editId}`, data)
        : await api.post('/units', data);
      return res.data;
    },
    onSuccess: (unit) => {
      qc.invalidateQueries({ queryKey: ['units'] });
      qc.invalidateQueries({ queryKey: ['unit-projects'] });
      const n = unit?.photo_urls?.length || 0;
      const missing = unit?.listing_completeness?.missing || [];
      if (unit?.status === 'draft' && missing.length) {
        toast.success(
          `Saved as draft (hidden from guests). Missing: ${missing.join(', ')}`
        );
        if (unit?.id) setHandoffUnit(unit);
      } else if (unit?.status === 'published') {
        toast.success(
          editId
            ? (n ? `Unit published · ${n} photos from Drive` : 'Unit published')
            : (n ? `Unit created & published · ${n} photos from Drive` : 'Unit created & published')
        );
        setHandoffUnit(null);
      } else {
        toast.success(
          editId
            ? (n ? `Unit updated · ${n} photos from Drive` : 'Unit updated')
            : (n ? `Unit created · ${n} photos from Drive` : 'Unit created as draft')
        );
        if (unit?.id && unit.status === 'draft') setHandoffUnit(unit);
      }
      setModal(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving unit'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/units/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['units'] }); toast.success('Unit deleted'); setDeleteId(null); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error deleting unit'),
  });

  const openAdd = () => {
    setForm({
      ...EMPTY_FORM,
      amenities: [],
      photo_urls: [],
    });
    setEditId(null);
    setModal('add');
  };
  const openEdit = (u) => {
    setEditId(u.id);
    setForm({
      ...EMPTY_FORM,
      ...u,
      name: u.name || u.title || '',
      destination: u.destination || u.area || '',
      project: u.project || u.compound || '',
      type: normalizePropertyType(u.type || u.property_type || 'Apartment'),
      bedrooms: u.bedrooms ?? u.beds ?? 1,
      bathrooms: u.bathrooms ?? u.baths ?? 1,
      floor: u.floor ?? 0,
      description: u.description || u.the_property || '',
      amenities: toTagList(u.amenities),
      location_link: u.location_link || u.source_url || '',
      photos_folder_url: u.photos_folder_url || '',
      photo_urls: Array.isArray(u.photo_urls) ? u.photo_urls : [],
      price_per_night: u.price_per_night ?? u.price_fallback ?? '',
      utilities_cost: u.utilities_cost ?? '',
      beach_access_price: u.beach_access_price ?? u.access_fee_per_adult_egp ?? '',
      beach_access_days: u.beach_access_days ?? u.access_card_count_included ?? 7,
      beach_access_extra_guest: u.beach_access_extra_guest ?? u.access_fee_per_teen_egp ?? '',
      unit_area: u.unit_area ?? u.size_m2 ?? '',
      ops_status: u.ops_status || 'available',
    });
    setModal('edit');
  };
  const handleSave = () => {
    if (!String(form.name || '').trim()) {
      toast.error('Unit name is required');
      return;
    }
    if (!String(form.destination || '').trim()) {
      toast.error('Destination is required');
      return;
    }
    if (!String(form.project || '').trim()) {
      toast.error('Project is required');
      return;
    }
    if (isSale && !(Number(form.unit_area) > 0)) {
      toast.error('Area (m²) is required for sale units');
      return;
    }
    const projectName = normalizeProjectName(form.project);
    const beachDefaults = !isSale ? beachAccessFormDefaults(projectName) : null;
    const beachPrice = isSale
      ? null
      : beachDefaults
        ? (beachDefaults.beach_access_price === '' ? null : beachDefaults.beach_access_price)
        : (form.beach_access_price === '' ? null : form.beach_access_price);
    const beachExtra = isSale
      ? null
      : beachDefaults
        ? (beachDefaults.beach_access_extra_guest === '' ? null : beachDefaults.beach_access_extra_guest)
        : (form.beach_access_extra_guest === '' ? null : form.beach_access_extra_guest);
    const beachDays = isSale
      ? null
      : beachDefaults
        ? beachDefaults.beach_access_days
        : (form.beach_access_days === '' ? null : form.beach_access_days);

    const { facilities: _omitFacilities, ...formRest } = form;
    saveMutation.mutate({
      ...formRest,
      listing_type: listingType,
      title: form.name,
      name: form.name,
      destination: form.destination,
      area: form.destination,
      project: projectName,
      compound: projectName,
      projectName,
      status: undefined,
      ops_status: form.ops_status,
      property_type: normalizePropertyType(form.type),
      type: normalizePropertyType(form.type),
      bedrooms: form.bedrooms,
      beds: form.bedrooms,
      guests: guestsFromBedrooms(form.bedrooms),
      capacity: guestsFromBedrooms(form.bedrooms),
      the_property: form.description,
      description: form.description,
      amenities: form.amenities,
      photos_folder_url: form.photos_folder_url || '',
      unit_area: isSale ? form.unit_area : null,
      size_m2: isSale ? form.unit_area : form.unit_area || null,
      access_fee_per_adult_egp: isSale ? null : beachPrice,
      access_fee_per_teen_egp: isSale ? null : beachExtra,
      access_card_count_included: isSale ? null : beachDays,
      beach_access_price: isSale ? null : beachPrice,
      beach_access_days: isSale ? null : beachDays,
      beach_access_extra_guest: isSale ? null : beachExtra,
      price_per_night: isSale ? null : (form.price_per_night === '' ? null : form.price_per_night),
      utilities_cost: isSale ? null : (form.utilities_cost === '' ? null : form.utilities_cost),
    });
  };
  const canWrite = canManageUnits;
  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(units, 'name', 'asc');

  return (
    <div className="space-y-6">
      {handoffUnit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong>{handoffUnit.name || handoffUnit.title}</strong> saved as draft
            {handoffUnit.listing_completeness?.missing?.length
              ? ` (missing: ${handoffUnit.listing_completeness.missing.join(', ')})`
              : ''}. Complete the listing{isSale ? '' : ', then it can appear to guests'}.
          </span>
          <div className="flex gap-2">
            <button type="button" className="text-xs underline" onClick={() => setHandoffUnit(null)}>Dismiss</button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">{isSale ? (isResale ? 'Units' : 'Units for Sale') : 'Units'}</h1>
          <p className="page-subtitle">
            {units.length} {isSale ? 'for-sale' : ''} unit{units.length !== 1 ? 's' : ''}
            {isSale ? ' · managed by resale' : ' for rent'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button onClick={() => setViewMode('grid')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Grid</button>
            <button onClick={() => setViewMode('table')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${viewMode === 'table' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Table</button>
          </div>
          {canWrite && <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" />Add Unit</button>}
        </div>
      </div>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search units, projects, owners...">
        <SearchableSelect className="w-40" value={filterStatus} onChange={setFilterStatus}
          placeholder="All Status"
          options={[
            { value: '', label: 'All Status' },
            { value: 'draft', label: 'Draft' },
            { value: 'published', label: 'Published' },
            { value: 'available', label: 'Ops: Available' },
            { value: 'occupied', label: 'Ops: Occupied' },
            { value: 'maintenance', label: 'Ops: Maintenance' },
          ]}
        />
        <SearchableSelect className="w-44" value={filterProject} onChange={setFilterProject}
          placeholder="All Projects"
          options={[{ value: '', label: 'All Projects' }, ...projects.map(p => ({ value: p, label: p }))]}
        />
        <SearchableSelect className="w-36" value={filterBedrooms} onChange={setFilterBedrooms}
          placeholder="All Bedrooms"
          options={[{ value: '', label: 'All Bedrooms' }, ...[0,1,2,3,4,5,6].map(n => ({ value: String(n), label: n === 0 ? 'Studio' : `${n} BR` }))]}
        />
      </SearchFilter>

      {isLoading ? <LoadingSpinner /> : units.length === 0 ? (
        <EmptyState icon={Building2} title="No units found" subtitle="Add your first unit to get started"
          action={canWrite && <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" />Add Unit</button>} />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {units.map(u => (
            <div key={u.id} className="card hover:shadow-md transition-shadow p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900 text-base">{u.name || u.title}</h3>
                  <p className="text-sm text-gray-500">{u.project}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge status={u.status} />
                  {u.ops_status && <span className="text-[10px] uppercase text-gray-400">{u.ops_status}</span>}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm text-gray-600 mb-3">
                <div className="flex items-center gap-1.5"><BedDouble className="w-4 h-4 text-gray-400" />{u.bedrooms ?? u.beds} bed</div>
                <div className="flex items-center gap-1.5"><Bath className="w-4 h-4 text-gray-400" />{u.bathrooms ?? u.baths} bath</div>
                <div className="flex items-center gap-1.5"><Layers className="w-4 h-4 text-gray-400" />{parseInt(u.floor) === 0 ? 'Ground' : `Floor ${u.floor}`}</div>
              </div>
              {u.view && (
                <div className="flex items-center gap-1.5 text-xs text-blue-600 font-medium mb-2">
                  <Eye className="w-3.5 h-3.5" />{u.view}
                </div>
              )}
              {(isSale
                ? (u.unit_area || u.size_m2 || u.area_sqft)
                : (u.price_per_night > 0 || u.price_fallback > 0)) && (
                <div className="flex items-center gap-1.5 text-sm text-emerald-700 font-medium mb-2">
                  {isSale ? (
                    <>{u.unit_area || u.size_m2 || u.area_sqft} m²</>
                  ) : (
                    <><DollarSign className="w-4 h-4" />{currency(u.price_per_night || u.price_fallback)} / night</>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <CommissionBadge unit={u} />
                <div className="flex items-center gap-1">
                  {(u.cover_url || u.photo_urls?.[0]) && (
                    <a href={u.cover_url || u.photo_urls[0]} target="_blank" rel="noreferrer"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors" title="View Photos">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  {canWrite && <button onClick={() => openEdit(u)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"><Edit2 className="w-4 h-4" /></button>}
                  {canDeleteUnits && <button onClick={() => setDeleteId(u.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"><Trash2 className="w-4 h-4" /></button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <SortTh col="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Unit</SortTh>
                  <SortTh col="project" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Project</SortTh>
                  <SortTh col="type" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Type</SortTh>
                  <th>Beds/Bath</th>
                  <SortTh col={isSale ? 'size_m2' : 'price_per_night'} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    {isSale ? 'Area (m²)' : 'Price/Night'}
                  </SortTh>
                  <SortTh col="owner_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Owner</SortTh>
                  <th>Commission</th><th>Photos</th>
                  <SortTh col="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Status</SortTh>
                  {canWrite && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {sorted.map(u => (
                  <tr key={u.id}>
                    <td className="font-medium">{u.name || u.title}</td>
                    <td>{u.project}</td>
                    <td>{u.type || u.property_type}</td>
                    <td>{u.bedrooms ?? u.beds}B/{u.bathrooms ?? u.baths}Ba</td>
                    <td>
                      {isSale
                        ? ((u.unit_area || u.size_m2 || u.area_sqft) ? `${u.unit_area || u.size_m2 || u.area_sqft} m²` : '—')
                        : ((u.price_per_night || u.price_fallback) > 0 ? currency(u.price_per_night || u.price_fallback) : '—')}
                    </td>
                    <td>{u.owner_name || '—'}</td>
                    <td><CommissionBadge unit={u} /></td>
                    <td>
                      {(u.cover_url || u.photo_urls?.[0])
                        ? <a href={u.cover_url || u.photo_urls[0]} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline text-xs flex items-center gap-1"><ExternalLink className="w-3 h-3" />View</a>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td><Badge status={u.status} /></td>
                    {canWrite && (
                      <td>
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(u)} className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50"><Edit2 className="w-3.5 h-3.5" /></button>
                          {canDeleteUnits && <button onClick={() => setDeleteId(u.id)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={modal === 'add' || modal === 'edit'}
        onClose={() => setModal(null)}
        title={modal === 'edit'
          ? (isSale ? 'Edit Sale Unit' : 'Edit Unit')
          : (isSale ? 'Add Unit for Sale' : 'Add New Unit')}
        size="lg"
        footer={<>
          <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending || !form.name || !form.destination || !form.project || (isSale && !form.unit_area)}
            className="btn-primary"
          >
            {saveMutation.isPending ? 'Saving...' : modal === 'edit' ? 'Save Changes' : (isSale ? 'Create sale unit' : 'Create draft')}
          </button>
        </>}
      >
        <UnitForm form={form} setForm={setForm} listingType={listingType} />
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending} title="Delete Unit"
        message="Permanently delete this unit? Related reservations and unit data will be removed. This cannot be undone." confirmText="Delete" danger />
    </div>
  );
}
