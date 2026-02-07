/**
 * Equipment Management Page with Hierarchical Location Tree
 */
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DeleteConfirmModal } from './components/DeleteConfirmModal';
import {
  Equipment,
  EquipmentLocation,
  equipmentApi,
  Experiment,
  experimentsApi,
} from '../../lib/api';
import { useNavigation } from '../../App';
import {
  Plus,
  X,
  Trash2,
  AlertCircle,
  CheckCircle,
  Circle,
  Lock,
  Play,
  Beaker,
  Activity,
  Network,
  Save,
  Edit3,
  ChevronRight,
  ChevronDown,
  Building2,
  Warehouse,
  Search,
  AlertTriangle,
  Microscope,
  LayoutGrid,
  Check,
  Calendar as CalendarIcon,
  PocketKnife,
  Dna,
  SquareStack,
  Lightbulb,
} from 'lucide-react';

// Helper: Check if maintenance is overdue
function isMaintenanceOverdue(equipment: Equipment | null): boolean {
  if (!equipment || !equipment.maintenanceCycle || !equipment.lastMaintenance) return false;

  const lastDate = new Date(equipment.lastMaintenance);
  const nextDate = new Date(lastDate);
  nextDate.setDate(nextDate.getDate() + equipment.maintenanceCycle);

  return nextDate < new Date();
}

// ==========================================
// Equipment Type Icons
// ==========================================

const IncubatorIcon = ({ size = 14, className = '' }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M7 2H17C18.1046 2 19 2.89543 19 4V8.5V20C19 21.1046 18.1046 22 17 22H7C5.89543 22 5 21.1046 5 20V8.5V4C5 2.89543 5.89543 2 7 2Z" stroke="currentColor" strokeWidth="2" />
    <path d="M7 5C7 4.44772 7.44772 4 8 4H16C16.5523 4 17 4.44772 17 5V5C17 5.55228 16.5523 6 16 6H8C7.44772 6 7 5.55228 7 5V5Z" fill="currentColor" />
    <rect x="8" y="12" width="8" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
    <path d="M5 8L19 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const CentrifugeIcon = ({ size = 14, className = '' }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 500 500" fill="currentColor" className={className}>
    <g transform="scale(1)">
      <path d="M74.6,456.8L74.6,456.8c0.5,2.8,2.9,5,5.9,5h331.3c2.9,0,5.4-2.2,5.8-5h0.1V456v-8v-69.7H74.6V456.8z M367.9,396.5c11.7,0,21.2,9.5,21.2,21.2c0,11.7-9.5,21.2-21.2,21.2s-21.2-9.5-21.2-21.2C346.7,406,356.2,396.5,367.9,396.5z" />
      <path d="M417.2,368.6L353.4,245c-2.1-4-10.6-7.2-19-7.2H157.8c-8.4,0-16.9,3.2-19,7.2L75.1,368.6c-0.2,0.4-0.4,0.7-0.5,1.1h343.1C417.5,369.3,417.3,369,417.2,368.6z M246.1,357.3c-65.6,0-105.8-34.7-93.2-68.4c9.9-26.5,50.8-44.2,93.2-44.2c42.4,0,83.3,17.7,93.2,44.2C351.9,322.6,311.7,357.3,246.1,357.3z" />
      <path d="M159.2,219.6H333c9.7,0,17.6-7.9,17.6-17.6V28.2c0-9.7-7.9-17.6-17.6-17.6H159.2c-9.7,0-17.6,7.9-17.6,17.6V202C141.6,211.7,149.5,219.6,159.2,219.6z M246.1,42.2c40.2,0,72.9,32.6,72.9,72.9c0,40.2-32.6,72.9-72.9,72.9c-40.2,0-72.9-32.6-72.9-72.9C173.3,74.8,205.9,42.2,246.1,42.2z" />
      <circle cx="246.1" cy="115.4" r="17.6" />
    </g>
  </svg>
);

const PCRIcon = ({ size = 14, className = '' }: { size?: number; className?: string }) => (
  <SquareStack size={size} className={className + ' rotate-90'} />
);

const SpectrophotometerIcon = ({ size = 14, className = '' }: { size?: number; className?: string }) => (
  <Lightbulb size={size} className={className} />
);

const SequencerIcon = ({ size = 14, className = '' }: { size?: number; className?: string }) => <Dna size={size} className={className} />;

function getEquipmentIcon(type: string) {
  switch (type) {
    case 'incubator':
      return IncubatorIcon;
    case 'centrifuge':
      return CentrifugeIcon;
    case 'sequencer':
      return SequencerIcon;
    case 'pcr_machine':
      return PCRIcon;
    case 'spectrophotometer':
      return SpectrophotometerIcon;
    case 'microscope':
    default:
      return Microscope;
  }
}

// ==========================================
// Custom Select Component
// ==========================================

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}

function Select({ value, onChange, options, placeholder }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white text-sm text-left focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50 flex items-center justify-between hover:bg-black/30 transition-colors"
      >
        <span className={selectedOption ? 'text-white' : 'text-white/40'}>
          {selectedOption ? selectedOption.label : placeholder || 'Select...'}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed bg-neutral-900 border border-white/10 rounded-lg shadow-xl overflow-hidden"
            style={{
              top: `${dropdownPosition.top + 4}px`,
              left: `${dropdownPosition.left}px`,
              width: `${dropdownPosition.width}px`,
              zIndex: 9999,
            }}
          >
            <div className="max-h-60 overflow-y-auto">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`w-full px-4 py-2 text-sm text-left transition-colors flex items-center justify-between ${option.value === value
                    ? 'bg-brand-primary/20 text-white'
                    : 'text-white/80 hover:bg-white/5'
                    }`}
                >
                  <span>{option.label}</span>
                  {option.value === value && <Check className="w-4 h-4 text-brand-primary" />}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

// ==========================================
// Custom DatePicker Component
// ==========================================

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

function DatePicker({ value, onChange, placeholder }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(
    value ? new Date(value) : null
  );
  const [currentMonth, setCurrentMonth] = useState(
    value ? new Date(value) : new Date()
  );
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const daysInMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth() + 1,
    0
  ).getDate();

  const firstDayOfMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth(),
    1
  ).getDay();

  const handleDateSelect = (day: number) => {
    const newDate = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day
    );
    setSelectedDate(newDate);
    onChange(newDate.toISOString().split('T')[0]);
    setIsOpen(false);
  };

  const formatDate = (date: Date | null) => {
    if (!date) return '';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const goToPreviousMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
    );
  };

  const goToNextMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
    );
  };

  const monthYear = currentMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-1.5 bg-black/30 border border-white/10 rounded text-white text-sm text-left focus:outline-none focus:border-brand-primary/50 flex items-center justify-between hover:bg-black/40 transition-colors"
      >
        <span className={selectedDate ? 'text-white' : 'text-white/40'}>
          {selectedDate ? formatDate(selectedDate) : placeholder || 'Select date...'}
        </span>
        <CalendarIcon className="w-4 h-4 text-white/40" />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 bg-neutral-900 border border-white/10 rounded-lg shadow-xl p-3 w-64">
          {/* Month Navigation */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={goToPreviousMonth}
              className="p-1 hover:bg-white/10 rounded transition-colors"
            >
              <ChevronDown className="w-4 h-4 rotate-90 text-white/60" />
            </button>
            <span className="text-sm font-medium text-white">{monthYear}</span>
            <button
              type="button"
              onClick={goToNextMonth}
              className="p-1 hover:bg-white/10 rounded transition-colors"
            >
              <ChevronDown className="w-4 h-4 -rotate-90 text-white/60" />
            </button>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
              <div
                key={day}
                className="text-center text-xs font-medium text-white/40"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Days */}
          <div className="grid grid-cols-7 gap-1">
            {/* Empty cells for days before month starts */}
            {Array.from({ length: firstDayOfMonth }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}

            {/* Days of the month */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const date = new Date(
                currentMonth.getFullYear(),
                currentMonth.getMonth(),
                day
              );
              const isSelected =
                selectedDate &&
                date.toDateString() === selectedDate.toDateString();
              const isToday = date.toDateString() === new Date().toDateString();

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => handleDateSelect(day)}
                  className={`
                    aspect-square text-sm rounded transition-colors
                    ${isSelected
                      ? 'bg-brand-primary text-white font-medium'
                      : isToday
                        ? 'bg-white/10 text-white'
                        : 'text-white/80 hover:bg-white/5'
                    }
                  `}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// Status Badge Component
// ==========================================

interface StatusBadgeProps {
  status: string;
}

function StatusBadge({ status }: StatusBadgeProps) {
  const config = {
    ONLINE: { color: 'text-green-500', bg: 'bg-green-500/10', icon: CheckCircle, label: 'Online' },
    OFFLINE: { color: 'text-white/30', bg: 'bg-white/5', icon: Circle, label: 'Offline' },
    LOCKED: { color: 'text-yellow-500', bg: 'bg-yellow-500/10', icon: Lock, label: 'Locked' },
  }[status] || { color: 'text-white/30', bg: 'bg-white/5', icon: Circle, label: status };

  const Icon = config.icon;

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 ${config.bg} rounded-md text-xs font-medium ${config.color}`}>
      <Icon size={12} />
      {config.label}
    </div>
  );
}

// ==========================================
// Equipment Type Utilities
// ==========================================

function formatEquipmentType(type: string): string {
  const formatted: Record<string, string> = {
    sequencer: 'Sequencer',
    microscope: 'Microscope',
    centrifuge: 'Centrifuge',
    pcr_machine: 'PCR Machine',
    incubator: 'Incubator',
    spectrophotometer: 'Spectrophotometer',
    freezer: 'Freezer',
  };
  return formatted[type] || type.replace(/_/g, ' ');
}

// ==========================================
// Location Tree Component
// ==========================================

interface TreeNodeProps {
  location: EquipmentLocation;
  allLocations: EquipmentLocation[];
  equipment: Equipment[];
  level: number;
  selectedEquipmentId: string | null;
  onSelectEquipment: (equipment: Equipment) => void;
  onCreateLocation: (parentId: string | null) => void;
  onCreateEquipment: (roomId: string) => void;
  onDeleteLocation: (location: EquipmentLocation) => void;
  onDeleteEquipment: (equipment: Equipment) => void;
}

function TreeNode({ location, allLocations, equipment, level, selectedEquipmentId, onSelectEquipment, onCreateLocation, onCreateEquipment, onDeleteLocation, onDeleteEquipment }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [deleteItem, setDeleteItem] = useState<EquipmentLocation | null>(null);
  const childLocations = allLocations.filter(l => l.parentId === location.id);
  const isRoom = !!location.parentId; // rooms have a parent (facility)
  const roomEquipment = isRoom ? equipment.filter(e => e.locationId === location.id) : [];
  const hasChildren = childLocations.length > 0 || roomEquipment.length > 0;

  // Check if any equipment in this subtree has maintenance issues
  const hasMaintenanceIssue = isRoom
    ? roomEquipment.some(e => isMaintenanceOverdue(e))
    : allLocations.filter(l => l.parentId === location.id).some(room =>
      equipment.filter(e => e.locationId === room.id).some(e => isMaintenanceOverdue(e))
    );

  return (
    <div>
      {deleteItem && (
        <DeleteConfirmModal
          onClose={() => setDeleteItem(null)}
          onConfirm={() => onDeleteLocation(deleteItem)}
          itemName={deleteItem.name}
          itemType={deleteItem.parentId ? 'room' : 'facility'}
        />
      )}

      <div
        className={`group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors select-none text-white/70 hover:bg-white/5 hover:text-white`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
      >
        <button
          className={`p-0.5 rounded hover:bg-white/10 transition-opacity ${hasChildren ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {isRoom ? <Warehouse size={14} className="text-white/50" /> : <Building2 size={14} className="text-white/50" />}

        <span className={`text-sm truncate flex-1 ${hasMaintenanceIssue ? 'text-red-400' : ''}`}>
          {location.name}
        </span>

        {hasMaintenanceIssue && (
          <div title="Maintenance overdue">
            <AlertTriangle size={12} className="text-red-400" />
          </div>
        )}

        {/* Facility "+" → create Room, Room "+" → create Equipment */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (isRoom) {
              onCreateEquipment(location.id);
            } else {
              onCreateLocation(location.id);
            }
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-white/40 hover:text-brand-primary transition-all rounded"
          title={isRoom ? 'Add Equipment' : 'Add Room'}
        >
          <Plus size={12} />
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            setDeleteItem(location);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-white/40 hover:text-red-400 transition-all rounded"
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {isExpanded && (
        <>
          {/* Child locations (rooms under facility) */}
          {childLocations.map(child => (
            <TreeNode
              key={child.id}
              location={child}
              allLocations={allLocations}
              equipment={equipment}
              level={level + 1}
              selectedEquipmentId={selectedEquipmentId}
              onSelectEquipment={onSelectEquipment}
              onCreateLocation={onCreateLocation}
              onCreateEquipment={onCreateEquipment}
              onDeleteLocation={onDeleteLocation}
              onDeleteEquipment={onDeleteEquipment}
            />
          ))}

          {/* Equipment items as leaf nodes under rooms */}
          {roomEquipment.map(equip => (
            <EquipmentTreeLeaf
              key={equip.id}
              equipment={equip}
              level={level + 1}
              isSelected={selectedEquipmentId === equip.id}
              onSelect={() => onSelectEquipment(equip)}
              onDelete={() => onDeleteEquipment(equip)}
            />
          ))}
        </>
      )}
    </div>
  );
}

// Equipment leaf node in tree (like Box in freezer tree)
interface EquipmentTreeLeafProps {
  equipment: Equipment;
  level: number;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function EquipmentTreeLeaf({ equipment, level, isSelected, onSelect, onDelete }: EquipmentTreeLeafProps) {
  const [deleteItem, setDeleteItem] = useState<Equipment | null>(null);
  const overdue = isMaintenanceOverdue(equipment);
  const EquipmentIcon = getEquipmentIcon(equipment.type);

  return (
    <>
      {deleteItem && (
        <DeleteConfirmModal
          onClose={() => setDeleteItem(null)}
          onConfirm={() => onDelete()}
          itemName={deleteItem.name}
          itemType="equipment"
        />
      )}

      <div
        className={`group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors select-none ${isSelected ? 'bg-brand-primary/20 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
          }`}
        style={{ paddingLeft: `${level * 8 + 8}px` }}
        onClick={onSelect}
      >
        {/* Invisible spacer matching the chevron width */}
        <div className="p-0.5 opacity-0 pointer-events-none"><ChevronRight size={14} /></div>

        <EquipmentIcon size={14} className={isSelected ? 'text-brand-primary' : 'text-white/50'} />
        <span className={`text-sm truncate flex-1 ${overdue ? 'text-red-400' : ''}`}>
          {equipment.name}
        </span>

        {overdue && (
          <div title="Maintenance overdue">
            <AlertTriangle size={12} className="text-red-400" />
          </div>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            setDeleteItem(equipment);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-white/40 hover:text-red-400 transition-all rounded"
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </>
  );
}

// ==========================================
// Create Location Modal
// ==========================================

interface CreateLocationModalProps {
  onClose: () => void;
  onCreate: (data: { name: string; description?: string }) => void;
  parentName?: string;
}

function CreateLocationModal({ onClose, onCreate, parentName }: CreateLocationModalProps) {
  const [name, setName] = useState('');

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
    });
    onClose();
  };

  const locationTypeLabel = parentName ? 'Room' : 'Facility';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md bg-neutral-900 border border-white/10 rounded-2xl shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
          <h3 className="text-lg font-semibold text-white">
            {parentName ? `Add ${locationTypeLabel}` : 'Create Facility'}
          </h3>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {parentName && (
            <div className="flex items-center gap-2 text-sm text-white/50 bg-white/5 p-2 rounded-lg">
              <span className="text-brand-primary">↳</span>
              Adding inside: <span className="text-white font-medium">{parentName}</span>
            </div>
          )}

          {/* Show what we're creating */}
          <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
            {parentName ? <Warehouse size={20} className="text-brand-primary" /> : <Building2 size={20} className="text-brand-primary" />}
            <span className="text-sm text-white/70">Creating a <span className="text-white font-medium">{locationTypeLabel}</span></span>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-white/60">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={parentName ? "e.g., Room 201" : "e.g., Main Building"}
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
              autoFocus
            />
          </div>
          {/* 
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/60">Description (Optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
            />
          </div> */}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/5 bg-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-4 py-2 bg-brand-primary text-black text-sm font-medium rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Add Equipment Modal (matches freezer CreateContainerModal style)
// ==========================================

interface AddEquipmentModalProps {
  roomId: string;
  roomName: string;
  onClose: () => void;
  onSave: (data: { name: string; type: string; locationId: string }) => void;
}

function AddEquipmentModal({ roomId, roomName, onClose, onSave }: AddEquipmentModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('microscope');

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      type,
      locationId: roomId,
    });
    onClose();
  };

  const equipmentTypes = [
    { value: 'microscope', label: 'Microscope' },
    { value: 'sequencer', label: 'Sequencer' },
    { value: 'pcr_machine', label: 'PCR Machine' },
    { value: 'centrifuge', label: 'Centrifuge' },
    { value: 'incubator', label: 'Incubator' },
    { value: 'spectrophotometer', label: 'Spectrophotometer' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md bg-neutral-900 border border-white/10 rounded-2xl shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
          <h3 className="text-lg font-semibold text-white">Add Equipment</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm text-white/50 bg-white/5 p-2 rounded-lg">
            <span className="text-brand-primary">↳</span>
            Adding inside: <span className="text-white font-medium">{roomName}</span>
          </div>

          <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
            <PocketKnife size={20} className="text-brand-primary" />
            <span className="text-sm text-white/70">Creating <span className="text-white font-medium">Equipment</span></span>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-white/60">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Zeiss Microscope 1"
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-white/60">Type</label>
            <Select
              value={type}
              onChange={setType}
              options={equipmentTypes}
              placeholder="Select equipment type..."
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/5 bg-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-4 py-2 bg-brand-primary text-black text-sm font-medium rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Equipment Detail View
// ==========================================

interface EquipmentDetailViewProps {
  equipment: Equipment;
  onUpdate: (updated: Equipment) => void;
  onBack: () => void;
}

function EquipmentDetailView({ equipment, onUpdate }: EquipmentDetailViewProps) {
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [watchFolder, setWatchFolder] = useState(equipment.watchFolder || '');
  const [model, setModel] = useState(equipment.model || '');
  const [serialNumber, setSerialNumber] = useState(equipment.serialNumber || '');
  const [metadata, setMetadata] = useState(equipment.metadata || '');
  const [maintenanceCycle, setMaintenanceCycle] = useState(equipment.maintenanceCycle?.toString() || '');
  const [lastMaintenance, setLastMaintenance] = useState(
    equipment.lastMaintenance ? new Date(equipment.lastMaintenance).toISOString().split('T')[0] : ''
  );
  const [showExperimentPicker, setShowExperimentPicker] = useState(false);
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);

  const queryClient = useQueryClient();

  const { data: experiments = [] } = useQuery({
    queryKey: ['experiments'],
    queryFn: experimentsApi.list,
  });

  const { data: entries = [] } = useQuery({
    queryKey: ['experiment-entries', selectedExperiment?.id],
    queryFn: () => selectedExperiment ? experimentsApi.listEntries(selectedExperiment.id) : Promise.resolve([]),
    enabled: !!selectedExperiment,
  });

  const maintenanceOverdue = isMaintenanceOverdue(equipment);

  const handleSaveConfig = async () => {
    try {
      const updated = await equipmentApi.update(equipment.id, {
        watchFolder: watchFolder.trim() || undefined,
        model: model.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        metadata: metadata.trim() || undefined,
        maintenanceCycle: maintenanceCycle ? parseInt(maintenanceCycle) : undefined,
        lastMaintenance: lastMaintenance || undefined,
      });
      onUpdate(updated);
      setIsEditingConfig(false);
      queryClient.invalidateQueries({ queryKey: ['equipment'] });
    } catch (err) {
      console.error('Failed to update equipment:', err);
      alert('Failed to save changes');
    }
  };

  const handleCancelEdit = () => {
    setWatchFolder(equipment.watchFolder || '');
    setModel(equipment.model || '');
    setSerialNumber(equipment.serialNumber || '');
    setMetadata(equipment.metadata || '');
    setMaintenanceCycle(equipment.maintenanceCycle?.toString() || '');
    setLastMaintenance(equipment.lastMaintenance ? new Date(equipment.lastMaintenance).toISOString().split('T')[0] : '');
    setIsEditingConfig(false);
  };

  const handleFindOnNetwork = async () => {
    setIsDiscovering(true);
    setTimeout(() => {
      setIsDiscovering(false);
      alert('Network discovery will be implemented. In Hub mode: mDNS discovery. In Enterprise mode: IP address connection.');
    }, 2000);
  };

  const handleAttachExperiment = async () => {
    if (!selectedExperiment) return;

    try {
      await equipmentApi.update(equipment.id, {
        autoImport: true,
      });

      const timestamp = new Date().toISOString();
      const content = `<p><strong>Auto-import configured for ${equipment.name}</strong></p><p>Watch folder: ${equipment.watchFolder || 'Not configured'}</p><p>Started: ${new Date(timestamp).toLocaleString()}</p>`;

      await experimentsApi.createEntry(selectedExperiment.id, {
        content,
        author: 'system',
      });

      queryClient.invalidateQueries({ queryKey: ['equipment'] });
      alert('Equipment attached to experiment. Data will be automatically uploaded when detected.');
      setShowExperimentPicker(false);
      setSelectedExperiment(null);
    } catch (err) {
      console.error('Failed to attach experiment:', err);
      alert('Failed to attach experiment');
    }
  };

  const hasExistingData = entries.length > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-white/5 p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              {/* <button onClick={onBack} className="text-white/40 hover:text-white transition-colors">
                ← Back
              </button> */}
              {/* <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getEquipmentTypeColor(equipment.type) }}
              /> */}
              <h2 className="text-2xl font-bold text-white">{equipment.name}</h2>
              <StatusBadge status={equipment.agentStatus} />
              {maintenanceOverdue && (
                <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 rounded-md text-xs font-medium text-red-500">
                  <AlertTriangle size={12} />
                  Maintenance Overdue
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-white/50">
              <span>{formatEquipmentType(equipment.type)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isEditingConfig ? (
              <button
                onClick={() => setIsEditingConfig(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-white/60 hover:text-white hover:bg-white/10 border border-white/10 rounded-lg transition-colors text-sm"
              >
                <Edit3 size={16} />
                Edit Configuration
              </button>
            ) : (
              <>
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 text-sm text-white/60 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveConfig}
                  className="flex items-center gap-2 px-3 py-1.5 bg-brand-primary text-black text-sm font-medium rounded-lg hover:bg-brand-secondary transition-colors"
                >
                  <Save size={16} />
                  Save
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white mb-4">Equipment Configuration</h3>

          <div className="flex items-start gap-3">
            <div className="text-white/40 text-sm font-medium w-32">Model:</div>
            {isEditingConfig ? (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g., Axio Observer Z1"
                className="flex-1 px-3 py-1.5 bg-black/30 border border-white/10 rounded text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
              />
            ) : (
              <div className="text-white text-sm">{equipment.model || <span className="text-white/30">Not set</span>}</div>
            )}
          </div>

          <div className="flex items-start gap-3">
            <div className="text-white/40 text-sm font-medium w-32">Serial Number:</div>
            {isEditingConfig ? (
              <input
                type="text"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                placeholder="e.g., SN123456"
                className="flex-1 px-3 py-1.5 bg-black/30 border border-white/10 rounded text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
              />
            ) : (
              <div className="text-white text-sm">{equipment.serialNumber || <span className="text-white/30">Not set</span>}</div>
            )}
          </div>

          <div className="flex items-start gap-3">
            <div className="text-white/40 text-sm font-medium w-32">Watch Folder:</div>
            {isEditingConfig ? (
              <div className="flex-1 space-y-1">
                <input
                  type="text"
                  value={watchFolder}
                  onChange={(e) => setWatchFolder(e.target.value)}
                  placeholder="e.g., C:\Data\Microscope\Output"
                  className="w-full px-3 py-1.5 bg-black/30 border border-white/10 rounded text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50 font-mono"
                />
                <p className="text-xs text-white/40">Path where equipment saves output files</p>
              </div>
            ) : (
              <div className="text-white text-sm font-mono">
                {equipment.watchFolder ? (
                  <span className="bg-black/30 px-2 py-1 rounded">{equipment.watchFolder}</span>
                ) : (
                  <span className="text-white/30">Not configured</span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-start gap-3">
            <div className="text-white/40 text-sm font-medium w-32">Maintenance:</div>
            {isEditingConfig ? (
              <div className="flex-1 space-y-2">
                <div>
                  <label className="text-xs text-white/60">Cycle (days):</label>
                  <input
                    type="number"
                    value={maintenanceCycle}
                    onChange={(e) => setMaintenanceCycle(e.target.value)}
                    placeholder="e.g., 90"
                    className="w-full px-3 py-1.5 bg-black/30 border border-white/10 rounded text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/60">Last Maintenance:</label>
                  <DatePicker
                    value={lastMaintenance}
                    onChange={setLastMaintenance}
                    placeholder="Select date..."
                  />
                </div>
              </div>
            ) : (
              <div className="text-white text-sm space-y-1">
                {equipment.maintenanceCycle ? (
                  <>
                    <div>Every {equipment.maintenanceCycle} days</div>
                    {equipment.lastMaintenance && (
                      <div className="text-xs text-white/40">
                        Last: {new Date(equipment.lastMaintenance).toLocaleDateString()}
                        {maintenanceOverdue && <span className="text-red-400 ml-2">OVERDUE</span>}
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-white/30">No maintenance schedule</span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-start gap-3">
            <div className="text-white/40 text-sm font-medium w-32">Notes:</div>
            {isEditingConfig ? (
              <textarea
                value={metadata}
                onChange={(e) => setMetadata(e.target.value)}
                placeholder="Calibration date, maintenance notes, etc."
                rows={3}
                className="flex-1 px-3 py-1.5 bg-black/30 border border-white/10 rounded text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50 resize-none"
              />
            ) : (
              <div className="text-white text-sm whitespace-pre-wrap flex-1">
                {equipment.metadata || <span className="text-white/30">No notes</span>}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Network size={20} className="text-brand-primary" />
            Network Connection
          </h3>
          <p className="text-sm text-white/60 mb-4">
            Connect to the openbio-agent running on this equipment's computer.
          </p>
          <button
            onClick={handleFindOnNetwork}
            disabled={isDiscovering}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-primary text-black text-sm font-medium rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50"
          >
            <Network size={16} />
            {isDiscovering ? 'Searching...' : 'Find on Network'}
          </button>
          {equipment.agentStatus === 'ONLINE' && (
            <p className="mt-3 text-sm text-green-500 flex items-center gap-2">
              <CheckCircle size={16} />
              Connected
            </p>
          )}
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Beaker size={20} className="text-brand-primary" />
            Attach to Experiment
          </h3>

          {!showExperimentPicker ? (
            <div className="space-y-4">
              <p className="text-sm text-white/60">
                Attach this equipment to an experiment to enable automatic data upload when new files are detected.
              </p>
              {!equipment.watchFolder && (
                <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <AlertCircle size={16} className="text-yellow-500 mt-0.5" />
                  <div className="text-xs text-yellow-500/70">
                    Configure a watch folder above before attaching to an experiment.
                  </div>
                </div>
              )}
              <button
                onClick={() => setShowExperimentPicker(true)}
                disabled={!equipment.watchFolder}
                className="flex items-center gap-2 px-4 py-2.5 bg-brand-primary text-black text-sm font-medium rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Beaker size={16} />
                Attach Experiment
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-white">Select Experiment</h4>
                <button onClick={() => setShowExperimentPicker(false)} className="text-white/40 hover:text-white">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {experiments.map((exp: Experiment) => (
                  <button
                    key={exp.id}
                    onClick={() => setSelectedExperiment(exp)}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${selectedExperiment?.id === exp.id
                      ? 'bg-brand-primary/20 border-brand-primary text-white'
                      : 'bg-black/20 border-white/10 text-white/70 hover:border-brand-primary/30'
                      }`}
                  >
                    <div className="font-medium text-sm">{exp.name}</div>
                    {exp.description && <div className="text-xs text-white/40 mt-1">{exp.description}</div>}
                  </button>
                ))}
              </div>

              {selectedExperiment && (
                <>
                  {hasExistingData && (
                    <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <AlertCircle size={16} className="text-red-500 mt-0.5" />
                      <div className="text-xs text-red-500/70">
                        This experiment already has data. Auto-import can only be enabled for experiments with no existing data.
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={handleAttachExperiment}
                      disabled={hasExistingData}
                      className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-black text-sm font-medium rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Play size={16} />
                      {hasExistingData ? 'Experiment Has Data' : 'Attach & Enable Auto-Import'}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedExperiment(null);
                        setShowExperimentPicker(false);
                      }}
                      className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Activity size={20} className={equipment.agentStatus === 'ONLINE' ? 'text-green-500' : 'text-white/40'} />
            <div className="flex-1">
              <div className="text-sm font-medium text-white mb-1">Status</div>
              <div className="text-xs text-white/60">
                {equipment.agentStatus === 'ONLINE' && 'Agent connected and monitoring'}
                {equipment.agentStatus === 'OFFLINE' && 'Agent offline - click "Find on Network" to connect'}
                {equipment.agentStatus === 'LOCKED' && 'Agent busy processing data'}
              </div>
              {equipment.autoImport && (
                <div className="mt-2 text-xs text-green-500 flex items-center gap-1">
                  <CheckCircle size={12} />
                  Auto-import enabled for attached experiment
                </div>
              )}
              {equipment.lastSyncAt && (
                <div className="mt-2 text-xs text-white/40">
                  Last sync: {new Date(equipment.lastSyncAt).toLocaleString()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Main Equipment Page
// ==========================================

export const EquipmentPage: React.FC = () => {
  const { pendingItemId, clearPendingItem } = useNavigation();
  const [showAddLocationModal, setShowAddLocationModal] = useState(false);
  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false);
  const [createLocationParentId, setCreateLocationParentId] = useState<string | null>(null);
  const [addEquipmentRoomId, setAddEquipmentRoomId] = useState<string | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();

  const { data: equipment = [] } = useQuery({
    queryKey: ['equipment'],
    queryFn: equipmentApi.list,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['equipment-locations'],
    queryFn: equipmentApi.listLocations,
  });

  // Auto-navigate to equipment when coming from experiment mention click
  useEffect(() => {
    if (pendingItemId && equipment.length > 0) {
      const equip = equipment.find((e: Equipment) => e.id === pendingItemId);
      if (equip) {
        setSelectedEquipment(equip);
        setSearchQuery('');
      }
      clearPendingItem();
    }
  }, [pendingItemId, equipment, clearPendingItem]);

  const createLocationMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; color?: string; parentId?: string }) =>
      equipmentApi.createLocation({
        name: data.name,
        description: data.description,
        color: data.color,
        parentId: data.parentId || createLocationParentId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equipment-locations'] });
    },
  });

  const deleteLocationMutation = useMutation({
    mutationFn: equipmentApi.deleteLocation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equipment-locations'] });
    },
  });

  const createEquipmentMutation = useMutation({
    mutationFn: (data: { name: string; type: string; locationId: string }) =>
      equipmentApi.create({
        name: data.name,
        type: data.type,
        locationId: data.locationId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equipment'] });
    },
  });

  const deleteEquipmentMutation = useMutation({
    mutationFn: equipmentApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equipment'] });
      if (selectedEquipment && selectedEquipment.id === deleteEquipmentMutation.variables) {
        setSelectedEquipment(null);
      }
    },
  });

  const filteredEquipment = searchQuery
    ? equipment.filter((e: Equipment) =>
      e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.model && e.model.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (e.metadata && e.metadata.toLowerCase().includes(searchQuery.toLowerCase()))
    )
    : [];

  const addEquipmentRoom = addEquipmentRoomId ? locations.find(l => l.id === addEquipmentRoomId) : null;

  return (
    <div className="h-full flex flex-col">
      <div className="h-16 flex items-center justify-between px-6 border-b border-white/5 bg-surface/30 backdrop-blur-md flex-shrink-0">
        <h2 className="text-lg font-semibold text-white">
          {/* {selectedEquipment ? selectedEquipment.name : 'Equipment'} */}
          &nbsp;
        </h2>

        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 w-4 h-4 group-focus-within:text-brand-primary transition-colors" />
            <input
              type="text"
              placeholder="Search equipment..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-1.5 bg-black/20 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50 w-64 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex min-h-0">
        {/* Sidebar - Tree */}
        <div className="w-64 bg-black/20 border-r border-white/5 overflow-y-auto flex-shrink-0">
          <div className="space-y-1">
            <div className="flex items-center justify-between px-4 pt-4 mb-2">
              <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">Locations</h3>
              <button
                onClick={() => {
                  setCreateLocationParentId(null);
                  setShowAddLocationModal(true);
                }}
                className="w-6 h-6 flex items-center justify-center text-white/40 hover:text-brand-primary hover:bg-brand-primary/10 rounded transition-colors"
                title="Add Facility"
              >
                <Plus size={14} />
              </button>
            </div>

            {locations.length === 0 ? (
              <div className="text-sm mx-4 text-white/30 px-2 py-4 text-center border border-dashed border-white/10 rounded-lg">
                No facilities yet.
                <br />
                <button
                  onClick={() => {
                    setCreateLocationParentId(null);
                    setShowAddLocationModal(true);
                  }}
                  className="text-brand-primary hover:underline mt-1"
                >
                  Add Facility
                </button>
              </div>
            ) : (
              <div className="px-2.5">
                {locations.filter(l => !l.parentId).map(location => (
                  <TreeNode
                    key={location.id}
                    location={location}
                    allLocations={locations}
                    equipment={equipment}
                    level={0}
                    selectedEquipmentId={selectedEquipment?.id || null}
                    onSelectEquipment={(equip) => {
                      setSelectedEquipment(equip);
                      setSearchQuery('');
                    }}
                    onCreateLocation={(parentId) => {
                      setCreateLocationParentId(parentId);
                      setShowAddLocationModal(true);
                    }}
                    onCreateEquipment={(roomId) => {
                      setAddEquipmentRoomId(roomId);
                      setShowAddEquipmentModal(true);
                    }}
                    onDeleteLocation={(location) => deleteLocationMutation.mutate(location.id)}
                    onDeleteEquipment={(equipment) => deleteEquipmentMutation.mutate(equipment.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* View Area */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-6xl mx-auto">
            {searchQuery ? (
              /* Search Results View */
              <div>
                <div className="mb-6">
                  <h2 className="text-2xl font-bold text-white">Search Results</h2>
                  <p className="text-white/40 text-sm">{filteredEquipment.length} result{filteredEquipment.length !== 1 ? 's' : ''} found</p>
                </div>

                {filteredEquipment.length > 0 ? (
                  <div className="space-y-3">
                    {filteredEquipment.map((equip: Equipment) => (
                      <div
                        key={equip.id}
                        onClick={() => {
                          setSelectedEquipment(equip);
                          setSearchQuery('');
                        }}
                        className="bg-surface/50 hover:bg-neutral-900/80 border border-white/10 rounded-xl p-5 hover:border-brand-primary/30 transition-colors cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-1">
                              {/* <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getEquipmentTypeColor(equip.type) }} /> */}
                              <h3 className="text-lg font-semibold text-white">{equip.name}</h3>
                              <StatusBadge status={equip.agentStatus} />
                            </div>
                            <p className="text-sm text-white/50">{formatEquipmentType(equip.type)}</p>
                            {equip.model && <p className="text-sm text-white/30 mt-1">Model: {equip.model}</p>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-white/40">
                    No equipment found matching "{searchQuery}"
                  </div>
                )}
              </div>
            ) : selectedEquipment ? (
              /* Equipment selected - show detail */
              <EquipmentDetailView
                equipment={selectedEquipment}
                onUpdate={(updated) => {
                  setSelectedEquipment(updated);
                  queryClient.invalidateQueries({ queryKey: ['equipment'] });
                }}
                onBack={() => setSelectedEquipment(null)}
              />
            ) : (
              /* Nothing selected - prompt to select equipment (like freezer's "Select a Box") */
              <div className="flex flex-col items-center pt-16 text-white/30">
                <div className="w-16 h-16 mb-4 rounded-xl bg-white/5 flex items-center justify-center">
                  <LayoutGrid size={32} className="opacity-50" />
                </div>
                <p className="text-lg font-medium">
                  {locations.length === 0 ? 'No Equipment Yet' : 'Select Equipment'}
                </p>
                <p className="text-sm">
                  {locations.length === 0
                    ? 'Use the tree on the left to create your first facility'
                    : 'Use the tree on the left to navigate to equipment'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {showAddLocationModal && (
        <CreateLocationModal
          onClose={() => {
            setShowAddLocationModal(false);
            setCreateLocationParentId(null);
          }}
          onCreate={(data) => createLocationMutation.mutate(data)}
          parentName={createLocationParentId ? locations.find(l => l.id === createLocationParentId)?.name : undefined}
        />
      )}

      {showAddEquipmentModal && addEquipmentRoom && (
        <AddEquipmentModal
          roomId={addEquipmentRoom.id}
          roomName={addEquipmentRoom.name}
          onClose={() => {
            setShowAddEquipmentModal(false);
            setAddEquipmentRoomId(null);
          }}
          onSave={(data) => createEquipmentMutation.mutate(data)}
        />
      )}
    </div>
  );
};
