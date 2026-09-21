import React, { useState, useRef, useEffect } from 'react';
import {
  FileSpreadsheet,
  CheckCircle2,
  Layers,
  Award,
  Palette,
  ChevronDown,
  Check,
  ShieldAlert,
} from 'lucide-react';
import { ThemeId, THEME_OPTIONS } from '../theme';

export type TopSection = 'appraisal';

interface HeaderProps {
  activeSection: TopSection;
  onSectionChange: (section: TopSection) => void;
  currentStep: number;
  onStepChange: (step: number) => void;
  onOpenTestModal: () => void;
  onNewEvaluation?: () => void;
  hasExtractedData: boolean;
  currentTheme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeSection,
  onSectionChange,
  currentStep,
  onStepChange,
  onOpenTestModal,
  onNewEvaluation,
  hasExtractedData,
  currentTheme,
  onThemeChange,
}) => {
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setIsThemeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const steps = [
    { number: 1, title: 'Evaluation Setup & Upload Article', icon: FileSpreadsheet, desc: 'DUE, Similar Devices & PDF/MD' },
    { number: 2, title: 'Research Group Inventory', icon: Layers, desc: 'Groups, Devices & Dimensions' },
    { number: 3, title: 'Article Appraisal', icon: Award, desc: 'Suitability & Relevance' },
    { number: 4, title: 'Safety Event Extraction', icon: ShieldAlert, desc: 'Complications & Adverse Events' },
  ];

  const currentThemeObj = THEME_OPTIONS.find((t) => t.id === currentTheme) || THEME_OPTIONS[0];

  // Header styles per theme
  const getHeaderThemeClass = () => {
    switch (currentTheme) {
      case 'professional-clinical':
        return 'bg-[#0f172a] border-slate-800/80 text-white shadow-sm';
      case 'navy-clinical':
        return 'bg-slate-900 border-slate-800 text-white';
      case 'modern-blue':
        return 'bg-blue-900 border-blue-800 text-white';
      case 'teal-medical':
        return 'bg-teal-950 border-teal-900 text-white';
      case 'dark-slate':
        return 'bg-zinc-950 border-zinc-800 text-white';
      case 'warm-stone':
      default:
        return 'bg-white border-zinc-200 text-zinc-900';
    }
  };

  const isDarkHeader = currentTheme !== 'warm-stone';

  return (
    <header id="app-main-header" className={`${getHeaderThemeClass()} border-b sticky top-0 z-40 transition-colors duration-200`}>
      {/* Top Banner */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className={`text-base font-bold tracking-tight ${isDarkHeader ? 'text-white' : 'text-zinc-900'}`}>
              Clinical Literature Evaluation System
            </h1>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium ${
                isDarkHeader
                  ? 'bg-white/15 text-white/90 border border-white/20'
                  : 'bg-zinc-100 text-zinc-700 border border-zinc-200'
              }`}
            >
              MDR &bull; MEDDEV 2.7.1 &bull; IMDRF MDCE
            </span>
          </div>
          <p className={`text-xs ${isDarkHeader ? 'text-slate-300' : 'text-zinc-500'}`}>
            Evidence-Based Clinical Appraisal Workspace
          </p>
        </div>

        {/* Action Controls & Theme Selector */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Theme Selector Dropdown */}
          <div className="relative" ref={themeMenuRef}>
            <button
              type="button"
              onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors shadow-2xs cursor-pointer ${
                isDarkHeader
                  ? 'bg-white/10 text-white border border-white/20 hover:bg-white/20'
                  : 'bg-white text-zinc-700 border border-zinc-300 hover:bg-zinc-50'
              }`}
              title="디자인 스타일 변경 (Change Design Theme)"
            >
              <Palette className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Theme:</span>
              <span className="font-semibold">{currentThemeObj.name.split(' ')[0]}</span>
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>

            {isThemeMenuOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-lg bg-white border border-zinc-200 shadow-xl py-1.5 z-50 text-zinc-900 animate-in fade-in-50 duration-100">
                <div className="px-3 py-1.5 border-b border-zinc-100 mb-1">
                  <p className="text-xs font-semibold text-zinc-900">Design Theme / 디자인 테마</p>
                  <p className="text-xs text-zinc-500">원하시는 디자인을 선택하세요</p>
                </div>
                {THEME_OPTIONS.map((theme) => {
                  const isSelected = theme.id === currentTheme;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => {
                        onThemeChange(theme.id);
                        setIsThemeMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 flex items-start gap-2.5 hover:bg-zinc-50 transition-colors cursor-pointer ${
                        isSelected ? 'bg-blue-50/70 text-blue-900 font-medium' : 'text-zinc-700'
                      }`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full mt-0.5 shrink-0 ${theme.colorPreview} border border-black/10`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">{theme.name}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                        </div>
                        <p className="text-xs text-zinc-500 truncate">{theme.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {onNewEvaluation && (
            <button
              type="button"
              onClick={onNewEvaluation}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shadow-2xs cursor-pointer ${
                isDarkHeader
                  ? 'bg-white/10 text-white border border-white/20 hover:bg-white/20'
                  : 'bg-white text-zinc-700 border border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900'
              }`}
            >
              <span>+ New Evaluation</span>
            </button>
          )}

          {/* Validation Rule Suite Button */}
          {
            <button
              type="button"
              onClick={onOpenTestModal}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors shadow-2xs cursor-pointer ${
                isDarkHeader
                  ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40 hover:bg-emerald-500/30'
                  : 'bg-white text-zinc-800 border border-zinc-300 hover:bg-zinc-50 hover:border-zinc-400'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Rule Verification Suite (12/12)</span>
            </button>
          }
        </div>
      </div>

      {/* 4-Step Stepper Navigation */}
      {
        <div
          className={`border-t transition-colors ${
            isDarkHeader ? 'bg-black/20 border-white/10' : 'bg-zinc-50/70 border-zinc-200'
          }`}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav aria-label="Progress" className="py-2">
              <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {steps.map((step) => {
                  const Icon = step.icon;
                  const isActive = currentStep === step.number;
                  const isPassed = currentStep > step.number || (step.number === 1 && hasExtractedData);
                  const isClickable = step.number === 1 || hasExtractedData || currentStep >= step.number;

                  return (
                    <li key={step.number}>
                      <button
                        type="button"
                        disabled={!isClickable}
                        onClick={() => onStepChange(step.number)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-all ${
                          isDarkHeader
                            ? isActive
                              ? 'bg-white text-slate-900 font-semibold shadow-md ring-2 ring-white/40'
                              : isPassed
                              ? 'bg-white/10 hover:bg-white/20 text-white border border-white/15 cursor-pointer'
                              : 'opacity-40 bg-transparent text-slate-400 cursor-not-allowed border border-transparent'
                            : isActive
                            ? 'bg-white shadow-2xs border border-zinc-300 text-zinc-900 font-semibold ring-1 ring-zinc-900/10'
                            : isPassed
                            ? 'bg-white/60 hover:bg-white text-zinc-700 border border-zinc-200 cursor-pointer'
                            : 'opacity-50 bg-transparent text-zinc-400 cursor-not-allowed border border-transparent'
                        }`}
                      >
                        <div
                          className={`w-6 h-6 rounded flex items-center justify-center text-xs font-mono font-bold shrink-0 transition-colors ${
                            isDarkHeader
                              ? isActive
                                ? 'bg-slate-900 text-white'
                                : isPassed
                                ? 'bg-white/20 text-white'
                                : 'bg-white/10 text-white/50 border border-white/15'
                              : isActive
                              ? 'bg-zinc-900 text-white'
                              : isPassed
                              ? 'bg-zinc-200 text-zinc-800'
                              : 'bg-zinc-100 text-zinc-400 border border-zinc-200'
                          }`}
                        >
                          {isPassed && !isActive ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : step.number}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs truncate font-medium">Step {step.number}</span>
                          </div>
                          <p
                            className={`text-xs truncate ${
                              isDarkHeader && !isActive ? 'text-slate-300' : 'text-zinc-500'
                            }`}
                          >
                            {step.title}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>
          </div>
        </div>
      }
    </header>
  );
};
