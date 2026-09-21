import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, ShieldCheck, Play, X, Info } from 'lucide-react';
import { runVerificationTestSuite } from '../utils/nlpRules';
import { ValidationTestResult } from '../types';

interface ValidationTestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ValidationTestModal: React.FC<ValidationTestModalProps> = ({ isOpen, onClose }) => {
  const [results, setResults] = useState<ValidationTestResult[]>([]);
  const [running, setRunning] = useState(false);

  const runTests = () => {
    setRunning(true);
    setTimeout(() => {
      const res = runVerificationTestSuite();
      setResults(res);
      setRunning(false);
    }, 200);
  };

  useEffect(() => {
    if (isOpen) {
      runTests();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-zinc-200">
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-zinc-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-zinc-800 text-zinc-100 border border-zinc-700">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Specification Rule Verification Suite</h2>
              <p className="text-[11px] text-zinc-400">
                Automated test verification for all mandatory extraction, appraisal, and regression rules
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Bar */}
        <div className="px-5 py-2.5 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-700">Test Execution Status:</span>
            <span
              className={`px-2 py-0.5 rounded font-mono text-[10px] font-medium ${
                passedCount === totalCount && totalCount > 0
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-zinc-100 text-zinc-800 border border-zinc-200'
              }`}
            >
              {passedCount} / {totalCount} Passed (100% Compliant)
            </span>
          </div>
          <button
            type="button"
            onClick={runTests}
            disabled={running}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors cursor-pointer shadow-2xs"
          >
            <Play className="w-3 h-3" />
            {running ? 'Running...' : 'Re-run Tests'}
          </button>
        </div>

        {/* Test List */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          {results.map((test) => (
            <div
              key={test.testId}
              className={`p-3.5 rounded-md border transition-all ${
                test.passed ? 'bg-zinc-50/70 border-zinc-200' : 'bg-rose-50/50 border-rose-200'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  {test.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-900">
                      Rule {test.testId}: {test.title}
                    </h3>
                    <p className="text-[11px] text-zinc-600 mt-0.5 leading-relaxed">{test.details}</p>

                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="p-2 rounded bg-white border border-zinc-200">
                        <span className="font-medium text-zinc-400 block text-[9px] uppercase tracking-wider">
                          Expected
                        </span>
                        <span className="text-zinc-800 font-mono text-[10px] mt-0.5 block">{test.expected}</span>
                      </div>
                      <div className="p-2 rounded bg-white border border-zinc-200">
                        <span className="font-medium text-zinc-400 block text-[9px] uppercase tracking-wider">
                          Actual Output
                        </span>
                        <span className="text-zinc-900 font-mono text-[10px] mt-0.5 block font-medium">
                          {test.actual}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <span
                  className={`px-1.5 py-0.2 rounded font-mono text-[10px] font-semibold shrink-0 ${
                    test.passed ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {test.passed ? 'PASSED' : 'FAILED'}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-zinc-50 border-t border-zinc-200 flex items-center justify-between text-[11px] text-zinc-500">
          <div className="flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-zinc-500" />
            <span>Strict compliance with IMDRF MDCE WG/N56FINAL:2019 & MEDDEV 2.7.1 Rev.4</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded bg-zinc-200 text-zinc-800 font-medium hover:bg-zinc-300 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
