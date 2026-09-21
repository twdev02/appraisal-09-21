import React, { useState } from 'react';
import { Quote, MapPin, Check, Copy } from 'lucide-react';
import { EvidenceCitation } from '../types';

interface EvidenceBadgeProps {
  evidence?: EvidenceCitation;
  label?: string;
  defaultExpanded?: boolean;
}

export const EvidenceBadge: React.FC<EvidenceBadgeProps> = ({
  evidence,
  label = 'Evidence Quote',
  defaultExpanded = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!evidence || (!evidence.quote && !evidence.location)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-mono rounded bg-slate-100 text-slate-500 border border-slate-200">
        Not reported
      </span>
    );
  }

  // Filter out any placeholder text like "Extracted from PDF text" or fake "Page 1" defaults
  const isPlaceholderQuote = !evidence.quote || evidence.quote.toLowerCase() === 'extracted from pdf text' || evidence.quote.toLowerCase() === 'direct sentence from paper';
  const cleanQuote = isPlaceholderQuote ? '' : evidence.quote;
  const cleanLocation = (!evidence.location || evidence.location.trim() === '' || evidence.location === 'Page 1') && isPlaceholderQuote 
    ? 'Location not identified' 
    : (evidence.location || 'Location not identified');

  if (!cleanQuote && cleanLocation === 'Location not identified') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-mono rounded bg-slate-100 text-slate-500 border border-slate-200">
        Not reported
      </span>
    );
  }

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(cleanQuote ? `"${cleanQuote}" (${cleanLocation})` : `(${cleanLocation})`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="text-xs rounded-md border border-slate-200/90 bg-slate-50/80 p-2.5 transition-colors hover:bg-slate-100/70">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 font-semibold text-slate-900 hover:text-blue-900 text-left"
        >
          <Quote className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="truncate">{label}</span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white text-slate-800 font-mono font-medium border border-slate-300 text-xs shadow-2xs">
            <MapPin className="w-3.5 h-3.5 text-slate-500" />
            {cleanLocation}
          </span>
        </button>

        <button
          type="button"
          onClick={handleCopy}
          title="Copy quote and citation"
          className="p-1 rounded text-slate-500 hover:bg-white hover:text-slate-900 transition-colors border border-transparent hover:border-slate-200"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {isExpanded && cleanQuote && (
        <div className="mt-2 pt-2 border-t border-slate-200">
          <p className="italic text-slate-800 font-serif text-sm leading-relaxed bg-white p-3 rounded border border-slate-200/90 shadow-2xs">
            "{cleanQuote}"
          </p>
        </div>
      )}
    </div>
  );
};
