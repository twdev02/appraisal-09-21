import React, { useState, useEffect } from 'react';
import { X, Search, Info } from 'lucide-react';
import {
  PRODUCT_CATALOG_GROUPS,
  ProductCategoryGroup,
  ProductCatalogSubTab,
  ProductModelItem,
} from '../../data/productCatalog';
import { StentProductImage } from './StentProductImage';

interface ProductCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectModelForScreening?: (
    categoryName: string,
    subModelName: string,
    modelName: string,
    customQuery?: string
  ) => void;
}

export const ProductCatalogModal: React.FC<ProductCatalogModalProps> = ({
  isOpen,
  onClose,
  onSelectModelForScreening,
}) => {
  const [activeCategoryIndex, setActiveCategoryIndex] = useState<number>(0);
  const [activeSubTabId, setActiveSubTabId] = useState<string>('biliary-uncovered');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [zoomModel, setZoomModel] = useState<{ model: ProductModelItem; imageUrl?: string } | null>(null);

  const currentCategory: ProductCategoryGroup = PRODUCT_CATALOG_GROUPS[activeCategoryIndex] || PRODUCT_CATALOG_GROUPS[0];

  useEffect(() => {
    if (currentCategory && currentCategory.subTabs.length > 0) {
      setActiveSubTabId(currentCategory.subTabs[0].id);
    }
  }, [activeCategoryIndex]);

  if (!isOpen) return null;

  const currentSubTab: ProductCatalogSubTab | undefined = currentCategory.subTabs.find(
    (st) => st.id === activeSubTabId
  ) || currentCategory.subTabs[0];



  const filteredModels = searchQuery.trim()
    ? PRODUCT_CATALOG_GROUPS.flatMap((grp) =>
      grp.subTabs.flatMap((st) =>
        st.models.filter(
          (m) =>
            m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.indication.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.imageFileName.toLowerCase().includes(searchQuery.toLowerCase())
        )
      )
    )
    : currentSubTab?.models || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-slate-900 text-slate-100 rounded-2xl shadow-2xl border border-slate-700 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* Top Header */}
        <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">

            {/* 공식 로고 영역 */}
            <div className="bg-white px-2.5 py-1.5 rounded-lg flex items-center justify-center shadow-md">
              <img
                src="/logo.png"
                alt="Taewoong Medical"
                className="h-5 sm:h-6 object-contain"
              />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold tracking-tight text-white">
                  Taewoong Medical Product Catalog
                </h3>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search & Top Controls */}
        <div className="px-5 py-3 bg-slate-900 border-b border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
            {PRODUCT_CATALOG_GROUPS.map((grp, idx) => {
              const isActive = activeCategoryIndex === idx && !searchQuery.trim();
              return (
                <button
                  key={grp.category}
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setActiveCategoryIndex(idx);
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center ${isActive
                      ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                      : 'bg-slate-800/70 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-700/50'
                    }`}
                >
                  <span>{grp.displayName}</span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="스텐트 모델/적응증 검색"
              className="w-full pl-9 pr-8 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-cyan-500 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Sub-tabs */}
        {!searchQuery.trim() && (
          <div className="flex items-center gap-2 px-5 py-2.5 bg-slate-950/70 border-b border-slate-800 shrink-0 overflow-x-auto">
            <span className="text-[11px] font-semibold text-slate-400 shrink-0">Sub-Group:</span>
            {currentCategory.subTabs.map((st) => {
              const isSubActive = activeSubTabId === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setActiveSubTabId(st.id)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${isSubActive
                      ? 'bg-slate-800 text-cyan-300 font-bold border border-slate-700 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                >
                  <span>{st.subTabName}</span>
                  <span className="text-[10px] text-slate-400 font-mono">({st.models.length})</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-slate-900/60 space-y-4 min-h-0">
          {filteredModels.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <p className="text-sm font-semibold text-slate-400">일치하는 스텐트 모델을 찾을 수 없습니다.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filteredModels.map((model) => (
                <div key={model.id} className="bg-slate-950 rounded-xl border border-slate-800 hover:border-slate-700 p-4 shadow-lg flex flex-col justify-between space-y-3 transition-all group">
                  <div className="space-y-3">
                    {/* Stent Graphic or Photo */}
                    <StentProductImage
                      model={model}
                      onOpenZoom={(m, img) => setZoomModel({ model: m, imageUrl: img })}
                    />

                    {/* Stent Title */}
                    <div className="space-y-1 w-full overflow-hidden">
                      <h4
                        className="text-sm font-bold text-white group-hover:text-cyan-400 transition-colors truncate block w-full"
                        title={model.fullName}
                      >
                        {model.fullName}
                      </h4>
                    </div>

                    {/* Indication Box */}
                    <div className="p-3 bg-slate-900/90 rounded-lg border border-cyan-950/60 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-cyan-400 text-[11px] font-bold">
                        <Info className="w-3.5 h-3.5" />
                        <span>Indication For Use</span>
                      </div>
                      <p className="text-xs text-slate-200 leading-relaxed pl-3.5 border-l-2 border-cyan-500/50">
                        {model.indication}
                      </p>
                    </div>
                  </div>


                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
          >
            닫기
          </button>
        </div>
      </div>

      {/* Lightbox Modal */}
      {zoomModel && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-100"
          onClick={() => setZoomModel(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h4 className="text-base font-bold text-white">{zoomModel.model.fullName}</h4>
                <p className="text-xs text-slate-400">{zoomModel.model.imageFileName}</p>
              </div>
              <button type="button" onClick={() => setZoomModel(null)} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="h-64 sm:h-80 bg-slate-950 rounded-xl overflow-hidden flex items-center justify-center border border-slate-800 p-3">
              <StentProductImage model={zoomModel.model} />
            </div>

            <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5 text-xs">
              <p className="font-bold text-cyan-400">Indication For Use:</p>
              <p className="text-slate-200 leading-relaxed">{zoomModel.model.indication}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};