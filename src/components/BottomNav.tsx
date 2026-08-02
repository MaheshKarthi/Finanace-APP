import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, PieChart, CreditCard, Settings, Bell } from 'lucide-react';
import { useApp } from '../context/AppContext';

const tabs = [
  { to: '/',            label: 'Home',     icon: LayoutDashboard },
  { to: '/investments', label: 'Invest',   icon: TrendingUp      },
  { to: '/holdings',    label: 'Holdings', icon: PieChart        },
  { to: '/expenses',    label: 'Expenses', icon: CreditCard      },
  { to: '/settings',    label: 'Settings', icon: Settings        },
];

export default function BottomNav() {
  const { pendingSMSCount } = useApp();
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 safe-bottom z-40">
      <div className="flex max-w-xl mx-auto">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[11px] font-medium transition-colors ${
                isActive ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'
              }`
            }
          >
            <Icon size={22} />
            {label}
          </NavLink>
        ))}

        {/* SMS review bell — only shown when there are pending transactions */}
        {pendingSMSCount > 0 && (
          <button
            onClick={() => navigate('/review')}
            className="flex-none flex flex-col items-center justify-center py-2 px-3 gap-0.5 text-[11px] font-medium text-amber-500 relative"
          >
            <span className="relative">
              <Bell size={22} />
              <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {pendingSMSCount > 9 ? '9+' : pendingSMSCount}
              </span>
            </span>
            Review
          </button>
        )}
      </div>
    </nav>
  );
}
