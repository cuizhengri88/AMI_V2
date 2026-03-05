import React from 'react';
import { Search, Bell, HelpCircle, Plus } from 'lucide-react';

export default function TopNav() {
  return (
    <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-8 z-10 sticky top-0">
      <div className="flex items-center gap-4 flex-1">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            className="w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-primary/20 placeholder:text-slate-400 outline-none" 
            placeholder="Search by ID, Name, or Department..." 
            type="text"
          />
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        <button className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg relative">
          <Bell size={20} />
          <span className="absolute top-2 right-2 size-2 bg-red-500 rounded-full border-2 border-white"></span>
        </button>
        <button className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
          <HelpCircle size={20} />
        </button>
      </div>
    </header>
  );
}
