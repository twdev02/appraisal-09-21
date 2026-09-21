import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Plus,
  Trash2,
  AlertCircle,
  Layers,
  ArrowRight,
  UploadCloud,
  FileText,
  CheckCircle2,
  Loader2,
  Edit2,
  Check,
  X,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Search,
} from 'lucide-react';
import { DueItem, DueSetup, SimilarDevice, Article, SelfValidationState } from '../types';
import { parseGenericDueIndications } from '../utils/nlpRules';
import { StentIcon } from './StentIcon';
import { biliaryDuePresets, BiliaryDuePreset, subscribeDuePresets } from '../data/biliaryDuePresets';
import { SelfValidationBadge } from './SelfValidationBadge';
import { issuesForTarget } from '../utils/selfValidation';

const SELECT_ALL_CATEGORY_VALUE = '__SELECT_ALL_CATEGORY_DUES__';

interface Step1SetupProps {
  dueList?: DueItem[];
  onUpdateDueList?: (dueList: DueItem[]) => void;
  due?: DueSetup;
  onUpdateDue?: (due: DueSetup) => void;
  similarDevices: SimilarDevice[];
  onUpdateSimilarDevices: (devices: SimilarDevice[]) => void;
  articles: Article[];
  activeArticleIndex: number;
  onSelectArticle: (index: number) => void;
  onRemoveArticle?: (articleId: string) => void;
  pdfFileName?: string;
  isAnalyzing: boolean;
  analysisError?: string | null;
  failedField?: string | null;
  selfValidation?: SelfValidationState;
  onFileUpload: (files: File[]) => void;
  onRetryArticle?: (articleId: string) => void;
  onProceed: () => void;
}

export const Step1Setup: React.FC<Step1SetupProps> = ({
  dueList: propDueList,
  onUpdateDueList,
  due,
  onUpdateDue,
  similarDevices,
  onUpdateSimilarDevices,
  articles,
  activeArticleIndex,
  onSelectArticle,
  onRemoveArticle,
  pdfFileName,
  isAnalyzing,
  analysisError,
  failedField,
  selfValidation,
  onFileUpload,
  onRetryArticle,
  onProceed,
}) => {
  // Normalize DUE items
  const currentDueList: DueItem[] =
    propDueList && propDueList.length > 0
      ? propDueList
      : due
      ? [{ ...due, id: due.id || 'DUE-1' }]
      : [{ id: 'DUE-1', productName: '', indications: [], rawIndicationText: '', similarDevices: [] }];

  const updateDueList = (newList: DueItem[]) => {
    if (onUpdateDueList) {
      onUpdateDueList(newList);
    }
    if (onUpdateDue && newList.length > 0) {
      onUpdateDue(newList[0]);
    }
  };

  // Preset list state
  const [presetsList, setPresetsList] = useState<BiliaryDuePreset[]>(() => biliaryDuePresets);

  useEffect(() => {
    const unsubscribe = subscribeDuePresets((latestPresets) => {
      setPresetsList(latestPresets);
    });
    return unsubscribe;
  }, []);

  // Local state for indication inputs and chip edits
  const [indicationInputs, setIndicationInputs] = useState<{ [dueId: string]: string }>({});
  const [editingChips, setEditingChips] = useState<{ [dueId: string]: { index: number; text: string } | null }>({});

  // Local state for per-DUE similar device inputs and chip edits
  const [dueSimInputs, setDueSimInputs] = useState<{ [dueId: string]: string }>({});
  const [editingDueSimChips, setEditingDueSimChips] = useState<{ [dueId: string]: { index: number; text: string } | null }>({});

  // Drag & drop upload state
  const [dragActive, setDragActive] = useState(false);
  const [lastSelectedFile, setLastSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Add new DUE to list if user wants multiple DUE configurations
  const handleAddDue = () => {
    const existingNums = currentDueList
      .map((d) => {
        const match = d.id.match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
      })
      .filter((n) => !isNaN(n));
    const nextNum = (existingNums.length > 0 ? Math.max(...existingNums) : 0) + 1;
    const newDue: DueItem = {
      id: `DUE-${nextNum}`,
      deviceCategory: '',
      productName: '',
      aliases: '',
      indications: [],
      rawIndicationText: '',
      similarDevices: [],
    };
    updateDueList([...currentDueList, newDue]);
  };

  const handleRemoveDue = (dueId: string) => {
    if (currentDueList.length <= 1) {
      updateDueList([
        {
          id: 'DUE-1',
          deviceCategory: '',
          productName: '',
          aliases: '',
          indications: [],
          rawIndicationText: '',
          similarDevices: [],
        },
      ]);
    } else {
      updateDueList(currentDueList.filter((d) => d.id !== dueId));
    }
  };

  const handleUpdateDueField = (dueId: string, field: keyof DueItem, value: any) => {
    const updated = currentDueList.map((d) => (d.id === dueId ? { ...d, [field]: value } : d));
    updateDueList(updated);
  };

  // Helper to synchronize all DUE cards' similar devices for downstream components / DOCX
  const syncSimilarDevicesState = (updatedList: DueItem[]) => {
    const seen = new Set<string>();
    const syncedRegistry: SimilarDevice[] = [];

    updatedList.forEach((d) => {
      (d.similarDevices || []).forEach((simName) => {
        const trimmed = simName.trim();
        if (trimmed && !seen.has(trimmed.toLowerCase())) {
          seen.add(trimmed.toLowerCase());
          syncedRegistry.push({
            id: `due-sim-${trimmed.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`,
            productName: trimmed,
            aliases: '',
          });
        }
      });
    });

    onUpdateSimilarDevices(syncedRegistry);
  };

  // Selecting a preset for a specific DUE card
  const handleSelectPreset = (dueId: string, preset: BiliaryDuePreset) => {
    const updated: DueItem[] = currentDueList.map((d) => {
      if (d.id !== dueId) return d;
      return {
        ...d,
        productName: preset.due,
        // Indications stored as independent values/tags/chips
        indications: [...preset.indications],
        rawIndicationText: preset.indications.join('\n'),
        // Similar devices stored as independent values/tags/chips
        similarDevices: [...preset.similarDevices],
        selectedPreset: preset.due,
        selectionMode: 'single',
        selectionGroupKey: undefined,
        selectionGroupLabel: undefined,
      };
    });

    updateDueList(updated);
    syncSimilarDevicesState(updated);
  };

  // Category-wide selection (e.g. Biliary LSR / SOTA): one click expands the
  // selected category into the real registered DUE products. Downstream logic
  // therefore continues to use the existing Multi-DUE classification and FMEA
  // cross-check paths instead of introducing a synthetic "All Biliary" DUE.
  const handleSelectAllPresetsForCategory = (dueId: string, category: string) => {
    const categoryPresets = presetsList.filter(
      (preset) => (preset.category || '').trim() === category.trim()
    );
    if (categoryPresets.length === 0) return;

    // Category-wide selection supersedes individually selected DUEs from the
    // same category, while preserving DUE cards from other categories.
    const preserved = currentDueList.filter(
      (item) => item.id !== dueId && (item.deviceCategory || '').trim() !== category.trim()
    );

    const groupKey = `category-all:${category.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const groupLabel = `All ${category}`;

    const expanded: DueItem[] = categoryPresets.map((preset) => ({
      id: '', // reassigned below to keep DUE ids unique and sequential
      deviceCategory: category,
      productName: preset.due,
      indications: [...preset.indications],
      rawIndicationText: preset.indications.join('\n'),
      similarDevices: [...preset.similarDevices],
      selectedPreset: preset.due,
      selectionMode: 'categoryAll',
      selectionGroupKey: groupKey,
      selectionGroupLabel: groupLabel,
    }));

    const updated = [...preserved, ...expanded].map((item, index) => ({
      ...item,
      id: `DUE-${index + 1}`,
    }));

    updateDueList(updated);
    syncSimilarDevicesState(updated);
    setCollapsedGroups((prev) => ({ ...prev, [groupKey]: true }));
  };

  // Adding indication chip
  const handleParseAndAddIndication = (dueId: string) => {
    const inputVal = (indicationInputs[dueId] || '').trim();
    if (!inputVal) return;

    const targetDue = currentDueList.find((d) => d.id === dueId);
    if (!targetDue) return;

    const parsedChips = parseGenericDueIndications(inputVal);
    const existing = new Set(targetDue.indications);
    const newUniqueChips = parsedChips.filter((chip) => !existing.has(chip));

    const updatedIndications =
      targetDue.indications.length === 0
        ? parsedChips
        : [...targetDue.indications, ...newUniqueChips];

    const updated = currentDueList.map((d) => {
      if (d.id !== dueId) return d;
      return {
        ...d,
        indications: updatedIndications,
        rawIndicationText: d.rawIndicationText ? `${d.rawIndicationText}\n${inputVal}` : inputVal,
      };
    });

    updateDueList(updated);
    setIndicationInputs((prev) => ({ ...prev, [dueId]: '' }));
  };

  const handleRemoveIndication = (dueId: string, index: number) => {
    const updated = currentDueList.map((d) => {
      if (d.id !== dueId) return d;
      return {
        ...d,
        indications: d.indications.filter((_, i) => i !== index),
      };
    });
    updateDueList(updated);
  };

  const handleSaveEditChip = (dueId: string) => {
    const editState = editingChips[dueId];
    if (!editState) return;

    const trimmed = editState.text.trim();
    if (!trimmed) {
      handleRemoveIndication(dueId, editState.index);
    } else {
      const updated = currentDueList.map((d) => {
        if (d.id !== dueId) return d;
        const newInds = [...d.indications];
        newInds[editState.index] = trimmed;
        return { ...d, indications: newInds };
      });
      updateDueList(updated);
    }
    setEditingChips((prev) => ({ ...prev, [dueId]: null }));
  };

  // Per-DUE Similar Device handlers
  const handleAddDueSimilarDevice = (dueId: string) => {
    const inputVal = (dueSimInputs[dueId] || '').trim();
    if (!inputVal) return;

    const targetDue = currentDueList.find((d) => d.id === dueId);
    if (!targetDue) return;

    const currentSims = targetDue.similarDevices || [];
    if (currentSims.some((s) => s.toLowerCase() === inputVal.toLowerCase())) {
      setDueSimInputs((prev) => ({ ...prev, [dueId]: '' }));
      return;
    }

    const updatedSims = [...currentSims, inputVal];
    const updated = currentDueList.map((d) => (d.id === dueId ? { ...d, similarDevices: updatedSims } : d));
    updateDueList(updated);
    setDueSimInputs((prev) => ({ ...prev, [dueId]: '' }));
    syncSimilarDevicesState(updated);
  };

  const handleRemoveDueSimilarDevice = (dueId: string, index: number) => {
    const targetDue = currentDueList.find((d) => d.id === dueId);
    if (!targetDue || !targetDue.similarDevices) return;

    const updatedSims = targetDue.similarDevices.filter((_, i) => i !== index);
    const updated = currentDueList.map((d) => (d.id === dueId ? { ...d, similarDevices: updatedSims } : d));
    updateDueList(updated);
    syncSimilarDevicesState(updated);
  };

  const handleSaveEditDueSimChip = (dueId: string) => {
    const editState = editingDueSimChips[dueId];
    if (!editState) return;

    const trimmed = editState.text.trim();
    if (!trimmed) {
      handleRemoveDueSimilarDevice(dueId, editState.index);
    } else {
      const updated = currentDueList.map((d) => {
        if (d.id !== dueId || !d.similarDevices) return d;
        const newSims = [...d.similarDevices];
        newSims[editState.index] = trimmed;
        return { ...d, similarDevices: newSims };
      });
      updateDueList(updated);
      syncSimilarDevicesState(updated);
    }
    setEditingDueSimChips((prev) => ({ ...prev, [dueId]: null }));
  };

  // File Upload Handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files).filter(
        (file: File) => file.type === 'application/pdf' || file.name.endsWith('.pdf')
      );
      if (filesArray.length > 0) {
        onFileUpload(filesArray);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      onFileUpload(filesArray);
    }
  };

  // Validation: DUE Product Name, DUE Indications, and PDF Upload are all required
  const hasValidDue = currentDueList.some(
    (d) => d.productName.trim().length > 0 && d.indications.length > 0
  );
  const hasPdf = Boolean(pdfFileName && pdfFileName.trim().length > 0);
  const canProceed = hasValidDue && hasPdf && !isAnalyzing;

  // Extract unique Device Categories from loaded presets
  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    presetsList.forEach((p) => {
      if (p.category && p.category.trim()) {
        cats.add(p.category.trim());
      }
    });
    const list = Array.from(cats);
    const idx = list.indexOf('Biliary Stents');
    if (idx > 0) {
      list.splice(idx, 1);
      list.unshift('Biliary Stents');
    }
    return list;
  }, [presetsList]);

  const createEmptyDue = (id: string = 'DUE-1'): DueItem => ({
    id,
    deviceCategory: '',
    productName: '',
    aliases: '',
    indications: [],
    rawIndicationText: '',
    similarDevices: [],
    selectionMode: 'single',
  });

  const handleRemoveDueGroup = (groupKey: string) => {
    const updated = currentDueList.filter((item) => item.selectionGroupKey !== groupKey);
    const normalized = updated.length > 0 ? updated.map((item, index) => ({ ...item, id: `DUE-${index + 1}` })) : [createEmptyDue('DUE-1')];
    updateDueList(normalized);
    syncSimilarDevicesState(normalized);
  };

  const renderDueCard = (dueItem: DueItem, idx: number, nested: boolean = false) => (
    <div
      key={dueItem.id}
      className={`${nested ? 'p-4 border border-slate-200 bg-white' : 'p-5 border border-slate-200 bg-slate-50/40'} rounded-lg space-y-5`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-slate-900 text-white shadow-2xs">
            {dueItem.id || `DUE-${idx + 1}`}
          </span>
          <SelfValidationBadge issues={issuesForTarget(selfValidation, `step1.due.${dueItem.id || idx}`)} />
        </div>
        {currentDueList.length > 1 && (
          <button
            type="button"
            onClick={() => handleRemoveDue(dueItem.id)}
            className="text-slate-400 hover:text-rose-600 p-1 transition-colors cursor-pointer"
            title="Remove DUE"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs font-semibold text-slate-800">
            Device Category <span className="text-rose-600 font-bold">*</span>
          </label>
          <span className="text-xs text-slate-500">
            Select device classification category
          </span>
        </div>
        <div className="relative">
          <select
            value={dueItem.deviceCategory || ''}
            onChange={(e) => {
              const newCat = e.target.value;
              const updated = currentDueList.map((d) => {
                if (d.id !== dueItem.id) return d;
                const productPreset = presetsList.find((p) => p.due === d.productName);
                const keepProduct = productPreset && productPreset.category === newCat;
                return {
                  ...d,
                  deviceCategory: newCat,
                  productName: keepProduct ? d.productName : '',
                  indications: keepProduct ? d.indications : [],
                  rawIndicationText: keepProduct ? d.rawIndicationText : '',
                  similarDevices: keepProduct ? d.similarDevices : [],
                  selectionMode: keepProduct ? d.selectionMode : 'single',
                  selectionGroupKey: keepProduct ? d.selectionGroupKey : undefined,
                  selectionGroupLabel: keepProduct ? d.selectionGroupLabel : undefined,
                };
              });
              updateDueList(updated);
              syncSimilarDevicesState(updated);
            }}
            className="w-full pl-3.5 pr-10 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-shadow text-slate-900 font-medium cursor-pointer appearance-none"
          >
            <option value="" disabled hidden>Select device category</option>
            {uniqueCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-700 pointer-events-none flex items-center justify-center">
            <ChevronDown className="w-4 h-4 text-slate-700" />
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs font-semibold text-slate-800">
            DUE Product Name <span className="text-rose-600 font-bold">*</span>
          </label>
          <span className="text-xs text-slate-500">
            {dueItem.deviceCategory ? 'Select from registered presets' : 'First select a Device Category'}
          </span>
        </div>

        <div className="relative">
          <select
            value={dueItem.productName || ''}
            onChange={(e) => {
              if (e.target.value === SELECT_ALL_CATEGORY_VALUE && dueItem.deviceCategory) {
                handleSelectAllPresetsForCategory(dueItem.id, dueItem.deviceCategory);
                return;
              }
              const selectedPreset = presetsList.find((p) => p.due === e.target.value);
              if (selectedPreset) {
                handleSelectPreset(dueItem.id, selectedPreset);
              }
            }}
            disabled={!dueItem.deviceCategory}
            className="w-full pl-3.5 pr-10 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-shadow text-slate-900 font-medium cursor-pointer appearance-none disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
          >
            <option value="" disabled hidden>
              {dueItem.deviceCategory ? 'Select DUE product name' : 'First select a Device Category'}
            </option>
            {dueItem.deviceCategory &&
              presetsList.filter((p) => p.category === dueItem.deviceCategory).length > 1 && (
                <option value={SELECT_ALL_CATEGORY_VALUE}>
                  All {dueItem.deviceCategory} ({presetsList.filter((p) => p.category === dueItem.deviceCategory).length} DUEs)
                </option>
              )}
            {presetsList
              .filter((p) => !dueItem.deviceCategory || p.category === dueItem.deviceCategory)
              .map((preset) => (
                <option key={preset.due} value={preset.due}>
                  {preset.due}
                </option>
              ))}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-700 pointer-events-none flex items-center justify-center">
            <ChevronDown className="w-4 h-4 text-slate-700" />
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs font-semibold text-slate-800">
            Target Indication(s) <span className="text-rose-600 font-bold">*</span>
          </label>
          <span className="text-xs text-slate-500">
            Independently registered indications (press Enter to add)
          </span>
        </div>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={indicationInputs[dueItem.id] || ''}
            onChange={(e) =>
              setIndicationInputs((prev) => ({ ...prev, [dueItem.id]: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleParseAndAddIndication(dueItem.id);
              }
            }}
            placeholder="e.g., Malignant biliary stricture, Benign biliary stricture"
            className="flex-1 px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 text-slate-900"
          />
          <button
            type="button"
            onClick={() => handleParseAndAddIndication(dueItem.id)}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Indication</span>
          </button>
        </div>

        <div className="min-h-[44px] p-3 bg-white border border-slate-200 rounded-lg flex flex-wrap gap-2 items-center">
          {dueItem.indications.length === 0 ? (
            <span className="text-xs text-slate-400 italic">
              No indications added yet. Please select a preset above or enter at least one clinical indication.
            </span>
          ) : (
            dueItem.indications.map((ind, chipIdx) => {
              const isEditing =
                editingChips[dueItem.id]?.index === chipIdx;
              return isEditing ? (
                <div
                  key={chipIdx}
                  className="inline-flex items-center gap-1.5 bg-slate-100 border border-slate-400 rounded-md px-2 py-1"
                >
                  <input
                    type="text"
                    value={editingChips[dueItem.id]?.text || ''}
                    onChange={(e) =>
                      setEditingChips((prev) => ({
                        ...prev,
                        [dueItem.id]: { index: chipIdx, text: e.target.value },
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSaveEditChip(dueItem.id);
                      } else if (e.key === 'Escape') {
                        setEditingChips((prev) => ({ ...prev, [dueItem.id]: null }));
                      }
                    }}
                    autoFocus
                    className="text-xs bg-white px-1.5 py-0.5 border border-slate-300 rounded focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveEditChip(dueItem.id)}
                    className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingChips((prev) => ({ ...prev, [dueItem.id]: null }))
                    }
                    className="text-slate-500 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <span
                  key={chipIdx}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 border border-slate-300/80 rounded-full text-xs font-semibold text-slate-800 group hover:border-slate-400 transition-colors shadow-2xs"
                >
                  <span>{ind}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingChips((prev) => ({
                        ...prev,
                        [dueItem.id]: { index: chipIdx, text: ind },
                      }))
                    }
                    className="text-slate-400 hover:text-slate-700 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    title="Edit chip"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveIndication(dueItem.id, chipIdx)}
                    className="text-slate-400 hover:text-rose-600 p-0.5 cursor-pointer"
                    title="Remove chip"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              );
            })
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs font-semibold text-slate-800">
            Similar Device(s) for this DUE
          </label>
          <span className="text-xs text-slate-500">
            Devices matching these names/aliases are classified as Similar Device for this DUE
          </span>
        </div>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={dueSimInputs[dueItem.id] || ''}
            onChange={(e) =>
              setDueSimInputs((prev) => ({ ...prev, [dueItem.id]: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddDueSimilarDevice(dueItem.id);
              }
            }}
            placeholder="e.g., Wallflex Biliary Transhepatic Full covered Stent"
            className="flex-1 px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 text-slate-900"
          />
          <button
            type="button"
            onClick={() => handleAddDueSimilarDevice(dueItem.id)}
            className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-medium hover:bg-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Similar Device</span>
          </button>
        </div>

        <div className="min-h-[40px] p-3 bg-white border border-slate-200 rounded-lg flex flex-wrap gap-2 items-center">
          {(!dueItem.similarDevices || dueItem.similarDevices.length === 0) ? (
            <span className="text-xs text-slate-400 italic">
              No similar devices registered for this DUE card. Select a preset or add devices above.
            </span>
          ) : (
            dueItem.similarDevices.map((sim, simIdx) => {
              const isEditing = editingDueSimChips[dueItem.id]?.index === simIdx;
              return isEditing ? (
                <div
                  key={simIdx}
                  className="inline-flex items-center gap-1.5 bg-slate-100 border border-slate-400 rounded-md px-2 py-1"
                >
                  <input
                    type="text"
                    value={editingDueSimChips[dueItem.id]?.text || ''}
                    onChange={(e) =>
                      setEditingDueSimChips((prev) => ({
                        ...prev,
                        [dueItem.id]: { index: simIdx, text: e.target.value },
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSaveEditDueSimChip(dueItem.id);
                      } else if (e.key === 'Escape') {
                        setEditingDueSimChips((prev) => ({ ...prev, [dueItem.id]: null }));
                      }
                    }}
                    autoFocus
                    className="text-xs bg-white px-1.5 py-0.5 border border-slate-300 rounded focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveEditDueSimChip(dueItem.id)}
                    className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingDueSimChips((prev) => ({ ...prev, [dueItem.id]: null }))
                    }
                    className="text-slate-500 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <span
                  key={simIdx}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50/80 border border-amber-200 rounded-full text-xs font-semibold text-amber-900 group hover:border-amber-400 transition-colors shadow-2xs"
                >
                  <span>{sim}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingDueSimChips((prev) => ({
                        ...prev,
                        [dueItem.id]: { index: simIdx, text: sim },
                      }))
                    }
                    className="text-amber-500 hover:text-amber-800 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    title="Edit"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveDueSimilarDevice(dueItem.id, simIdx)}
                    className="text-amber-500 hover:text-rose-600 p-0.5 cursor-pointer"
                    title="Remove"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">
      {/* Header Info */}
      <div className="border-b border-slate-200 pb-5">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
          Step 1. Evaluation Setup &amp; Upload Article
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          Configure the Device Under Evaluation (DUE), registered Similar Devices, and upload the clinical publication PDF for evidence-grounded extraction.
        </p>
      </div>

      {/* 1. DUE Input Section */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="bg-slate-50/90 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-semibold text-sm shadow-2xs">
              <StentIcon className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Device Under Evaluation (DUE)
              </h3>
              <p className="text-xs text-slate-500">
                Specify the target medical device, intended indication(s), and similar devices. Enter manually or use Biliary presets.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleAddDue}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add DUE</span>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {(() => {
            const renderedGroupKeys = new Set<string>();

            return currentDueList.map((dueItem, idx) => {
              const groupKey = dueItem.selectionGroupKey;
              const groupItems = groupKey
                ? currentDueList.filter((item) => item.selectionGroupKey === groupKey)
                : [];

              if (dueItem.selectionMode === 'categoryAll' && groupKey && groupItems.length > 1) {
                if (renderedGroupKeys.has(groupKey)) return null;
                renderedGroupKeys.add(groupKey);

                const groupLabel = dueItem.selectionGroupLabel || `All ${dueItem.deviceCategory || 'Selected DUEs'}`;
                const isCollapsed = collapsedGroups[groupKey] ?? true;
                const groupIssues = groupItems.flatMap((item) =>
                  issuesForTarget(selfValidation, `step1.due.${item.id}`)
                );
                const productPreview = groupItems.slice(0, 3).map((item) => item.productName).join(', ');
                const remainingCount = Math.max(groupItems.length - 3, 0);

                return (
                  <div
                    key={groupKey}
                    className="rounded-xl border border-slate-200 bg-slate-50/60 overflow-hidden"
                  >
                    <div className="px-5 py-4 flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center rounded-full bg-slate-900 text-white px-2.5 py-0.5 text-xs font-semibold">
                            Category-wide selection
                          </span>
                          <span className="inline-flex items-center rounded-full bg-sky-50 text-sky-700 border border-sky-200 px-2.5 py-0.5 text-xs font-semibold">
                            {groupLabel} ({groupItems.length} DUEs)
                          </span>
                          <SelfValidationBadge issues={groupIssues} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {dueItem.deviceCategory || 'Selected category'} bundle
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Category-wide preset selection for LSR / SOTA. Expand to review or edit included DUEs individually.
                          </p>
                        </div>
                        <p className="text-xs text-slate-600">
                          Included DUEs: <span className="font-medium">{productPreview}{remainingCount > 0 ? `, +${remainingCount} more` : ''}</span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedGroups((prev) => ({ ...prev, [groupKey]: !isCollapsed }))
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                          <span>{isCollapsed ? 'Expand DUEs' : 'Collapse DUEs'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveDueGroup(groupKey)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 rounded-md text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                          title="Remove entire category bundle"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove bundle</span>
                        </button>
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="border-t border-slate-200 px-4 py-4 space-y-4 bg-white/60">
                        {groupItems.map((groupItem) =>
                          renderDueCard(
                            groupItem,
                            currentDueList.findIndex((item) => item.id === groupItem.id),
                            true
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              }

              return renderDueCard(dueItem, idx);
            });
          })()}
        </div>
      </div>

      {/* 2. Clinical Publication PDF Upload Section */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="bg-slate-50/90 px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-semibold text-sm shadow-2xs">
              <UploadCloud className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Clinical Publication PDF Upload
              </h3>
              <p className="text-xs text-slate-500">
                Upload a single clinical publication PDF. The extractor will analyze and parse verbatim evidence.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />

          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-3 ${
              dragActive
                ? 'border-slate-900 bg-slate-50 scale-[0.99]'
                : pdfFileName
                ? 'border-emerald-300 bg-emerald-50/30 hover:bg-emerald-50/50'
                : 'border-slate-300 hover:border-slate-600 bg-slate-50/50 hover:bg-slate-50'
            }`}
          >
            {isAnalyzing ? (
              <div className="flex flex-col items-center gap-2 py-4">
                <Loader2 className="w-8 h-8 text-slate-900 animate-spin" />
                <p className="text-sm font-semibold text-slate-900">
                  Extracting verbatim data and evidence quotes from publication...
                </p>
                <p className="text-xs text-slate-500">
                  Grounding research groups, device models, indications, and clinical endpoints
                </p>
              </div>
            ) : pdfFileName ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-slate-900 flex items-center justify-center gap-1.5">
                    <FileText className="w-4 h-4 text-emerald-700" />
                    <span>{pdfFileName}</span>
                  </p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    PDF analysis ready. Click or drop additional files to add more articles.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-800 flex items-center justify-center">
                  <UploadCloud className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Drag and drop one or multiple clinical article PDFs here
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    or click to browse your local files (supports multi-file batch upload)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="mt-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                >
                  Select PDFs
                </button>
              </>
            )}
          </div>

          {/* Uploaded Articles Queue List */}
          {articles.length > 0 && (
            <div className="mt-4 space-y-2 pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-800">
                  Uploaded Articles Queue ({articles.length})
                </h4>
                <span className="text-xs text-slate-500">
                  Select article to review or edit its appraisal
                </span>
              </div>
              <div className="space-y-2">
                {articles.map((art, idx) => (
                  <div
                    key={art.id}
                    className={`p-3 rounded-lg border flex items-center justify-between text-xs transition-colors ${
                      activeArticleIndex === idx
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50/80 hover:bg-slate-100 border-slate-200 text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <FileText className={`w-4 h-4 ${activeArticleIndex === idx ? 'text-white' : 'text-slate-600'}`} />
                      <div>
                        <span className="font-semibold">{art.pdfFileName}</span>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px]">
                          {art.status === 'completed' && (
                            <span className={activeArticleIndex === idx ? 'text-emerald-300' : 'text-emerald-700 font-medium'}>
                              Analysis Completed
                            </span>
                          )}
                          {art.status === 'analyzing' && (
                            <span className={activeArticleIndex === idx ? 'text-amber-300' : 'text-amber-700 font-medium flex items-center gap-1'}>
                              <Loader2 className="w-3 h-3 animate-spin inline" /> Analyzing...
                            </span>
                          )}
                          {art.status === 'pending' && (
                            <span className={activeArticleIndex === idx ? 'text-slate-300' : 'text-slate-500'}>
                              Waiting in queue
                            </span>
                          )}
                          {art.status === 'failed' && (
                            <span className={activeArticleIndex === idx ? 'text-rose-300' : 'text-rose-700 font-medium'}>
                              Failed: {art.errorMessage || 'Analysis error'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {art.status === 'failed' && onRetryArticle && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRetryArticle(art.id);
                          }}
                          className="px-2.5 py-1 bg-rose-600 text-white rounded font-medium hover:bg-rose-700 cursor-pointer shadow-2xs"
                        >
                          Retry
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onSelectArticle(idx)}
                        className={`px-3 py-1 rounded font-medium cursor-pointer transition-colors ${
                          activeArticleIndex === idx
                            ? 'bg-white text-slate-900 font-bold'
                            : 'bg-slate-900 text-white hover:bg-slate-800'
                        }`}
                      >
                        {activeArticleIndex === idx ? 'Active' : 'Select'}
                      </button>
                      {onRemoveArticle && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveArticle(art.id);
                          }}
                          title="Remove this article from the uploaded queue"
                          aria-label={`Remove ${art.pdfFileName}`}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                            activeArticleIndex === idx
                              ? 'bg-white/10 text-rose-200 hover:bg-rose-500/20 hover:text-rose-100'
                              : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                          }`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Analysis Error / Retry Banner */}
          {analysisError && (
            <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs leading-relaxed">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-rose-900">Extraction Analysis Notice</h4>
                  <p className="mt-0.5 text-rose-800">{analysisError}</p>
                  {failedField && (
                    <p className="mt-1 font-mono text-xs text-rose-700">
                      Target field: {failedField}
                    </p>
                  )}
                </div>
              </div>
              {lastSelectedFile && (
                <button
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => onFileUpload(lastSelectedFile)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-900 text-white rounded text-xs font-medium hover:bg-rose-800 disabled:opacity-50 transition-colors shrink-0 self-start sm:self-auto cursor-pointer"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                  <span>Retry Analysis</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-200">
        <div className="text-xs text-slate-500">
          {!hasValidDue && !hasPdf ? (
            <span>Please enter DUE Product Name &amp; Indication(s), and upload a clinical PDF.</span>
          ) : !hasValidDue ? (
            <span>Please complete DUE Product Name &amp; Indication(s).</span>
          ) : !hasPdf ? (
            <span>Please upload a clinical article PDF.</span>
          ) : (
            <span className="text-emerald-700 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Setup complete. Ready to proceed to Step 2.
            </span>
          )}
        </div>

        <button
          type="button"
          disabled={!canProceed}
          onClick={onProceed}
          className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-semibold text-sm transition-all shadow-xs cursor-pointer"
        >
          <span>Proceed to Step 2. Research Group Inventory</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

