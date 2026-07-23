import { useState } from 'react';
import { Star } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

const MAX_COMMENT_LENGTH = 500;

export default function AddReviewForm({ onSubmit, submitting = false }) {
  const { t } = useLocale();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  const activeRating = hoverRating || rating;

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!rating) {
      setError(t('listing.needRating'));
      return;
    }

    const trimmedComment = comment.trim();
    if (!trimmedComment) {
      setError(t('listing.needComment'));
      return;
    }

    setError('');
    const success = await onSubmit({ rating, comment: trimmedComment });

    if (success) {
      setRating(0);
      setHoverRating(0);
      setComment('');
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-3xl border border-soul-line bg-white p-5 shadow-[0_20px_50px_-35px_rgba(40,63,94,0.35)]"
    >
      <div className="space-y-2">
        <h3 className="font-display text-lg font-semibold text-soul-blue">{t('listing.addReviewTitle')}</h3>
        <p className="text-sm text-soul-muted">
          {t('listing.addReviewBody')}
        </p>
      </div>

      <div className="flex items-center gap-2" role="radiogroup" aria-label={t('listing.selectRating')}>
        {Array.from({ length: 5 }, (_, index) => {
          const value = index + 1;
          const filled = value <= activeRating;

          return (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value)}
              onMouseEnter={() => setHoverRating(value)}
              onMouseLeave={() => setHoverRating(0)}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                filled
                  ? 'border-amber-300 bg-amber-50 text-amber-500'
                  : 'border-soul-line bg-white text-soul-muted hover:border-amber-300 hover:text-amber-500'
              }`}
              aria-label={t('listing.rateStars', { count: value })}
            >
              <Star className="h-5 w-5" strokeWidth={2} fill={filled ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <label htmlFor="review-comment" className="text-sm font-semibold text-soul-blue">
          {t('listing.comment')}
        </label>
        <textarea
          id="review-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value.slice(0, MAX_COMMENT_LENGTH))}
          rows={4}
          maxLength={MAX_COMMENT_LENGTH}
          placeholder={t('listing.commentPlaceholder')}
          className="w-full rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm text-soul-blue outline-none transition-colors focus:border-soul-blue focus:ring-2 focus:ring-soul-blue/20"
        />
        <p className="text-xs text-soul-muted">
          {comment.length}/{MAX_COMMENT_LENGTH}
        </p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center justify-center rounded-full bg-soul-blue px-6 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:bg-soul-blue-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? t('listing.submitting') : t('listing.postReview')}
      </button>
    </form>
  );
}
