import { useMemo } from 'react';
import { Star } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

function ReviewStars({ value }) {
  const { t } = useLocale();
  const rounded = Math.round(Number(value) || 0);

  return (
    <div className="flex items-center gap-1" aria-label={t('listing.starRatingOutOf', { count: rounded })}>
      {Array.from({ length: 5 }, (_, index) => {
        const filled = index + 1 <= rounded;
        return (
          <Star
            key={index}
            className="h-4 w-4 text-amber-500"
            fill={filled ? 'currentColor' : 'none'}
            strokeWidth={2}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
}

export default function UnitReviewsDisplay({
  reviews = [],
  unitAverageRating = 0,
  unitReviewCount = 0,
  loading = false,
  error = '',
}) {
  const { t, localeTag } = useLocale();

  const formatDate = (value) => {
    if (!value) return t('listing.recently');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('listing.recently');
    return date.toLocaleDateString(localeTag);
  };

  const summary = useMemo(() => {
    if (!reviews.length) {
      return {
        averageRating: Number(unitAverageRating || 0),
        reviewCount: Number(unitReviewCount || 0),
      };
    }

    const total = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
    return {
      averageRating: total / reviews.length,
      reviewCount: reviews.length,
    };
  }, [reviews, unitAverageRating, unitReviewCount]);

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border border-soul-line bg-white p-5 shadow-[0_20px_50px_-35px_rgba(40,63,94,0.35)]">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-soul-muted">{t('listing.guestFeedback')}</p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div className="font-num text-3xl font-semibold text-soul-blue">
            {summary.averageRating.toFixed(1)}
          </div>
          <ReviewStars value={summary.averageRating} />
          <p className="pb-1 text-sm text-soul-muted">
            {t('listing.reviewCount', { count: summary.reviewCount })}
          </p>
        </div>
      </div>

      {loading ? <p className="text-sm text-soul-muted">{t('listing.loadingReviews')}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!loading && !error && reviews.length === 0 ? (
        <p className="text-sm text-soul-muted">{t('listing.reviewsEmpty')}</p>
      ) : null}

      {reviews.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {reviews.map((review) => {
            const key = review.id || `${review.guestName}-${review.createdAt}`;
            return (
              <article
                key={key}
                className="rounded-3xl border border-soul-line bg-white p-5 shadow-[0_20px_50px_-35px_rgba(40,63,94,0.35)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-soul-blue">{review.guestName || t('common.guest')}</h4>
                    <p className="text-xs text-soul-muted">{formatDate(review.createdAt || review.created_at)}</p>
                  </div>
                  <ReviewStars value={review.rating} />
                </div>
                <p className="mt-3 text-sm leading-6 text-soul-blue/80">{review.comment}</p>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
