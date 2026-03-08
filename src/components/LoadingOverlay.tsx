import React from 'react';
import { Loader2 } from 'lucide-react';

type LoadingOverlayProps = {
  visible: boolean;
  message?: React.ReactNode;
};

export default function LoadingOverlay({ visible, message = 'Loading...' }: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/20 backdrop-blur-[1px] flex items-center justify-center">
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-lg flex items-center gap-2">
        <Loader2 size={18} className="animate-spin text-primary" />
        <span className="text-sm font-semibold text-slate-700">{message}</span>
      </div>
    </div>
  );
}
