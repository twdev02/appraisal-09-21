import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Tag,
  Info,
  Edit2,
  Check,
  X,
} from 'lucide-react';
import { StentIcon } from './StentIcon';
import {
  ResearchGroup,
  ExtractedDeviceItem,
  DeviceRelationshipType,
  IndicationRelationshipType,
  DueItem,
  DueSetup,
  SimilarDevice,
  ArticleMetadata,
  SelfValidationState,
} from '../types';
import { EvidenceBadge } from './EvidenceBadge';
import { SelfValidationBadge } from './SelfValidationBadge';
import { issuesForTarget } from '../utils/selfValidation';
import {
  classifyDeviceWithAnatomicalContext,
  evaluateIndicationWithInventory,
} from '../utils/nlpRules';

interface Step2InventoryProps {
  researchGroups: ResearchGroup[];
  onUpdateResearchGroups: (groups: ResearchGroup[]) => void;
  due?: DueSetup;
  dueList?: DueItem[];
  similarDevices: SimilarDevice[];
  articleMetadata?: ArticleMetadata;
  pdfFileName?: string;
  selfValidation?: SelfValidationState;
  onProceed: () => void;
  onBack: () => void;
}

export const Step2Inventory: React.FC<Step2InventoryProps> = ({
  researchGroups,
  onUpdateResearchGroups,
  due,
  dueList: propDueList,
  similarDevices,
  articleMetadata,
  pdfFileName,
  selfValidation,
  onProceed,
  onBack,
}) => {
  const [expandedGroups, setExpandedGroups] = useState<{ [id: string]: boolean }>({});
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  const currentDueList: DueItem[] =
    propDueList && propDueList.length > 0
      ? propDueList
      : due
      ? [{ ...due, id: due.id || 'DUE-1' }]
      : [{ id: 'DUE-1', productName: 'Device Under Evaluation', indications: [] }];

  const primaryDue = currentDueList[0];

  const toggleGroupExpand = (id: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [id]: prev[id] === undefined ? false : !prev[id],
    }));
  };

  const handleUpdateDeviceField = (
    groupId: string,
    deviceId: string,
    field: keyof ExtractedDeviceItem,
    value: any
  ) => {
    const updated = researchGroups.map((g) => {
      if (g.id !== groupId) return g;
      const updatedDevices = g.devices.map((d) => {
        if (d.id !== deviceId) return d;
        const newDev = { ...d, [field]: value };

        // Product identity is hierarchical: exact name -> manufacturer -> use site -> cover -> subtype -> legacy alias.
        // Re-run both device and indication matching whenever any identity/context field changes.
        if (field === 'deviceProductName' || field === 'manufacturer' || field === 'coverType' || field === 'deviceIndication') {
          const devRel = classifyDeviceWithAnatomicalContext(
            field === 'deviceProductName' ? value : d.deviceProductName,
            field === 'manufacturer' ? value : d.manufacturer,
            currentDueList,
            field === 'deviceIndication' ? value : (d.deviceIndication || g.groupIndicationSummary || ''),
            similarDevices,
            field === 'coverType' ? value : d.coverType
          );
          const indRel = evaluateIndicationWithInventory(
            field === 'deviceIndication' ? value : d.deviceIndication,
            devRel.type,
            devRel.matchedDueId,
            devRel.dueMatchStatus,
            currentDueList
          );

          newDev.matchedDueId = devRel.matchedDueId;
          newDev.matchedDueName = devRel.matchedDueName;
          newDev.dueMatchStatus = devRel.dueMatchStatus;
          newDev.mappedSimilarDeviceName = devRel.mappedSimilarDeviceName;
          newDev.mappedSimilarDeviceManufacturer = devRel.mappedSimilarDeviceManufacturer;
          newDev.matchBasis = devRel.matchBasis;
          newDev.deviceRelationship = {
            ...newDev.deviceRelationship,
            aiRecommended: devRel.type,
            userFinal: devRel.type,
            rationale: devRel.rationale,
          };
          newDev.indicationRelationship = {
            ...newDev.indicationRelationship,
            aiRecommended: indRel.type,
            userFinal: indRel.type,
            rationale: indRel.rationale,
            comparedAgainstDueId: indRel.comparedAgainstDueId,
            comparedAgainstDueName: indRel.comparedAgainstDueName,
          };
        }


        return newDev;
      });
      return { ...g, devices: updatedDevices };
    });
    onUpdateResearchGroups(updated);
  };

  const handleUpdateGroupField = (groupId: string, field: keyof ResearchGroup, value: any) => {
    const updated = researchGroups.map((g) => {
      if (g.id !== groupId) return g;
      const nextGroup = { ...g, [field]: value } as ResearchGroup;

      // Group indication is part of the hierarchical anatomical/use-site filter.
      // If the user edits it, re-run each device classification against Step 1 DUEs.
      if (field === 'groupIndicationSummary') {
        nextGroup.devices = g.devices.map((d) => {
          const indicationContext = d.deviceIndication && d.deviceIndication !== 'Not reported'
            ? d.deviceIndication
            : String(value || '');
          const devRel = classifyDeviceWithAnatomicalContext(
            d.deviceProductName,
            d.manufacturer,
            currentDueList,
            indicationContext,
            similarDevices,
            d.coverType
          );
          const indRel = evaluateIndicationWithInventory(
            d.deviceIndication || String(value || ''),
            devRel.type,
            devRel.matchedDueId,
            devRel.dueMatchStatus,
            currentDueList
          );
          return {
            ...d,
            matchedDueId: devRel.matchedDueId,
            matchedDueName: devRel.matchedDueName,
            dueMatchStatus: devRel.dueMatchStatus,
            mappedSimilarDeviceName: devRel.mappedSimilarDeviceName,
            mappedSimilarDeviceManufacturer: devRel.mappedSimilarDeviceManufacturer,
            matchBasis: devRel.matchBasis,
            deviceRelationship: {
              ...d.deviceRelationship,
              aiRecommended: devRel.type,
              userFinal: devRel.type,
              rationale: devRel.rationale,
            },
            indicationRelationship: {
              ...d.indicationRelationship,
              aiRecommended: indRel.type,
              userFinal: indRel.type,
              rationale: indRel.rationale,
              comparedAgainstDueId: indRel.comparedAgainstDueId,
              comparedAgainstDueName: indRel.comparedAgainstDueName,
            },
          };
        });
      }

      return nextGroup;
    });
    onUpdateResearchGroups(updated);
  };

  const handleAddResearchGroup = () => {
    const newGroupId = `group-${Date.now()}`;
    const newGroup: ResearchGroup = {
      id: newGroupId,
      groupName: `Research Cohort ${researchGroups.length + 1}`,
      groupPatientNumber: 'Not reported',
      evidence: { quote: 'Not reported', location: 'Page 1' },
      devices: [
        {
          id: `dev-${Date.now()}`,
          deviceProductName: 'Not reported',
          manufacturer: 'Not reported',
          deviceType: 'SEMS',
          coverType: 'Not reported',
          diameter: 'Not reported',
          length: 'Not reported',
          devicePatientNumber: 'Not separately reported',
          deviceIndication: 'Not reported',
          evidence: { quote: 'Not reported', location: 'Page 1' },
          deviceRelationship: {
            aiRecommended: 'Not reported',
            userFinal: 'Not reported',
            evidence: { quote: 'Not reported', location: 'Page 1' },
            rationale: 'User-added device cohort',
          },
          indicationRelationship: {
            aiRecommended: 'Not reported',
            userFinal: 'Not reported',
            evidence: { quote: 'Not reported', location: 'Page 1' },
            rationale: 'User-added device cohort',
          },
        },
      ],
    };
    onUpdateResearchGroups([...researchGroups, newGroup]);
    setExpandedGroups((prev) => ({ ...prev, [newGroupId]: true }));
  };

  const handleRemoveResearchGroup = (groupId: string) => {
    onUpdateResearchGroups(researchGroups.filter((g) => g.id !== groupId));
  };

  const handleAddDeviceToGroup = (groupId: string) => {
    const newDevId = `dev-${Date.now()}`;
    const newDev: ExtractedDeviceItem = {
      id: newDevId,
      deviceProductName: 'New Stent / Device',
      manufacturer: 'Not reported',
      deviceType: 'SEMS',
      coverType: 'Covered',
      diameter: 'Not reported',
      length: 'Not reported',
      devicePatientNumber: 'Not separately reported',
      deviceIndication: primaryDue.indications[0] || 'Not reported',
      evidence: { quote: 'Direct quotation from paper', location: 'Page 2' },
      deviceRelationship: {
        aiRecommended: 'Other Device',
        userFinal: 'Other Device',
        evidence: { quote: 'Direct quotation from paper', location: 'Page 2' },
        rationale: 'Manually added device item',
      },
      indicationRelationship: {
        aiRecommended: 'Related indication',
        userFinal: 'Related indication',
        evidence: { quote: 'Direct quotation from paper', location: 'Page 2' },
        rationale: 'Manually added indication item',
      },
    };

    const updated = researchGroups.map((g) => {
      if (g.id !== groupId) return g;
      return { ...g, devices: [...g.devices, newDev] };
    });
    onUpdateResearchGroups(updated);
  };

  const handleRemoveDeviceFromGroup = (groupId: string, deviceId: string) => {
    const updated = researchGroups.map((g) => {
      if (g.id !== groupId) return g;
      return { ...g, devices: g.devices.filter((d) => d.id !== deviceId) };
    });
    onUpdateResearchGroups(updated);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-16">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Step 2. Research Group Inventory
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Review study cohorts, extracted device models, dimensions, patient numbers, and evidence citations.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAddResearchGroup}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors shadow-2xs cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add Research Group</span>
        </button>
      </div>

      {/* DUE Reference Bar */}
      <div className="p-4 rounded-xl bg-slate-100/90 border border-slate-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-2xs">
        <div className="flex items-center gap-2.5">
          <StentIcon className="w-4 h-4 text-slate-800 shrink-0" />
          <div>
            <span className="font-bold text-slate-900">Reference DUE Inventory: </span>
            <span className="text-slate-800 font-medium">
              {currentDueList.map((d) => d.productName || 'DUE').join(' | ')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Tag className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="text-slate-600 font-medium">
            Registered Similar Devices: {similarDevices.length > 0 ? similarDevices.map((s) => s.productName).join(', ') : 'None registered'}
          </span>
        </div>
      </div>

      {/* Groups List */}
      {researchGroups.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-600 mx-auto flex items-center justify-center">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-900">No Research Groups Extracted</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            No study groups were detected in the publication. You can manually add a research cohort below or re-analyze the PDF in Step 1.
          </p>
          <button
            type="button"
            onClick={handleAddResearchGroup}
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 transition-colors cursor-pointer shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add First Research Group</span>
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {researchGroups.map((group, groupIdx) => {
            const isCollapsed = expandedGroups[group.id] === true;
            return (
              <div
                key={group.id}
                className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden transition-shadow hover:shadow-sm"
              >
                {/* Group Header Card */}
                <div className="bg-slate-50/90 px-6 py-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start md:items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleGroupExpand(group.id)}
                      className="p-1 text-slate-500 hover:text-slate-900 rounded transition-colors cursor-pointer mt-0.5 md:mt-0"
                    >
                      {isCollapsed ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronUp className="w-4 h-4" />
                      )}
                    </button>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-slate-900 text-white shadow-2xs">
                          Group {groupIdx + 1}
                        </span>
                        <SelfValidationBadge issues={issuesForTarget(selfValidation, `step2.group.${group.id}`)} />
                        <input
                          type="text"
                          value={group.groupName}
                          onChange={(e) =>
                            handleUpdateGroupField(group.id, 'groupName', e.target.value)
                          }
                          className="font-bold text-sm text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-900 focus:outline-none px-1 py-0.5 rounded transition-colors"
                        />
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-slate-600 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-800">Patients (N):</span>
                          <input
                            type="text"
                            value={group.groupPatientNumber}
                            onChange={(e) =>
                              handleUpdateGroupField(group.id, 'groupPatientNumber', e.target.value)
                            }
                            placeholder="e.g. 80"
                            className="w-16 px-1.5 py-0.5 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900 font-mono"
                          />
                        </div>
                        {group.evidence && (
                          <div className="flex items-center gap-1">
                            <span className="text-slate-400">&bull;</span>
                            <EvidenceBadge evidence={group.evidence} label="Cohort Evidence" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-auto">
                    <button
                      type="button"
                      onClick={() => handleAddDeviceToGroup(group.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-medium transition-colors shadow-2xs cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Device</span>
                    </button>
                    {researchGroups.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveResearchGroup(group.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                        title="Delete Group"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Devices in Group */}
                {!isCollapsed && (
                  <div className="p-6 space-y-6">
                    {group.devices.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400 italic bg-slate-50/50 rounded-lg border border-dashed border-slate-200">
                        No devices listed in this research cohort. Click &quot;Add Device&quot; to insert one.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-6">
                        {group.devices.map((device, devIdx) => {
                          const isDue =
                            device.deviceRelationship.userFinal === 'DUE' ||
                            device.deviceRelationship.aiRecommended === 'DUE';
                          const isSimilar =
                            device.deviceRelationship.userFinal === 'Similar Device' ||
                            device.deviceRelationship.aiRecommended === 'Similar Device';

                          return (
                            <div
                              key={device.id}
                              className={`p-5 rounded-xl border transition-all ${
                                isDue
                                  ? 'bg-amber-50/30 border-amber-300/80 shadow-2xs'
                                  : isSimilar
                                  ? 'bg-sky-50/30 border-sky-300/80 shadow-2xs'
                                  : 'bg-white border-slate-200/90'
                              }`}
                            >
                              {/* Device Header */}
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200/80">
                                <div className="flex items-center gap-2.5 flex-wrap">
                                  <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                                    Device #{devIdx + 1}
                                  </span>
                                  <SelfValidationBadge issues={issuesForTarget(selfValidation, `step2.device.${device.id}`)} />
                                  <input
                                    type="text"
                                    value={device.deviceProductName}
                                    onChange={(e) =>
                                      handleUpdateDeviceField(
                                        group.id,
                                        device.id,
                                        'deviceProductName',
                                        e.target.value
                                      )
                                    }
                                    placeholder="Device Product Name"
                                    className="font-bold text-sm text-slate-900 bg-transparent border-b border-slate-300 focus:border-slate-900 focus:outline-none px-1 py-0.5 min-w-[200px]"
                                  />
                                </div>
                                <div className="flex items-center gap-2 self-end sm:self-auto">
                                  {device.evidence && (
                                    <EvidenceBadge
                                      evidence={device.evidence}
                                      label="Device Evidence"
                                    />
                                  )}
                                  {group.devices.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleRemoveDeviceFromGroup(group.id, device.id)
                                      }
                                      className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                      title="Remove Device"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Device Parameters Grid */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-xs">
                                <div>
                                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Manufacturer
                                  </label>
                                  <input
                                    type="text"
                                    value={device.manufacturer}
                                    onChange={(e) =>
                                      handleUpdateDeviceField(
                                        group.id,
                                        device.id,
                                        'manufacturer',
                                        e.target.value
                                      )
                                    }
                                    placeholder="e.g. Taewoong Medical"
                                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Device Type
                                  </label>
                                  <input
                                    type="text"
                                    value={device.deviceType}
                                    onChange={(e) =>
                                      handleUpdateDeviceField(
                                        group.id,
                                        device.id,
                                        'deviceType',
                                        e.target.value
                                      )
                                    }
                                    placeholder="e.g. SEMS, LAMS, Plastic"
                                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Covering Type
                                  </label>
                                  <input
                                    type="text"
                                    value={device.coverType}
                                    onChange={(e) =>
                                      handleUpdateDeviceField(
                                        group.id,
                                        device.id,
                                        'coverType',
                                        e.target.value
                                      )
                                    }
                                    placeholder="e.g. Fully covered, Uncovered"
                                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Device Patients (N)
                                  </label>
                                  <input
                                    type="text"
                                    value={device.devicePatientNumber}
                                    onChange={(e) =>
                                      handleUpdateDeviceField(
                                        group.id,
                                        device.id,
                                        'devicePatientNumber',
                                        e.target.value
                                      )
                                    }
                                    placeholder="Not separately reported"
                                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900"
                                  />
                                </div>
                              </div>

                              {/* Dimensions & Indication */}
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3 text-xs">
                                <div>
                                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Diameter
                                  </label>
                                  <input
                                    type="text"
                                    value={device.diameter}
                                    onChange={(e) =>
                                      handleUpdateDeviceField(
                                        group.id,
                                        device.id,
                                        'diameter',
                                        e.target.value
                                      )
                                    }
                                    placeholder="e.g. 10 mm or Not reported"
                                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Length
                                  </label>
                                  <input
                                    type="text"
                                    value={device.length}
                                    onChange={(e) =>
                                      handleUpdateDeviceField(
                                        group.id,
                                        device.id,
                                        'length',
                                        e.target.value
                                      )
                                    }
                                    placeholder="e.g. 60 mm or Not reported"
                                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Reported Indication
                                  </label>
                                  <input
                                    type="text"
                                    value={device.deviceIndication}
                                    onChange={(e) =>
                                      handleUpdateDeviceField(
                                        group.id,
                                        device.id,
                                        'deviceIndication',
                                        e.target.value
                                      )
                                    }
                                    placeholder="e.g. Malignant biliary stricture"
                                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900"
                                  />
                                </div>
                              </div>

                              {/* Classification Row: Device & Indication Relationships */}
                              <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Device Relationship */}
                                <div className="p-3 bg-slate-50/80 rounded-lg border border-slate-200/90 space-y-2">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-bold text-slate-900">
                                      Device Relationship
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      {(device.dueMatchStatus === 'Needs confirmation' || device.matchBasis === 'Needs confirmation') && (
                                        <span className="text-xs bg-amber-100 text-amber-900 border border-amber-300 font-semibold px-1.5 py-0.5 rounded">
                                          Needs confirmation
                                        </span>
                                      )}
                                      {(device.dueMatchStatus === 'Review required' || device.dueMatchStatus === 'Multiple DUE match – Review required' || device.dueMatchStatus === 'Configuration conflict – Review required') && (
                                        <span className="text-xs bg-amber-100 text-amber-900 border border-amber-300 font-semibold px-1.5 py-0.5 rounded">
                                          Review Required
                                        </span>
                                      )}
                                      <span className="text-xs text-slate-600 font-mono font-semibold">
                                        AI: {device.deviceRelationship.aiRecommended}
                                      </span>
                                    </div>
                                  </div>

                                  {device.matchedDueName && (
                                    <div className="text-xs bg-white p-1.5 rounded border border-slate-200 text-slate-700 flex items-center gap-1.5">
                                      <span className="font-semibold text-slate-900">Matched DUE:</span>
                                      <span className="text-slate-800 font-medium truncate">
                                        {device.matchedDueName}
                                      </span>
                                    </div>
                                  )}

                                  {device.deviceRelationship.aiRecommended === 'Similar Device' && device.mappedSimilarDeviceName && (
                                    <div className="text-xs bg-white p-1.5 rounded border border-slate-200 text-slate-700 flex items-center gap-1.5">
                                      <span className="font-semibold text-slate-900">Similar Device:</span>
                                      <span className="text-slate-800 font-medium truncate">
                                        {device.mappedSimilarDeviceName}
                                        {device.mappedSimilarDeviceManufacturer ? ` (${device.mappedSimilarDeviceManufacturer})` : ''}
                                      </span>
                                    </div>
                                  )}

                                  <div className="flex items-center gap-2">
                                    <label className="text-xs text-slate-700 font-semibold">
                                      User final:
                                    </label>
                                    <select
                                      value={device.deviceRelationship.userFinal}
                                      onChange={(e) => {
                                        const val = e.target.value as DeviceRelationshipType;
                                        const updatedDevices = group.devices.map((d) =>
                                          d.id === device.id
                                            ? {
                                                ...d,
                                                deviceRelationship: {
                                                  ...d.deviceRelationship,
                                                  userFinal: val,
                                                },
                                              }
                                            : d
                                        );
                                        const updated = researchGroups.map((g) =>
                                          g.id === group.id ? { ...g, devices: updatedDevices } : g
                                        );
                                        onUpdateResearchGroups(updated);
                                      }}
                                      className="flex-1 px-2.5 py-1 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900 font-semibold text-slate-900"
                                    >
                                      <option value="DUE">DUE</option>
                                      <option value="Similar Device">Similar Device</option>
                                      <option value="Other Device">Other Device</option>
                                      <option value="Not reported">Not reported</option>
                                    </select>
                                  </div>
                                  {device.deviceRelationship.rationale && (
                                    <p className="text-xs text-slate-600 leading-tight">
                                      <span className="font-semibold text-slate-700">AI Rationale: </span>
                                      {device.deviceRelationship.rationale}
                                    </p>
                                  )}
                                </div>

                                {/* Indication Relationship */}
                                <div className="p-3 bg-slate-50/80 rounded-lg border border-slate-200/90 space-y-2">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-bold text-slate-900">
                                      Indication Relationship
                                    </span>
                                    <span className="text-xs text-slate-600 font-mono font-semibold">
                                      AI: {device.indicationRelationship.aiRecommended}
                                    </span>
                                  </div>

                                  {(device.matchedDueIndication || device.indicationRelationship.matchedDueIndication) && (
                                    <div className="text-xs bg-white p-1.5 rounded border border-slate-200 text-slate-700 flex flex-col gap-0.5">
                                      <div className="flex items-center gap-1">
                                        <span className="font-semibold text-slate-900">Matched Indication:</span>
                                      </div>
                                      <span className="text-slate-800 font-medium">
                                        {device.matchedDueIndication || device.indicationRelationship.matchedDueIndication}
                                      </span>
                                    </div>
                                  )}

                                  <div className="flex items-center gap-2">
                                    <label className="text-xs text-slate-700 font-semibold">
                                      User final:
                                    </label>
                                    <select
                                      value={device.indicationRelationship.userFinal}
                                      onChange={(e) => {
                                        const val = e.target.value as IndicationRelationshipType;
                                        const updatedDevices = group.devices.map((d) =>
                                          d.id === device.id
                                            ? {
                                                ...d,
                                                indicationRelationship: {
                                                  ...d.indicationRelationship,
                                                  userFinal: val,
                                                },
                                              }
                                            : d
                                        );
                                        const updated = researchGroups.map((g) =>
                                          g.id === group.id ? { ...g, devices: updatedDevices } : g
                                        );
                                        onUpdateResearchGroups(updated);
                                      }}
                                      className="flex-1 px-2.5 py-1 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900 font-semibold text-slate-900"
                                    >
                                      <option value="Same indication">Same indication</option>
                                      <option value="Related indication">Related indication</option>
                                      <option value="Different indication">Different indication</option>
                                      <option value="Mixed indication">Mixed indication</option>
                                      <option value="Not reported">Not reported</option>
                                    </select>
                                  </div>
                                  {device.indicationRelationship.rationale && (
                                    <p className="text-xs text-slate-600 leading-tight">
                                      <span className="font-semibold text-slate-700">AI Rationale: </span>
                                      {device.indicationRelationship.rationale}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Navigation Controls */}
      <div className="flex items-center justify-between pt-6 border-t border-slate-200">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-lg text-sm font-semibold transition-colors cursor-pointer shadow-2xs"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Step 1</span>
        </button>
        <button
          type="button"
          onClick={onProceed}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold transition-colors shadow-2xs cursor-pointer"
        >
          <span>Proceed to Step 3. Article Appraisal</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
