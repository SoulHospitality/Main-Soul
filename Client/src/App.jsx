import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CurrencyProvider } from './context/CurrencyContext';
import RouteFallback from './components/RouteFallback';
import WhatsAppFAB from './components/layout/WhatsAppFAB';

const HomePage = lazy(() => import('./pages/HomePage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const ListingDetailPage = lazy(() => import('./pages/ListingDetailPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const PaymentPage = lazy(() => import('./pages/PaymentPage'));
const PaymentCallbackPage = lazy(() => import('./pages/PaymentCallbackPage'));
const BookingSuccessPage = lazy(() => import('./pages/BookingSuccessPage'));
const SignInPage = lazy(() => import('./pages/SignInPage'));
const SignUpPage = lazy(() => import('./pages/SignUpPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const WishlistPage = lazy(() =>
  import('./pages/AccountPage').then((m) => ({ default: m.WishlistPage }))
);
const CareersPage = lazy(() => import('./pages/CareersPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const SalesRoutes = lazy(() => import('./pages/sales/SalesRoutes'));
const AdminApp = lazy(() => import('./admin/App'));
const Compounds = lazy(() =>
  import('./pages/StaticPages').then((m) => ({ default: m.CompoundsPage }))
);
const Faq = lazy(() => import('./pages/StaticPages').then((m) => ({ default: m.FaqPage })));
const Legal = lazy(() => import('./pages/StaticPages').then((m) => ({ default: m.LegalPage })));
const Owners = lazy(() => import('./pages/StaticPages').then((m) => ({ default: m.OwnersPage })));
const ContactPage = lazy(() => import('./pages/ContactPage'));

export default function App() {
  return (
    <AuthProvider>
      <CurrencyProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/home" element={<Navigate to="/" replace />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/listings/:slug" element={<ListingDetailPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/checkout/payment" element={<PaymentPage />} />
              <Route path="/checkout/payment/callback" element={<PaymentCallbackPage />} />
              <Route path="/booking-success" element={<BookingSuccessPage />} />
              <Route path="/sign-in" element={<SignInPage />} />
              <Route path="/sign-up" element={<SignUpPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/wishlist" element={<WishlistPage />} />
              <Route path="/careers" element={<CareersPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/compounds" element={<Compounds />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/faq" element={<Faq />} />
              <Route path="/owners" element={<Owners />} />
              <Route path="/host-onboarding" element={<Owners />} />
              <Route path="/terms" element={<Legal kind="terms" />} />
              <Route path="/privacy" element={<Legal kind="privacy" />} />
              <Route path="/refund-policy" element={<Legal kind="refund-policy" />} />
              <Route path="/sales/*" element={<SalesRoutes />} />
              <Route path="/admin/*" element={<AdminApp />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          <WhatsAppFAB />
        </BrowserRouter>
      </CurrencyProvider>
    </AuthProvider>
  );
}
