import React from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { type DateRangeViewType } from '../pages/utils/pageCommon';

type DateRangeViewSelectorVariant = 'compact' | 'panel';

type DateRangeViewSelectorProps = {
  viewType: DateRangeViewType;
  startDate: string;
  endDate: string;
  dailyLabel: string;
  periodLabel: string;
  onViewTypeChange: (nextViewType: DateRangeViewType) => void;
  onMoveDailyDate: (dayOffset: number) => void;
  onStartDateChange: (nextStartDate: string) => void;
  onEndDateChange: (nextEndDate: string) => void;
  variant?: DateRangeViewSelectorVariant;
};

export default function DateRangeViewSelector({
  viewType,
  startDate,
  endDate,
  dailyLabel,
  periodLabel,
  onViewTypeChange,
  onMoveDailyDate,
  onStartDateChange,
  onEndDateChange,
  variant = 'compact',
}: DateRangeViewSelectorProps) {
  const isCompact = variant === 'compact';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="bg-white border border-slate-200 rounded-xl p-1 flex">
        {(['daily', 'period'] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onViewTypeChange(type)}
            className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${viewType === type
              ? 'bg-primary text-white shadow-lg shadow-primary/20'
              : 'text-slate-400 hover:text-slate-600'
              }`}
          >
            {type === 'daily' ? dailyLabel : periodLabel}
          </button>
        ))}
      </div>

      {viewType === 'daily' && (
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1">
          <button
            type="button"
            onClick={() => onMoveDailyDate(-1)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
            aria-label="Previous day"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="px-2 text-xs font-black text-slate-700 min-w-[100px] text-center">
            {startDate}
          </span>
          <button
            type="button"
            onClick={() => onMoveDailyDate(1)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
            aria-label="Next day"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {viewType === 'period' && (
        <div className={isCompact ? 'flex items-center gap-2 bg-white border border-slate-200 rounded-xl p-1 px-2' : 'flex-1 min-w-[260px] flex items-center gap-2'}>
          {isCompact && <Calendar size={14} className="text-slate-400" />}
          <input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className={isCompact
              ? 'bg-transparent border-none text-xs font-bold outline-none'
              : 'flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20'}
          />
          <span className="text-slate-300 font-bold">~</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className={isCompact
              ? 'bg-transparent border-none text-xs font-bold outline-none'
              : 'flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20'}
          />
        </div>
      )}
    </div>
  );
}

