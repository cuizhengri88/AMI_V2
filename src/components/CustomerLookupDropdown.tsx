import React from 'react';

type CustomerLookupMemberOption = {
  id: number | string;
  name: string;
  phone?: string | null;
};

type CustomerLookupDropdownProps<T extends CustomerLookupMemberOption> = {
  open: boolean;
  members: T[];
  selectedMemberId?: number | string | null;
  emptyText: string;
  onSelect: (member: T) => void;
  maxHeightClassName?: string;
};

export default function CustomerLookupDropdown<T extends CustomerLookupMemberOption>({
  open,
  members,
  selectedMemberId,
  emptyText,
  onSelect,
  maxHeightClassName = 'max-h-40',
}: CustomerLookupDropdownProps<T>) {
  if (!open) return null;

  return (
    <div className={`absolute z-20 left-0 right-0 mt-1 rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 overflow-y-auto shadow-lg ${maxHeightClassName}`}>
      {members.length === 0 ? (
        <p className="px-3 py-2 text-xs text-slate-400">{emptyText}</p>
      ) : (
        members.map((member) => (
          <button
            key={member.id}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(member);
            }}
            className={`w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors ${String(selectedMemberId ?? '') === String(member.id) ? 'bg-primary/5' : ''}`}
          >
            <p className="text-sm font-semibold text-slate-700">{member.name}</p>
            <p className="text-xs text-slate-500">{member.phone || '-'}</p>
          </button>
        ))
      )}
    </div>
  );
}
