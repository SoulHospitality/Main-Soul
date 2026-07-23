import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import ListingCard, { ListingCardSkeleton } from '../components/ListingCard';
import PropertyFiltersSidebar, {
  FloatingFilterSort,
  MobileSearchPill,
} from '../components/search/PropertyFiltersSidebar';
import { resolveLocationFilter, useProjectCatalog } from '../hooks/useProjectCatalog';
import api from '../api/http';
import { getDisplayPriceEgp } from '../utils/displayPrice';
import { useLocale } from '../context/LocaleContext';

const PAGE_SIZE = 18;

const SORT_KEYS = {
  recommended: 'search.sortRecommended',
  'price-asc': 'search.sortPriceAsc',
  'price-desc': 'search.sortPriceDesc',
  newest: 'search.sortNewest',
};

function buildApiParams(sp, { limit, offset, listingType }) {
  const destination = sp.get('destination') || sp.get('area') || '';
  const compound = sp.get('compound') || sp.get('project') || '';
  const types = sp.get('types') || '';

  return {
    q: sp.get('q') || undefined,
    destination: destination || undefined,
    compound: compound || undefined,
    beds: sp.get('beds') || undefined,
    guests: listingType === 'sale' ? undefined : sp.get('guests') || undefined,
    types: types || undefined,
    listing_type: listingType,
    limit,
    offset,
  };
}

export default function SearchPage({ listingType = 'rent' }) {
  const { t } = useLocale();
  const isSale = listingType === 'sale';
  const basePath = isSale ? '/for-sale' : '/search';
  const [params, setParams] = useSearchParams();
  const { destinations, projectsByDestination } = useProjectCatalog();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const sortLabels = useMemo(
    () =>
      Object.fromEntries(Object.entries(SORT_KEYS).map(([key, labelKey]) => [key, t(labelKey)])),
    [t]
  );
  const sort = SORT_KEYS[params.get('sort')] ? params.get('sort') : 'recommended';
  const nounPlural = isSale ? t('search.properties') : t('search.homes');
  const nounSingular = isSale ? t('search.property') : t('search.home');

  const filterValues = useMemo(
    () => ({
      where:
        params.get('compound') ||
        params.get('project') ||
        params.get('destination') ||
        params.get('area') ||
        params.get('where') ||
        '',
      destination: params.get('destination') || params.get('area') || '',
      compound: params.get('compound') || params.get('project') || '',
      project: params.get('project') || params.get('compound') || '',
      checkin: params.get('checkin') || '',
      checkout: params.get('checkout') || '',
      guests: params.get('guests') || '1',
      beds: params.get('beds') || '',
      types: (params.get('types') || '')
        .split(',')
        .map((t2) => t2.trim())
        .filter(Boolean),
      priceMin: params.get('priceMin') || '',
      priceMax: params.get('priceMax') || '',
    }),
    [params]
  );

  const carryDates = useMemo(
    () => ({
      checkin: params.get('checkin') || undefined,
      checkout: params.get('checkout') || undefined,
      guests: params.get('guests') || undefined,
    }),
    [params]
  );

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!sheetOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get('/units', {
        params: buildApiParams(params, { limit: PAGE_SIZE, offset: 0, listingType }),
      })
      .then((r) => {
        if (cancelled) return;
        setItems(r.data.items || []);
        setTotal(r.data.total || 0);
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params, listingType]);

  const displayed = useMemo(() => {
    let list = [...items];
    const minPrice = Number(params.get('priceMin') || 0);
    const maxPrice = Number(params.get('priceMax') || 0);
    if (minPrice > 0 || maxPrice > 0) {
      list = list.filter((u) => {
        const price = getDisplayPriceEgp(u) || 0;
        if (minPrice > 0 && price < minPrice) return false;
        if (maxPrice > 0 && price > maxPrice) return false;
        return true;
      });
    }
    if (sort === 'price-asc') {
      list.sort(
        (a, b) =>
          (getDisplayPriceEgp(a) ?? Infinity) - (getDisplayPriceEgp(b) ?? Infinity)
      );
    } else if (sort === 'price-desc') {
      list.sort(
        (a, b) => (getDisplayPriceEgp(b) || 0) - (getDisplayPriceEgp(a) || 0)
      );
    } else if (sort === 'newest') {
      list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    }
    return list;
  }, [items, params, sort]);

  const chipDestination =
    params.get('destination') ||
    params.get('area') ||
    resolveLocationFilter(filterValues.where, { destinations, projectsByDestination }).destination ||
    '';
  const projectChips = chipDestination
    ? projectsByDestination[chipDestination] || []
    : [];

  const filterCount = [
    params.get('compound') || params.get('destination') || params.get('area') || params.get('where'),
    !isSale && params.get('checkin'),
    !isSale && params.get('guests') && Number(params.get('guests')) > 1 ? params.get('guests') : null,
    params.get('beds'),
    params.get('types'),
    params.get('priceMin') || params.get('priceMax'),
  ].filter(Boolean).length;

  function applyFilters(next) {
    const sp = new URLSearchParams(params);
    ['compound', 'area', 'where', 'destination', 'project', 'checkin', 'checkout', 'guests', 'beds', 'types', 'priceMin', 'priceMax', 'q'].forEach(
      (k) => sp.delete(k)
    );

    const resolved = resolveLocationFilter(next.where || next.destination || next.compound, {
      destinations,
      projectsByDestination,
    });
    const destination = next.destination || resolved.destination;
    const compound = next.compound !== undefined ? next.compound : resolved.compound;
    if (destination) sp.set('destination', destination);
    if (compound) sp.set('compound', compound);
    if (resolved.q) sp.set('q', resolved.q);
    if (next.checkin) sp.set('checkin', next.checkin);
    if (next.checkout) sp.set('checkout', next.checkout);
    if (next.guests) sp.set('guests', String(next.guests));
    if (next.beds) sp.set('beds', String(next.beds));
    if (Array.isArray(next.types) && next.types.length) {
      sp.set('types', next.types.join(','));
    }
    let min = Number(next.priceMin) || 0;
    let max = Number(next.priceMax) || 0;
    if (min > 0 && max > 0 && min > max) {
      [min, max] = [max, min];
    }
    if (min > 0) sp.set('priceMin', String(min));
    if (max > 0) sp.set('priceMax', String(max));
    sp.delete('page');
    setParams(sp, { replace: true });
  }

  function clearFilters() {
    const sp = new URLSearchParams();
    const sortKeep = params.get('sort');
    if (sortKeep) sp.set('sort', sortKeep);
    setParams(sp);
    setSheetOpen(false);
  }

  function setSort(key) {
    const sp = new URLSearchParams(params);
    if (key === 'recommended') sp.delete('sort');
    else sp.set('sort', key);
    setParams(sp);
  }

  function setCompoundChip(name) {
    const sp = new URLSearchParams(params);
    sp.delete('area');
    sp.delete('where');
    sp.delete('q');
    sp.set('destination', chipDestination);
    if (!name) {
      sp.delete('compound');
      sp.delete('project');
    } else {
      sp.set('compound', name);
    }
    setParams(sp);
  }

  async function showMore() {
    setLoadingMore(true);
    try {
      const r = await api.get('/units', {
        params: buildApiParams(params, {
          limit: PAGE_SIZE,
          offset: items.length,
          listingType,
        }),
      });
      setItems((prev) => [...prev, ...(r.data.items || [])]);
      setTotal(r.data.total ?? total);
    } finally {
      setLoadingMore(false);
    }
  }

  const hasMore = items.length < total;
  const activeCompound = params.get('compound') || '';

  return (
    <div className="min-h-screen bg-[#faf9f7]">
      <Header />

      {/* Mobile sticky summary */}
      <div className="sticky top-[88px] z-30 border-b border-soul-line bg-white/90 px-4 py-3 backdrop-blur-md lg:hidden">
        <MobileSearchPill
          values={filterValues}
          filterCount={filterCount}
          mode={listingType}
          onOpen={() => setSheetOpen(true)}
        />
      </div>

      <div className="mx-auto grid max-w-soul gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:py-8 xl:grid-cols-[300px_minmax(0,1fr)]">
        <PropertyFiltersSidebar
          values={filterValues}
          onApply={applyFilters}
          onClear={clearFilters}
          mode={listingType}
        />

        <main className="min-w-0 pb-24 lg:pb-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-semibold text-soul-blue sm:text-3xl">
                {filterValues.where
                  ? isSale
                    ? t('search.forSaleIn', { where: filterValues.where })
                    : t('search.staysIn', { where: filterValues.where })
                  : isSale
                    ? t('search.propertiesForSale')
                    : t('search.allStays')}
              </h1>
              <p className="mt-1 text-sm text-soul-muted">
                {loading
                  ? t('common.loading')
                  : t('search.available', { count: total, noun: total === 1 ? nounSingular : nounPlural })}
              </p>
            </div>

            <div className="relative hidden sm:block">
              <button
                type="button"
                onClick={() => setSortOpen((o) => !o)}
                className="inline-flex items-center gap-2 rounded-full border border-soul-line bg-white px-3.5 py-2 text-[13.5px] font-semibold text-soul-blue hover:border-soul-blue"
              >
                {t('search.sortPrefix', { label: t(SORT_KEYS[sort]) })} ▾
              </button>
              {sortOpen && (
                <div className="absolute end-0 top-full z-40 mt-2 min-w-[220px] rounded-[14px] border border-soul-line bg-white p-1.5 shadow-[0_18px_50px_rgba(40,63,94,0.16)]">
                  {Object.entries(SORT_KEYS).map(([key, labelKey]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setSort(key);
                        setSortOpen(false);
                      }}
                      className={`block w-full rounded-[10px] px-3.5 py-2 text-start text-sm font-medium ${
                        sort === key
                          ? 'bg-soul-blue-50 font-semibold text-soul-blue'
                          : 'hover:bg-soul-blue-50/60'
                      }`}
                    >
                      {t(labelKey)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {projectChips.length > 0 && (
            <div className="mb-5 flex gap-1.5 overflow-x-auto whitespace-nowrap pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Chip active={!activeCompound} onClick={() => setCompoundChip('')}>
                {t('search.allDestination', { destination: chipDestination })}
              </Chip>
              {projectChips.map((name) => (
                <Chip
                  key={name}
                  active={activeCompound.toLowerCase() === name.toLowerCase()}
                  onClick={() => setCompoundChip(name)}
                >
                  {name}
                </Chip>
              ))}
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <ListingCardSkeleton key={i} />
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="mx-auto max-w-md py-16 text-center">
              <h3 className="font-display text-2xl font-semibold text-soul-blue">
                {isSale ? t('search.emptySale') : t('search.emptyHomes')}
              </h3>
              <p className="mb-5 mt-2 leading-relaxed text-soul-muted">
                {isSale
                  ? t('search.emptyHintSale')
                  : t('search.emptyHintRent')}
                {total > 0 ? ` ${t('search.liveOverall', { count: total, noun: nounPlural })}` : ''}
              </p>
              <Link
                to={basePath}
                className="inline-block rounded-full bg-soul-blue px-5 py-2.5 font-semibold text-white"
              >
                {t('search.resetFilters')}
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {displayed.map((u) => (
                  <ListingCard key={u.id} listing={u} carryDates={carryDates} />
                ))}
              </div>

              <div className="mt-12 flex flex-col items-center gap-3">
                {hasMore && (
                  <button
                    type="button"
                    onClick={showMore}
                    disabled={loadingMore}
                    className="rounded-full border border-soul-blue bg-white px-6 py-3 text-sm font-semibold text-soul-blue transition-colors hover:bg-soul-blue hover:text-white disabled:cursor-default disabled:opacity-60"
                  >
                    {loadingMore ? t('common.loading') : t('search.showMore')}
                  </button>
                )}
                <span className="text-sm text-soul-muted">
                  {hasMore
                    ? t('search.showingOf', { shown: displayed.length, total, noun: nounPlural })
                    : t('search.showingAll', { count: displayed.length, noun: nounPlural })}
                </span>
              </div>
            </>
          )}
        </main>
      </div>

      <FloatingFilterSort
        filterCount={filterCount}
        sort={sort}
        sortLabels={sortLabels}
        onOpenFilters={() => setSheetOpen(true)}
        onSort={setSort}
      />

      {sheetOpen && (
        <PropertyFiltersSidebar
          variant="sheet"
          values={filterValues}
          onApply={applyFilters}
          onClear={clearFilters}
          onClose={() => setSheetOpen(false)}
          mode={listingType}
        />
      )}

      <Footer />
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-block flex-none rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
        active
          ? 'border-soul-blue bg-soul-blue-50 text-soul-blue'
          : 'border-soul-line bg-white text-soul-blue hover:border-soul-blue'
      }`}
    >
      {children}
    </button>
  );
}
