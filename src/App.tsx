import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import AuthGate from './components/AuthGate';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Investments from './pages/Investments';
import Holdings from './pages/Holdings';
import Expenses from './pages/Expenses';
import Review from './pages/Review';
import Settings from './pages/Settings';
import Debug from './pages/Debug';

export default function App() {
  return (
    <AuthGate>
      <AppProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="investments" element={<Investments />} />
            <Route path="holdings" element={<Holdings />} />
            <Route path="expenses" element={<Expenses />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          {/* Full-screen review page — no bottom nav */}
          <Route path="/review" element={<div className="max-w-xl mx-auto"><Review /></div>} />
          <Route path="/debug" element={<Debug />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppProvider>
    </AuthGate>
  );
}
