import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import { useAuth } from '../context/AuthContext';
import api from '../api/http';
import ListingCard from '../components/ListingCard';
import { getListingWpId, useWishlist } from '../hooks/useWishlist';

export default function AccountPage() {
  const { user, signOut } = useAuth();
  const [trips, setTrips] = useState([]);

  useEffect(() => {
    if (!user) return;
    api.get('/bookings/mine').then((r) => setTrips(r.data.items || [])).catch(() => {});
  }, [user]);

  if (!user) {
    return (
      <div>
        <Header />
        <main className="mx-auto max-w-md px-5 py-20 text-center">
          <h1 className="font-display text-3xl">Account</h1>
          <Link to="/sign-in" className="inline-block mt-6 btn-pill bg-soul-blue text-white px-5 py-2">Sign in</Link>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-soul px-5 py-10">
        <div className="flex justify-between items-center">
          <h1 className="font-display text-4xl text-soul-blue">Hello{user.email ? `, ${user.email}` : ''}</h1>
          <button onClick={signOut} className="text-sm font-semibold text-soul-muted">Sign out</button>
        </div>
        <h2 className="mt-10 font-display text-2xl">Your trips</h2>
        <div className="mt-4 space-y-3">
          {trips.map((t) => (
            <div key={t.id} className="border border-soul-line rounded-xl p-4">
              <div className="font-medium">{t.listing_title}</div>
              <div className="text-sm text-soul-muted">{t.checkin} → {t.checkout} · {t.status}</div>
            </div>
          ))}
          {!trips.length && <p className="text-soul-muted text-sm">No trips yet.</p>}
        </div>
      </main>
      <Footer />
    </div>
  );
}

export function WishlistPage() {
  const { user } = useAuth();
  const { items, remove } = useWishlist();

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-soul px-5 py-10">
        <h1 className="font-display text-4xl text-soul-blue">Wishlist</h1>
        {!user && items.length > 0 && (
          <p className="mt-2 text-sm text-soul-muted">
            Saved on this device.{' '}
            <Link to="/sign-in" className="font-semibold text-soul-blue underline">
              Sign in
            </Link>{' '}
            to sync across devices.
          </p>
        )}
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((u) => (
            <div key={getListingWpId(u) || u.slug} className="flex flex-col gap-2">
              <ListingCard listing={u} wishlistMode onRemove={() => remove(u)} />
              <button
                type="button"
                onClick={() => remove(u)}
                className="text-sm font-semibold text-soul-muted transition hover:text-[#e0245e]"
              >
                Remove from wishlist
              </button>
            </div>
          ))}
          {!items.length && (
            <p className="text-soul-muted col-span-full">
              Save homes while browsing — sign in to sync across devices.
            </p>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
