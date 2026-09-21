import React, { useState } from 'react';
import { ZoomIn } from 'lucide-react';
import { ProductModelItem } from '../../data/productCatalog';

interface StentProductImageProps {
  model: ProductModelItem;
  onOpenZoom?: (model: ProductModelItem, imageUrl?: string) => void;
}

export const StentProductImage: React.FC<StentProductImageProps> = ({
  model,
  onOpenZoom,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [imgError, setImgError] = useState(false);

  // 이제 모든 사진은 public/stents/ 경로에서 공식적으로 불러옵니다.
  const imageSource = `/stents/${model.imageFileName}`;

  // Render SVG Medical Technical Diagram based on Stent Model & Type
  const renderStentDiagram = () => {
    const isUncovered = model.stentType === 'Uncovered';
    const isComVi = model.stentType === 'ComVi';
    const isLams = model.stentType === 'LAMS';
    const isBfms = model.stentType === 'BFMS';
    const isCovered = model.stentType === 'Covered';

    const isBumpy = model.id.includes('bumpy');
    const isFlare = model.id.includes('flare');
    const isBothBare = model.id.includes('bothbare');
    const isEndBare = model.id.includes('endbare');
    const isGiobor = model.id.includes('giobor');
    const isKaffes = model.id.includes('kaffes');
    const isAntiReflux = model.id.includes('antireflux');
    const isConio = model.id.includes('conio');
    const isCervical = model.id.includes('cervical');
    const isHot = model.id.includes('hot_spaxus');
    const isSpaxus = model.id.includes('spaxus') && !isHot;
    const isNagi = model.id.includes('nagi');

    return (
      <svg viewBox="0 0 280 140" className="w-full h-full object-contain filter drop-shadow-md select-none">
        <defs>
          <linearGradient id={`stentGrad_${model.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.9" />
            <stop offset="50%" stopColor="#e2e8f0" stopOpacity="1" />
            <stop offset="100%" stopColor="#64748b" stopOpacity="0.9" />
          </linearGradient>

          <linearGradient id={`goldGrad_${model.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="50%" stopColor="#eab308" />
            <stop offset="100%" stopColor="#a16207" />
          </linearGradient>

          <linearGradient id={`siliconeGrad_${model.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
            <stop offset="50%" stopColor="#0284c7" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#0369a1" stopOpacity="0.45" />
          </linearGradient>

          <linearGradient id={`comviGrad_${model.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.4" />
            <stop offset="50%" stopColor="#059669" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#047857" stopOpacity="0.5" />
          </linearGradient>

          <pattern id={`meshPattern_${model.id}`} width="12" height="12" patternUnits="userSpaceOnUse">
            <path d="M 0 0 L 12 12 M 12 0 L 0 12" stroke="#475569" strokeWidth="1" />
          </pattern>
        </defs>

        <line x1="20" y1="70" x2="260" y2="70" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />

        {(isSpaxus || isHot) && (
          <g>
            <path d="M 60 25 C 45 25, 45 115, 60 115 L 75 95 L 75 45 Z" fill={`url(#siliconeGrad_${model.id})`} stroke="#0284c7" strokeWidth="1.5" />
            <path d="M 60 25 C 45 25, 45 115, 60 115 L 75 95 L 75 45 Z" fill={`url(#meshPattern_${model.id})`} opacity="0.7" />
            <rect x="75" y="45" width="130" height="50" rx="3" fill={`url(#siliconeGrad_${model.id})`} stroke="#0284c7" strokeWidth="1.5" />
            <rect x="75" y="45" width="130" height="50" rx="3" fill={`url(#meshPattern_${model.id})`} opacity="0.8" />
            <path d="M 220 25 C 235 25, 235 115, 220 115 L 205 95 L 205 45 Z" fill={`url(#siliconeGrad_${model.id})`} stroke="#0284c7" strokeWidth="1.5" />
            <path d="M 220 25 C 235 25, 235 115, 220 115 L 205 95 L 205 45 Z" fill={`url(#meshPattern_${model.id})`} opacity="0.7" />
            {isHot && (
              <g>
                <path d="M 30 70 L 45 62 L 45 78 Z" fill="#ef4444" stroke="#fca5a5" strokeWidth="1.5" />
                <line x1="20" y1="70" x2="30" y2="70" stroke="#fbbf24" strokeWidth="2" />
                <circle cx="20" cy="70" r="2.5" fill="#f59e0b" />
                <text x="25" y="55" fill="#f87171" fontSize="8" fontWeight="bold" textAnchor="middle">RF Tip</text>
              </g>
            )}
          </g>
        )}

        {isNagi && (
          <g>
            <path d="M 40 30 C 55 30, 65 48, 85 48 L 195 48 C 215 48, 225 30, 240 30 L 240 110 C 225 110, 215 92, 195 92 L 85 92 C 65 92, 55 110, 40 110 Z" fill={`url(#siliconeGrad_${model.id})`} stroke="#0284c7" strokeWidth="1.5" />
            <path d="M 40 30 C 55 30, 65 48, 85 48 L 195 48 C 215 48, 225 30, 240 30 L 240 110 C 225 110, 215 92, 195 92 L 85 92 C 65 92, 55 110, 40 110 Z" fill={`url(#meshPattern_${model.id})`} opacity="0.8" />
          </g>
        )}

        {isBumpy && (
          <g>
            <rect x="35" y="42" width="210" height="56" rx="6" fill={`url(#siliconeGrad_${model.id})`} stroke="#0284c7" strokeWidth="1.5" />
            <rect x="35" y="42" width="210" height="56" fill={`url(#meshPattern_${model.id})`} opacity="0.6" />
            {[55, 80, 105, 130, 155, 180, 205, 225].map((x, i) => (
              <g key={i}>
                <ellipse cx={x} cy={42} rx="6" ry="7" fill="#38bdf8" stroke="#0369a1" strokeWidth="1" />
                <ellipse cx={x} cy={98} rx="6" ry="7" fill="#38bdf8" stroke="#0369a1" strokeWidth="1" />
                <line x1={x} y1="42" x2={x} y2="98" stroke="#0284c7" strokeWidth="0.75" strokeDasharray="2 2" />
              </g>
            ))}
          </g>
        )}

        {isAntiReflux && (
          <g>
            <rect x="35" y="40" width="175" height="60" rx="4" fill={`url(#siliconeGrad_${model.id})`} stroke="#0284c7" strokeWidth="1.5" />
            <rect x="35" y="40" width="175" height="60" rx="4" fill={`url(#meshPattern_${model.id})`} opacity="0.7" />
            <path d="M 210 40 C 230 40, 245 60, 250 70 C 245 80, 230 100, 210 100 Z" fill="#0284c7" fillOpacity="0.4" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="3 2" />
            <text x="235" y="73" fill="#38bdf8" fontSize="9" fontWeight="bold" textAnchor="middle">Valve</text>
          </g>
        )}

        {(isFlare || isConio || isCervical) && !isBumpy && !isSpaxus && (
          <g>
            <path d={isConio ? "M 35 26 L 80 44 L 245 44 L 245 96 L 80 96 L 35 114 Z" : isCervical ? "M 42 32 L 65 44 L 245 44 L 245 96 L 65 96 L 42 108 Z" : "M 35 28 L 70 44 L 210 44 L 245 28 L 245 112 L 210 96 L 70 96 L 35 112 Z"} fill={isComVi ? `url(#comviGrad_${model.id})` : isCovered ? `url(#siliconeGrad_${model.id})` : `url(#stentGrad_${model.id})`} stroke={isComVi ? '#059669' : isCovered ? '#0284c7' : '#64748b'} strokeWidth="1.5" />
            <path d={isConio ? "M 35 26 L 80 44 L 245 44 L 245 96 L 80 96 L 35 114 Z" : isCervical ? "M 42 32 L 65 44 L 245 44 L 245 96 L 65 96 L 42 108 Z" : "M 35 28 L 70 44 L 210 44 L 245 28 L 245 112 L 210 96 L 70 96 L 35 112 Z"} fill={`url(#meshPattern_${model.id})`} opacity="0.8" />
          </g>
        )}

        {isBothBare && !isFlare && (
          <g>
            <rect x="30" y="38" width="35" height="64" rx="2" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
            <rect x="30" y="38" width="35" height="64" rx="2" fill={`url(#meshPattern_${model.id})`} />
            <rect x="65" y="40" width="150" height="60" fill={isComVi ? `url(#comviGrad_${model.id})` : `url(#siliconeGrad_${model.id})`} stroke={isComVi ? '#059669' : '#0284c7'} strokeWidth="1.5" />
            <rect x="65" y="40" width="150" height="60" fill={`url(#meshPattern_${model.id})`} opacity="0.6" />
            <rect x="215" y="38" width="35" height="64" rx="2" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
            <rect x="215" y="38" width="35" height="64" rx="2" fill={`url(#meshPattern_${model.id})`} />
          </g>
        )}

        {isEndBare && (
          <g>
            <rect x="35" y="40" width="170" height="60" rx="2" fill={isComVi ? `url(#comviGrad_${model.id})` : `url(#siliconeGrad_${model.id})`} stroke={isComVi ? '#059669' : '#0284c7'} strokeWidth="1.5" />
            <rect x="35" y="40" width="170" height="60" fill={`url(#meshPattern_${model.id})`} opacity="0.6" />
            <rect x="205" y="38" width="40" height="64" rx="2" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
            <rect x="205" y="38" width="40" height="64" rx="2" fill={`url(#meshPattern_${model.id})`} />
          </g>
        )}

        {!isSpaxus && !isHot && !isNagi && !isBumpy && !isAntiReflux && !isFlare && !isConio && !isCervical && !isBothBare && !isEndBare && (
          <g>
            {isUncovered ? (
              <g>
                <rect x="35" y="40" width="210" height="60" rx="4" fill={`url(#stentGrad_${model.id})`} fillOpacity="0.15" stroke="#94a3b8" strokeWidth="1.5" />
                <rect x="35" y="40" width="210" height="60" rx="4" fill={`url(#meshPattern_${model.id})`} />
                {[55, 75, 95, 115, 135, 155, 175, 195, 215, 235].map((x, idx) => (
                  <line key={idx} x1={x} y1="40" x2={x} y2="100" stroke="#cbd5e1" strokeWidth="0.75" />
                ))}
              </g>
            ) : (
              <g>
                <rect x="35" y="40" width="210" height="60" rx="4" fill={isComVi ? `url(#comviGrad_${model.id})` : `url(#siliconeGrad_${model.id})`} stroke={isComVi ? '#059669' : '#0284c7'} strokeWidth="1.5" />
                <rect x="35" y="40" width="210" height="60" rx="4" fill={`url(#meshPattern_${model.id})`} opacity="0.65" />
              </g>
            )}
          </g>
        )}

        {isGiobor && (
          <g>
            {[80, 140, 200].map((x, idx) => (
              <g key={idx}>
                <polygon points={`${x},40 ${x - 6},30 ${x + 6},30`} fill="#f59e0b" stroke="#b45309" strokeWidth="1" />
                <polygon points={`${x},100 ${x - 6},110 ${x + 6},110`} fill="#f59e0b" stroke="#b45309" strokeWidth="1" />
              </g>
            ))}
          </g>
        )}

        {isKaffes && (
          <g>
            <path d="M 35 44 C 15 44, 15 96, 35 96" fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="3 2" />
            <circle cx="20" cy="70" r="4" fill="#fbbf24" stroke="#d97706" strokeWidth="1" />
            <text x="18" y="60" fill="#fef08a" fontSize="8" fontWeight="bold">Lasso</text>
          </g>
        )}

        <circle cx="40" cy="45" r="2.5" fill={`url(#goldGrad_${model.id})`} />
        <circle cx="40" cy="95" r="2.5" fill={`url(#goldGrad_${model.id})`} />
        <circle cx="240" cy="45" r="2.5" fill={`url(#goldGrad_${model.id})`} />
        <circle cx="240" cy="95" r="2.5" fill={`url(#goldGrad_${model.id})`} />
      </svg>
    );
  };

  return (
    <div
      className={`relative w-full h-40 sm:h-44 rounded-xl overflow-hidden flex items-center justify-center group border ${
        !imgError
          ? 'bg-white border-slate-200' 
          : 'bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 border-slate-800'
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 
        에러가 없을 때는 public 폴더의 사진을 보여주고, 
        해당 이름의 사진 파일이 폴더에 없으면(imgError) 기본 도면을 그립니다.
      */}
      {!imgError ? (
        <img
          src={imageSource}
          alt={model.fullName}
          onError={() => setImgError(true)}
          className="w-full h-full object-contain p-2 mix-blend-multiply" 
          referrerPolicy="no-referrer"
        />
      ) : (
        renderStentDiagram()
      )}

      {/* Top Left Badge */}
      <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10">
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-md shadow-xs ${
            model.stentType === 'Uncovered'
              ? 'bg-slate-800 text-slate-200 border border-slate-700'
              : model.stentType === 'Covered'
              ? 'bg-sky-950/90 text-sky-300 border border-sky-800'
              : model.stentType === 'ComVi'
              ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-800'
              : model.stentType === 'LAMS'
              ? 'bg-amber-950/90 text-amber-300 border border-amber-800'
              : 'bg-indigo-950/90 text-indigo-300 border border-indigo-800'
          }`}
        >
          {model.stentType}
        </span>
      </div>

      {/* Hover Action Overlay */}
      <div
        className={`absolute inset-0 bg-slate-950/75 backdrop-blur-[2px] transition-opacity duration-200 flex items-center justify-center gap-2 p-3 ${
          isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <button
          type="button"
          onClick={() => onOpenZoom && onOpenZoom(model, !imgError ? imageSource : undefined)}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 border border-slate-700 shadow-md cursor-pointer transition-colors"
          title="상세 크게 보기"
        >
          <ZoomIn className="w-3.5 h-3.5 text-sky-400" />
          <span>확대</span>
        </button>
      </div>     
    </div>
  );
};