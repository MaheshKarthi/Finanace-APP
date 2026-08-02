import { useApp } from '../context/AppContext';
import type { Person } from '../db/types';

export default function PersonFilter() {
  const { personFilter, setPersonFilter, personName } = useApp();

  const options: { label: string; value: Person | 'all' }[] = [
    { label: 'All', value: 'all' },
    { label: personName('person1'), value: 'person1' },
    { label: personName('person2'), value: 'person2' },
  ];

  return (
    <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => setPersonFilter(o.value)}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
            personFilter === o.value
              ? 'bg-white text-indigo-600 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
