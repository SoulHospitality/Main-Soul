import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CurrencyProvider } from './context/CurrencyContext';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import ListingDetailPage from './pages/ListingDetailPage';
import CheckoutPage from './pages/CheckoutPage';
import PaymentPage from './pages/PaymentPage';
import PaymentCallbackPage from './pages/PaymentCallbackPage';
import BookingSuccessPage from './pages/BookingSuccessPage';
import SignInPage from './pages/SignInPage';
import SignUpPage from './pages/SignUpPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AccountPage, { WishlistPage } from './pages/AccountPage';
import CareersPage from './pages/CareersPage';
import AboutPage from './pages/AboutPage';
import SalesRoutes from './pages/sales/SalesRoutes';
import AdminApp from './admin/App';
import {
  CompoundsPage,
  FaqPage,
  LegalPage,
  OwnersPage,
} from './pages/StaticPages';
import ContactPage from './pages/ContactPage';
import ComingSoonPage from './pages/ComingSoonPage';
import WhatsAppFAB from './components/layout/WhatsAppFAB';

export default function App() {
  return (
    <AuthProvider>
      <CurrencyProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<ComingSoonPage />} />
            <Route path="/home" element={<HomePage />} />
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
            <Route path="/compounds" element={<CompoundsPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/faq" element={<FaqPage />} />
            <Route path="/owners" element={<OwnersPage />} />
            <Route path="/host-onboarding" element={<OwnersPage />} />
            <Route path="/terms" element={<LegalPage kind="terms" />} />
            <Route path="/privacy" element={<LegalPage kind="privacy" />} />
            <Route path="/refund-policy" element={<LegalPage kind="refund-policy" />} />
            <Route path="/sales/*" element={<SalesRoutes />} />
            <Route path="/admin/*" element={<AdminApp />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <WhatsAppFAB />
        </BrowserRouter>
      </CurrencyProvider>
    </AuthProvider>
  );
}
