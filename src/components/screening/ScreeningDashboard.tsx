import React, { useState } from 'react';
import {
  ScreeningItem,
  ScreeningDecision,
  DashboardFilter,
} from '../../types/screening';
import { EXCLUDE_REASONS_LIST } from '../../data/screeningPresets';
import { exportScreeningToExcel } from '../../utils/screeningExcel';

interface ScreeningDashboardProps {
  items: ScreeningItem[];
  onUpdateItems: (items: ScreeningItem[]) => void;
  onClearResults?: () => void;
  category: string;
  subModel: string;
  keyPrefix?: string;
}

export const ScreeningDashboard: React.FC<ScreeningDashboardProps> = ({
  items,
  onUpdateItems,
  onClearResults,
  category,
  subModel,
}) => {
  const [activeFilter, setActiveFilter] = useState<DashboardFilter>('ALL');
  const [excludeReasonFilter, setExcludeReasonFilter] = useState<string>('전체 제외 사유 보기');

  const totalCnt = items.length;
  const incCnt = items.filter((i) => i.aiDecision === 'Include').length;
  const excCnt = items.filter((i) => i.aiDecision === 'Exclude').length;
  const pendingCnt = items.filter((i) => i.aiDecision === 'Review').length;
  const dupCnt = items.filter((i) => i.aiDecision === 'Duplicated').length;

  // Filter items based on active card
  let filteredItems = items.filter((item) => {
    if (activeFilter === 'INC') return item.aiDecision === 'Include';
    if (activeFilter === 'EXC') return item.aiDecision === 'Exclude';
    if (activeFilter === 'PENDING') return item.aiDecision === 'Review';
    if (activeFilter === 'DUP') return item.aiDecision === 'Duplicated';
    return true; // ALL
  });

  // Apply secondary filter for Exclude reasons
  if (activeFilter === 'EXC' && excludeReasonFilter !== '전체 제외 사유 보기') {
    filteredItems = filteredItems.filter((item) =>
      item.conclusion.toLowerCase().includes(excludeReasonFilter.toLowerCase())
    );
  }

  // Inline edit handlers
  const handleDecisionChange = (idxInFiltered: number, newDecision: ScreeningDecision) => {
    const targetItem = filteredItems[idxInFiltered];
    if (!targetItem) return;

    const updated = items.map((item) => {
      if (item.no === targetItem.no && item.id === targetItem.id) {
        return { ...item, aiDecision: newDecision };
      }
      return item;
    });
    onUpdateItems(updated);
  };

  const handleConclusionChange = (idxInFiltered: number, newConclusion: string) => {
    const targetItem = filteredItems[idxInFiltered];
    if (!targetItem) return;

    const updated = items.map((item) => {
      if (item.no === targetItem.no && item.id === targetItem.id) {
        return { ...item, conclusion: newConclusion };
      }
      return item;
    });
    onUpdateItems(updated);
  };

  const handleExcelExport = () => {
    const fileName = `screening_${category.replace(/[^a-zA-Z0-9]/g, '_')}_${subModel.replace(/[^a-zA-Z0-9]/g, '_')}_${activeFilter.toLowerCase()}.xlsx`;
    exportScreeningToExcel(filteredItems, fileName);
  };

  return (
    <div className="space-y-4 mt-6">
      {/* 5 Filter Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {/* All */}
        <button
          type="button"
          onClick={() => setActiveFilter('ALL')}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between min-h-[76px] ${
            activeFilter === 'ALL'
              ? 'bg-blue-600/15 border-blue-500 text-blue-800 ring-2 ring-blue-500/30 shadow-sm'
              : 'bg-blue-50/70 border-blue-200 text-blue-700 hover:bg-blue-100/80'
          }`}
        >
          <div className="text-xs font-semibold">
            <span>전체 대상</span>
          </div>
          <div className="text-xl font-bold font-mono tracking-tight">{totalCnt}건</div>
        </button>

        {/* Include */}
        <button
          type="button"
          onClick={() => setActiveFilter('INC')}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between min-h-[76px] ${
            activeFilter === 'INC'
              ? 'bg-emerald-600/15 border-emerald-500 text-emerald-800 ring-2 ring-emerald-500/30 shadow-sm'
              : 'bg-emerald-50/70 border-emerald-200 text-emerald-800 hover:bg-emerald-100/80'
          }`}
        >
          <div className="text-xs font-semibold">
            <span>Include (포함)</span>
          </div>
          <div className="text-xl font-bold font-mono tracking-tight text-emerald-900">{incCnt}건</div>
        </button>

        {/* Exclude */}
        <button
          type="button"
          onClick={() => setActiveFilter('EXC')}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between min-h-[76px] ${
            activeFilter === 'EXC'
              ? 'bg-rose-600/15 border-rose-500 text-rose-800 ring-2 ring-rose-500/30 shadow-sm'
              : 'bg-rose-50/70 border-rose-200 text-rose-800 hover:bg-rose-100/80'
          }`}
        >
          <div className="text-xs font-semibold">
            <span>Exclude (제외)</span>
          </div>
          <div className="text-xl font-bold font-mono tracking-tight text-rose-900">{excCnt}건</div>
        </button>

        {/* Review Required */}
        <button
          type="button"
          onClick={() => setActiveFilter('PENDING')}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between min-h-[76px] ${
            activeFilter === 'PENDING'
              ? 'bg-amber-600/15 border-amber-500 text-amber-800 ring-2 ring-amber-500/30 shadow-sm'
              : 'bg-amber-50/70 border-amber-200 text-amber-800 hover:bg-amber-100/80'
          }`}
        >
          <div className="text-xs font-semibold">
            <span>Review Required</span>
          </div>
          <div className="text-xl font-bold font-mono tracking-tight text-amber-900">{pendingCnt}건</div>
        </button>

        {/* Duplicated */}
        <button
          type="button"
          onClick={() => setActiveFilter('DUP')}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between min-h-[76px] ${
            activeFilter === 'DUP'
              ? 'bg-slate-600/15 border-slate-500 text-slate-800 ring-2 ring-slate-500/30 shadow-sm'
              : 'bg-slate-100/80 border-slate-200 text-slate-700 hover:bg-slate-200/80'
          }`}
        >
          <div className="text-xs font-semibold">
            <span>Duplicated (중복)</span>
          </div>
          <div className="text-xl font-bold font-mono tracking-tight text-slate-900">{dupCnt}건</div>
        </button>
      </div>

      {/* Sub-reason filter for Exclude */}
      {activeFilter === 'EXC' && (
        <div className="p-3 bg-rose-50/60 rounded-xl border border-rose-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-rose-900">세부 Exclude 사유 필터:</span>
          </div>
          <select
            value={excludeReasonFilter}
            onChange={(e) => setExcludeReasonFilter(e.target.value)}
            className="w-full sm:w-auto px-3 py-1.5 bg-white border border-rose-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-rose-500"
          >
            {EXCLUDE_REASONS_LIST.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Interactive Helper Banner */}
      <div className="px-3.5 py-2.5 bg-blue-50/80 border border-blue-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-blue-900">
        <div>
          <span>
            안내: 표의 <strong>[AI 판정]</strong> 드롭다운 및 <strong>[Conclusion]</strong> 문구를 직접 클릭하여 수정한 뒤 Excel을 다운로드할 수 있습니다.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onClearResults && (
            <button
              type="button"
              onClick={onClearResults}
              className="inline-flex items-center justify-center px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            >
              <span>결과 목록 비우기</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleExcelExport}
            className="inline-flex items-center justify-center px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-medium transition-colors shadow-xs cursor-pointer"
          >
            <span>현재 목록 Excel(.xlsx) 다운로드</span>
          </button>
        </div>
      </div>

      {/* Screening Table */}
      <div className="border border-slate-200 rounded-xl bg-white shadow-xs overflow-hidden">
        <div className="overflow-x-auto max-h-[580px]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-900 text-white sticky top-0 z-10">
              <tr>
                <th className="py-2.5 px-3 font-semibold w-12 text-center">No</th>
                <th className="py-2.5 px-3 font-semibold w-28">식별자 (PMID/NCT)</th>
                <th className="py-2.5 px-3 font-semibold min-w-[200px]">논문/시험 제목</th>
                <th className="py-2.5 px-3 font-semibold w-24">평가 기준</th>
                <th className="py-2.5 px-3 font-semibold w-32 text-center">AI 판정</th>
                <th className="py-2.5 px-3 font-semibold min-w-[280px]">Conclusion</th>
                <th className="py-2.5 px-3 font-semibold w-20 text-center">링크</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-normal text-slate-800">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    선택하신 필터 조건에 해당하는 항목이 없습니다.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, idx) => {
                  const decisionColorClass =
                    item.aiDecision === 'Include'
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold'
                      : item.aiDecision === 'Exclude'
                      ? 'bg-rose-100 text-rose-800 border-rose-300 font-bold'
                      : item.aiDecision === 'Duplicated'
                      ? 'bg-slate-100 text-slate-700 border-slate-300'
                      : 'bg-amber-100 text-amber-800 border-amber-300 font-bold';

                  return (
                    <tr key={`${item.id}-${idx}`} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 text-center text-slate-400 font-mono">{idx + 1}</td>
                      <td className="py-2.5 px-3 font-mono font-medium text-slate-900">
                        {item.id}
                        {item.clinicalStatus && (
                          <span className="block text-[10px] text-slate-500 font-sans font-normal">
                            {item.clinicalStatus}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <p
                          className="font-semibold text-slate-900 leading-snug whitespace-normal break-words"
                          title={item.title}
                        >
                          {item.title}
                        </p>
                        {item.abstractSummary && (
                          <div
                            className="mt-1 max-w-[520px] max-h-[96px] overflow-y-auto
                                       text-[11px] leading-relaxed text-slate-500
                                       whitespace-pre-wrap break-words pr-1"
                            title={item.abstractSummary}
                          >
                            {item.abstractSummary}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                          {item.evaluationStandard}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <select
                          value={item.aiDecision}
                          onChange={(e) =>
                            handleDecisionChange(idx, e.target.value as ScreeningDecision)
                          }
                          className={`px-2 py-1 rounded-md text-xs border focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer ${decisionColorClass}`}
                        >
                          <option value="Include">Include</option>
                          <option value="Exclude">Exclude</option>
                          <option value="Review">Review</option>
                          <option value="Duplicated">Duplicated</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-3 align-top min-w-[320px]">
                        <textarea
                          value={item.conclusion}
                          onChange={(e) => handleConclusionChange(idx, e.target.value)}
                          rows={5}
                          title={item.conclusion}
                          className="w-full min-h-[58px] max-h-[120px] resize-y overflow-y-auto px-2 py-1.5 bg-slate-50/60 hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-slate-900 rounded text-xs leading-relaxed text-slate-800 whitespace-pre-wrap break-words transition-colors focus:outline-none"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {item.link ? (
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 font-medium underline"
                            title="원문 바로가기"
                          >
                            Link
                          </a>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
