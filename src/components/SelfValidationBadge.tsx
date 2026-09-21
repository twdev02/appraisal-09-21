import React, { useEffect, useRef, useState } from 'react';
import type { SelfValidationIssue } from '../types';

interface Props {
  issues?: SelfValidationIssue[];
  className?: string;
}

export const SelfValidationBadge: React.FC<Props> = ({ issues = [], className = '' }) => {
  const visible = issues.filter((issue) => issue.status === 'review' || issue.status === 'fail');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (visible.length === 0) return null;
  const primary = visible.find((issue) => issue.status === 'fail') || visible[0];
  const isFail = primary.status === 'fail';

  return (
    <span ref={ref} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold leading-none cursor-pointer transition-colors ${
          isFail
            ? 'border-rose-200 bg-rose-50/70 text-rose-700 hover:bg-rose-50'
            : 'border-amber-200 bg-amber-50/70 text-amber-700 hover:bg-amber-50'
        }`}
        aria-label={`Self-validation ${isFail ? 'Fail' : 'Review'}`}
      >
        {isFail ? 'Fail' : 'Review'}
      </button>
      {open && (
        <span className="absolute left-0 top-full z-50 mt-1 w-max max-w-[320px] rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[10px] font-medium leading-snug text-slate-700 shadow-lg">
          {primary.message}
        </span>
      )}
    </span>
  );
};
