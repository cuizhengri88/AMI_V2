import React from 'react';
import { CheckCircle2, AlertTriangle, ShieldCheck, TrendingUp } from 'lucide-react';

const stats = [
  {
    label: 'Operational Health',
    value: '94.8%',
    change: '+1.2% from last week',
    icon: CheckCircle2,
    iconColor: 'text-emerald-500',
    trend: true
  },
  {
    label: 'Maintenance Backlog',
    value: '14 Assets',
    change: 'Next scheduled: Tomorrow, 09:00',
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    trend: false
  },
  {
    label: 'Security Status',
    value: 'Optimal',
    change: 'Zero critical alerts in 24h',
    icon: ShieldCheck,
    iconColor: 'text-primary',
    trend: false
  }
];

export default function StatCards() {
  return (
    <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
      {stats.map((stat) => (
        <div key={stat.label} className="bg-white p-6 rounded-xl border border-slate-200 grid-shadow transition-all hover:shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">{stat.label}</h3>
            <stat.icon className={stat.iconColor} size={20} />
          </div>
          <p className="text-3xl font-black text-slate-900">{stat.value}</p>
          <div className="flex items-center gap-1 mt-1">
            {stat.trend && <TrendingUp size={14} className="text-emerald-500" />}
            <p className={`text-xs font-bold ${stat.trend ? 'text-emerald-500' : 'text-slate-500 font-medium'}`}>
              {stat.change}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
