import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { SelfValidationIssue, SourceConflictChoice } from '../types';

type SourceConflictField = NonNullable<SelfValidationIssue['sourceConflict']>['field'];

// Lets a Review badge settle a PDF/Markdown source conflict in place. Screens
// without a provider still show the conflict, just without the choice buttons.
export const SourceConflictResolverContext = createContext<
  ((field: SourceConflictField, choice: SourceConflictChoice) => void) | null
>(null);

interface Props {
  issues?: SelfValidationIssue[];
  className?: string;
}

const SourceChoice: React.FC<{ conflict: NonNullable<SelfValidationIssue['sourceConflict']> }> = ({ conflict }) => {
  const resolve = useContext(SourceConflictResolverContext);
  // Until the reviewer decides, the Markdown value is what scoring uses.
  const current: SourceConflictChoice = conflict.resolution?.choice || 'markdown';
  const options: Array<{ choice: SourceConflictChoice; label: string; value: string }> = [
    { choice: 'pdf', label: 'PDF/Gemini', value: conflict.pdfValue },
    { choice: 'markdown', label: 'Markdown', value: conflict.markdownValue },
  ];

  return (
    <span className="mt-1.5 block space-y-1">
      {options.map((option) => {
        const active = current === option.choice;
        const tag = active ? (conflict.resolution ? 'Selected' : 'Provisional') : '';
        const body = (
          <>
            <span className="flex items-center justify-between gap-2">
              <span className="font-semibold">{option.label}</span>
              {tag && (
                <span className={`rounded px-1 py-px text-[9px] font-semibold ${
                  conflict.resolution ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  {tag}
                </span>
              )}
            </span>
            <span className="mt-0.5 block max-h-24 overflow-y-auto whitespace-pre-wrap break-words font-normal text-slate-600">
              {option.value || 'Not reported'}
            </span>
          </>
        );
        const frame = `block w-full rounded border px-2 py-1.5 text-left ${
          active ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white'
        }`;
        return resolve ? (
          <button
            key={option.choice}
            type="button"
            onClick={() => resolve(conflict.field, option.choice)}
            className={`${frame} cursor-pointer hover:border-slate-500`}
            aria-pressed={Boolean(conflict.resolution) && active}
          >
            {body}
          </button>
        ) : (
          <span key={option.choice} className={frame}>{body}</span>
        );
      })}
      {resolve && !conflict.resolution && (
        <span className="block text-[9px] text-slate-500">Check the original source, then choose the value to use.</span>
      )}
    </span>
  );
};

export const SelfValidationBadge: React.FC<Props> = ({ issues = [], className = '' }) => {
  const visible = issues.filter((issue) => issue.status === 'review' || issue.status === 'fail');
  const resolved = issues.filter((issue) => issue.status === 'resolved');
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

  if (visible.length === 0 && resolved.length === 0) return null;
  const primary = visible.find((issue) => issue.status === 'fail') || visible[0];
  const label = !primary ? 'Resolved' : primary.status === 'fail' ? 'Fail' : 'Review';
  const tone = label === 'Fail'
    ? 'border-rose-200 bg-rose-50/70 text-rose-700 hover:bg-rose-50'
    : label === 'Review'
      ? 'border-amber-200 bg-amber-50/70 text-amber-700 hover:bg-amber-50'
      : 'border-slate-200 bg-slate-50/70 text-slate-600 hover:bg-slate-100';
  const shown = [...visible, ...resolved];

  return (
    <span ref={ref} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold leading-none cursor-pointer transition-colors ${tone}`}
        aria-label={`Self-validation ${label}`}
      >
        {label}
      </button>
      {open && (
        <span className="absolute left-0 top-full z-50 mt-1 w-[320px] max-w-[80vw] rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[10px] font-medium leading-snug text-slate-700 shadow-lg">
          {shown.map((issue) => (
            <span key={issue.id} className="block whitespace-normal break-words [&+span]:mt-2">
              {issue.status === 'fail' ? 'Fail' : issue.status === 'resolved' ? 'Resolved' : 'Review'}: {issue.message}
              {issue.sourceConflict && <SourceChoice conflict={issue.sourceConflict} />}
            </span>
          ))}
        </span>
      )}
    </span>
  );
};
