import { type ReactNode } from 'react';

interface Props {
  label: string;
  value: number;
  icon: ReactNode;
  color: string;
}

export function StatsCard({ label, value, icon, color }: Props) {
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  );
}
