import React from 'react';
import { 
  Factory, 
  Router, 
  Cpu, 
  Truck, 
  Droplets, 
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  Calendar
} from 'lucide-react';

const assets = [
  {
    id: '#AS-9421-K',
    name: 'Central Generator A1',
    location: 'Hub 04 • East Sector',
    department: 'Operations',
    performance: 92,
    status: 'Online',
    icon: Factory,
    statusColor: 'emerald'
  },
  {
    id: '#AS-1028-M',
    name: 'Relay Station Alpha',
    location: 'Hub 01 • Boundary',
    department: 'Infrastructure',
    performance: 48,
    status: 'Maintenance',
    icon: Router,
    statusColor: 'amber'
  },
  {
    id: '#AS-0021-X',
    name: 'Assembly Line 03',
    location: 'Factory D • Floor 1',
    department: 'Manufacturing',
    performance: 12,
    status: 'Critical',
    icon: Cpu,
    statusColor: 'rose'
  },
  {
    id: '#AS-5561-B',
    name: 'HV Transport T102',
    location: 'Logistics Yard B',
    department: 'Logistics',
    performance: 85,
    status: 'Online',
    icon: Truck,
    statusColor: 'emerald',
    checked: true
  },
  {
    id: '#AS-1229-L',
    name: 'Water Purification Hub',
    location: 'Zone 11 • West',
    department: 'Civil Serv.',
    performance: 76,
    status: 'Online',
    icon: Droplets,
    statusColor: 'emerald'
  }
];

export default function AssetTable() {
  return (
    <div className="bg-white rounded-xl overflow-hidden border border-slate-200 grid-shadow">
      {/* Table Toolbar */}
      <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap gap-3 items-center">
        <div className="flex bg-white border border-slate-200 rounded-lg p-1">
          <button className="px-3 py-1 text-xs font-semibold bg-primary text-white rounded">Active</button>
          <button className="px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 rounded">Pending</button>
          <button className="px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 rounded">Archived</button>
        </div>
        
        <div className="flex items-center gap-2">
          <select className="text-sm border-slate-200 bg-white rounded-lg px-3 py-1.5 focus:ring-primary/20 outline-none border">
            <option>Status: All</option>
            <option>Online</option>
            <option>Maintenance</option>
            <option>Offline</option>
          </select>
          <select className="text-sm border-slate-200 bg-white rounded-lg px-3 py-1.5 focus:ring-primary/20 outline-none border">
            <option>Department: Logistics</option>
            <option>Manufacturing</option>
            <option>Security</option>
          </select>
          <button className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm hover:bg-slate-50 transition-colors">
            <Calendar size={16} className="text-slate-400" />
            Last 30 Days
          </button>
        </div>
        
        <div className="ml-auto text-xs text-slate-400 font-medium">
          Showing 1-12 of 142 results
        </div>
      </div>

      {/* Data Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-900 text-slate-200">
            <tr>
              <th className="py-4 px-4 font-semibold text-xs uppercase tracking-wider border-r border-white/5 w-12 text-center">
                <input type="checkbox" className="rounded-sm bg-transparent border-white/30 text-primary focus:ring-0" />
              </th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider border-r border-white/5">Asset ID</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider border-r border-white/5">Name / Identifier</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider border-r border-white/5">Department</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider border-r border-white/5">Performance</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider border-r border-white/5">Status</th>
              <th className="py-4 px-4 font-semibold text-xs uppercase tracking-wider text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {assets.map((asset) => (
              <tr key={asset.id} className="hover:bg-primary/5 transition-colors group">
                <td className="py-4 px-4 text-center">
                  <input 
                    type="checkbox" 
                    defaultChecked={asset.checked}
                    className="rounded-sm border-slate-300 text-primary focus:ring-0" 
                  />
                </td>
                <td className="py-4 px-6 font-mono text-sm font-semibold text-slate-500">{asset.id}</td>
                <td className="py-4 px-6">
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded bg-slate-100 flex items-center justify-center text-primary">
                      <asset.icon size={18} />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">{asset.name}</div>
                      <div className="text-xs text-slate-400">{asset.location}</div>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-6 text-sm font-medium text-slate-600">{asset.department}</td>
                <td className="py-4 px-6">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden min-w-[100px]">
                      <div 
                        className={`h-full rounded-full ${
                          asset.performance > 80 ? 'bg-emerald-500' : 
                          asset.performance > 40 ? 'bg-amber-500' : 'bg-rose-500'
                        }`} 
                        style={{ width: `${asset.performance}%` }}
                      ></div>
                    </div>
                    <span className="text-xs font-bold text-slate-600">{asset.performance}%</span>
                  </div>
                </td>
                <td className="py-4 px-6">
                  <span className={`inline-flex items-center gap-1.5 py-1 px-2.5 rounded-full text-xs font-bold border ${
                    asset.statusColor === 'emerald' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    asset.statusColor === 'amber' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    'bg-rose-50 text-rose-700 border-rose-200'
                  }`}>
                    <span className={`size-1.5 rounded-full ${
                      asset.statusColor === 'emerald' ? 'bg-emerald-500' :
                      asset.statusColor === 'amber' ? 'bg-amber-500' :
                      'bg-rose-500'
                    }`}></span>
                    {asset.status}
                  </span>
                </td>
                <td className="py-4 px-4 text-center">
                  <button className="text-slate-400 hover:text-slate-600 transition-colors">
                    <MoreVertical size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="p-4 border-t border-slate-200 flex items-center justify-between bg-slate-50">
        <button className="text-xs font-bold text-slate-600 flex items-center gap-1 hover:text-primary transition-colors">
          <ChevronLeft size={16} />
          Previous
        </button>
        <div className="flex items-center gap-1">
          <button className="size-8 rounded bg-primary text-white text-xs font-bold">1</button>
          <button className="size-8 rounded text-slate-600 text-xs font-bold hover:bg-slate-200">2</button>
          <button className="size-8 rounded text-slate-600 text-xs font-bold hover:bg-slate-200">3</button>
          <span className="mx-1 text-slate-400">...</span>
          <button className="size-8 rounded text-slate-600 text-xs font-bold hover:bg-slate-200">12</button>
        </div>
        <button className="text-xs font-bold text-slate-600 flex items-center gap-1 hover:text-primary transition-colors">
          Next
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
