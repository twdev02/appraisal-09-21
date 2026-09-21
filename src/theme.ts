export type ThemeId = 'professional-clinical' | 'navy-clinical' | 'modern-blue' | 'warm-stone' | 'teal-medical' | 'dark-slate';

export interface ThemeOption {
  id: ThemeId;
  name: string;
  description: string;
  colorPreview: string; // Tailwind color class or hex
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'professional-clinical',
    name: 'Professional Clinical (Default)',
    description: '공식 임상/병원 규제 표준: Deep Slate (#0f172a), 고대비 화이트, Inter 폰트',
    colorPreview: 'bg-[#0f172a]',
  },
  {
    id: 'navy-clinical',
    name: 'Clinical Navy & Slate',
    description: '전통적 의료 규제 및 병원 표준 네이비/슬레이트 테마',
    colorPreview: 'bg-slate-900',
  },
  {
    id: 'modern-blue',
    name: 'Modern Medical Blue',
    description: '선명하고 깔끔한 모던 인디고/블루 대시보드 테마',
    colorPreview: 'bg-blue-600',
  },
  {
    id: 'warm-stone',
    name: 'Warm Minimalist Stone',
    description: '차분하고 정돈된 웜 뉴트럴 스톤/징크 테마',
    colorPreview: 'bg-stone-700',
  },
  {
    id: 'teal-medical',
    name: 'Clinical Emerald & Teal',
    description: '신뢰감을 주는 메디컬 에메랄드/틸 헬스케어 테마',
    colorPreview: 'bg-teal-700',
  },
  {
    id: 'dark-slate',
    name: 'Midnight Clinical (Dark)',
    description: '장시간 문서 분석에 최적화된 다크 모드 테마',
    colorPreview: 'bg-zinc-950',
  },
];

