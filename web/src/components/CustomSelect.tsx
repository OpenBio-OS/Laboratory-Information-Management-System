// CustomSelect - A styled dropdown component with keyboard navigation

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  className?: string;
  disabled?: boolean;
}

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = 'Select an option',
  searchable = false,
  className = '',
  disabled = false,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  const filteredOptions = searchable && searchQuery
    ? options.filter((o) =>
      o.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.description?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    : options;

  // Calculate position synchronously for rendering
  const getPosition = () => {
    if (!buttonRef.current) return { top: 0, left: 0, width: 0, maxHeight: 300 };
    const rect = buttonRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spacing = 4;
    const maxDropdownHeight = 300;

    // Calculate available space below and above
    const spaceBelow = viewportHeight - rect.bottom - spacing;
    const spaceAbove = rect.top - spacing;

    // Decide direction and calculate position
    const openUpward = spaceBelow < 150 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(maxDropdownHeight, openUpward ? spaceAbove : spaceBelow);

    return {
      top: openUpward ? undefined : rect.bottom + spacing,
      bottom: openUpward ? viewportHeight - rect.top + spacing : undefined,
      left: rect.left,
      width: rect.width,
      maxHeight,
    };
  };

  const position = isOpen ? getPosition() : { top: 0, left: 0, width: 0, maxHeight: 300 };

  // Focus search input when opening
  useEffect(() => {
    if (isOpen && searchable && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen, searchable]);

  // Reset search when closing
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setHighlightedIndex(0);
    }
  }, [isOpen]);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isOpen) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setHighlightedIndex((prev) =>
            prev < filteredOptions.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          event.preventDefault();
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
          event.preventDefault();
          if (filteredOptions[highlightedIndex]) {
            onChange(filteredOptions[highlightedIndex].value);
            setIsOpen(false);
          }
          break;
        case 'Escape':
          event.preventDefault();
          setIsOpen(false);
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, highlightedIndex, filteredOptions, onChange]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full flex items-center justify-between px-4 py-2.5 bg-black/30 border border-white/10 rounded-xl text-sm text-left transition-all hover:border-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        <span className="flex items-center gap-2 truncate">
          {selectedOption?.icon}
          <span className={selectedOption ? 'text-white' : 'text-white/50'}>
            {selectedOption?.label || placeholder}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`text-white/40 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] bg-neutral-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
          >
            {/* Search Input */}
            {searchable && (
              <div className="p-2 border-b border-white/10">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
                  />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setHighlightedIndex(0);
                    }}
                    placeholder="Search..."
                    className="w-full pl-8 pr-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
                  />
                </div>
              </div>
            )}

            {/* Options */}
            <div className="overflow-auto max-h-[240px]">
              {filteredOptions.length === 0 ? (
                <div className="px-4 py-3 text-sm text-white/40 text-center">
                  No options found
                </div>
              ) : (
                filteredOptions.map((option, index) => (
                  <button
                    key={option.value}
                    onClick={() => handleSelect(option.value)}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${index === highlightedIndex
                      ? 'bg-brand-primary/20 text-brand-primary'
                      : 'text-white/80 hover:bg-white/5'
                      }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {option.icon}
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{option.label}</div>
                        {option.description && (
                          <div className="text-xs text-white/40 truncate">
                            {option.description}
                          </div>
                        )}
                      </div>
                    </div>
                    {option.value === value && (
                      <Check size={16} className="text-brand-primary flex-shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
