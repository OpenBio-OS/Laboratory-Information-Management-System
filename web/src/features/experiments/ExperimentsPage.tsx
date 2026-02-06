/**
 * Experiments Page - Laboratory Notebook with Folder Organization
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  experimentsApi,
  Experiment,
  SearchResult,
} from '../../lib/api';
import {
  FlaskConical,
  Plus,
  X,
  Trash2,
  Paperclip,
  ChevronRight,
  AtSign,
  ChevronDown,
  Check,
  AlertTriangle,
  Bold,
  Italic,
  Heading1,
  List,
  ListOrdered,
  RefreshCw,
  ExternalLink,
  NotebookText,
  Beaker,
  Microscope,
  ShieldQuestionMark,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent, NodeViewWrapper, NodeViewProps, ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import { mergeAttributes } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import { useNavigation, TabId } from '../../App';
import { useApi } from '../../lib/ApiContext';

// ==========================================
// Rich Mention Data Types
// ==========================================

interface MentionData {
  id: string;
  name: string;
  entityType: 'sample' | 'equipment' | 'paper';
  category: string;
  subcategory: string;
  path: string[];
  notes?: string;          // Sample notes or paper notes at time of mention
  mentionedAt: string;     // ISO timestamp when mention was created
}

// ==========================================
// Mention Node View Component with Hover & Click
// ==========================================

function MentionNodeView({ node, updateAttributes }: NodeViewProps) {
  const { navigateTo } = useNavigation();
  const { apiUrl } = useApi();
  const [showTooltip, setShowTooltip] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const mentionRef = useRef<HTMLSpanElement>(null);

  const data = node.attrs as MentionData;

  // Safely get path as array (handles old mentions that might have malformed data)
  const getPath = (): string[] => {
    if (Array.isArray(data.path)) return data.path;
    if (typeof data.path === 'string') return [data.path];
    return [data.name || 'Unknown'];
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Navigate based on entity type OR category as fallback
    let targetTab: TabId = 'freezer';
    if (data.entityType === 'paper' || data.category === 'Library') {
      targetTab = 'library';
    } else if (data.entityType === 'equipment' || data.category === 'Equipment') {
      targetTab = 'equipment';
    } else if (data.entityType === 'sample' || data.category === 'Freezer') {
      targetTab = 'freezer';
    }

    navigateTo({ tab: targetTab, itemId: data.id });
  };

  const handleMouseEnter = () => {
    if (mentionRef.current) {
      const rect = mentionRef.current.getBoundingClientRect();
      setTooltipPosition({ x: rect.left, y: rect.bottom + 4 });
    }
    setShowTooltip(true);
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };

  const handleUpdateMetadata = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsUpdating(true);

    try {
      // Fetch current data from the API
      const response = await fetch(`${apiUrl}/api/experiments/search-entities`);
      if (response.ok) {
        const entities: SearchResult[] = await response.json();
        const currentEntity = entities.find(e => e.id === data.id);

        if (currentEntity) {
          // Update the mention attributes with fresh data
          updateAttributes({
            name: currentEntity.name,
            category: currentEntity.category,
            subcategory: currentEntity.subcategory,
            path: currentEntity.path,
            notes: currentEntity.notes,
            mentionedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.error('Failed to update notes:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  const getEntityIcon = () => {
    switch (data.entityType) {
      case 'sample': return <Beaker size={16} className="opacity-50" />
      case 'paper': return <NotebookText size={16} className='opacity-50' />;
      case 'equipment': return <Microscope size={16} className="opacity-50" />;
      default: return <ShieldQuestionMark size={16} className="opacity-50" />;
    }
  };

  // Strip HTML tags from notes for display
  const getPlainTextNotes = () => {
    if (!data.notes) return null;
    // Strip HTML tags and get plain text preview
    const div = document.createElement('div');
    div.innerHTML = data.notes;
    const text = div.textContent || div.innerText || '';
    return text.trim().slice(0, 300) + (text.length > 300 ? '...' : '');
  };

  const formatDate = (isoString: string) => {
    if (!isoString) return 'Unknown';
    return new Date(isoString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <NodeViewWrapper as="span" className="inline">
      <span
        ref={mentionRef}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="mention bg-brand-primary/20 text-brand-primary px-1.5 py-0.5 rounded cursor-pointer hover:bg-brand-primary/30 transition-colors inline-flex items-center gap-1"
      >
        <span>{getEntityIcon()}</span>
        <span>@{data.name}</span>
      </span>

      {showTooltip && createPortal(
        <div
          className="fixed z-[9999] bg-neutral-900 border border-white/20 rounded-xl shadow-2xl p-4 min-w-[280px] max-w-[360px] animate-fade-in"
          style={{ left: tooltipPosition.x, top: tooltipPosition.y }}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <div className="flex items-center gap-2">
                {/* <span className="text-lg">{getEntityIcon()}</span> */}
                <span className="font-semibold text-white">{data.name || 'Unknown'}</span>
              </div>
              <div className="text-xs text-white/50 mt-1">
                {getPath().join(' › ')}
              </div>
            </div>
            <span className="text-xs px-2 py-0.5 bg-white/10 rounded text-white/60 capitalize">
              {data.entityType}
            </span>
          </div>

          {/* Notes Snapshot */}
          {getPlainTextNotes() && (
            <div className="border-t border-white/10 pt-3 mb-3">
              <div className="text-xs text-white/40 mb-2 uppercase tracking-wide">Notes Snapshot</div>
              <div className="text-sm text-white/70 whitespace-pre-wrap">
                {getPlainTextNotes()}
              </div>
            </div>
          )}

          {/* Mentioned timestamp */}
          <div className="text-xs text-white/40 mb-3">
            Mentioned: {formatDate(data.mentionedAt)}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-white/10">
            <button
              onClick={handleUpdateMetadata}
              disabled={isUpdating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/10 hover:bg-white/20 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={isUpdating ? 'animate-spin' : ''} />
              <span>Update Notes</span>
            </button>
            <button
              onClick={handleClick}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-brand-primary/20 hover:bg-brand-primary/30 text-brand-primary rounded-lg transition-colors"
            >
              <ExternalLink size={12} />
              <span>Go to Item</span>
            </button>
          </div>
        </div>,
        document.body
      )}
    </NodeViewWrapper>
  );
}

// ==========================================
// Custom Mention Extension with Rich Data
// ==========================================

const RichMention = Mention.extend({
  name: 'mention',

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-id'),
        renderHTML: (attrs: Record<string, any>) => attrs.id ? { 'data-id': attrs.id } : {},
      },
      name: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-name'),
        renderHTML: (attrs: Record<string, any>) => attrs.name ? { 'data-name': attrs.name } : {},
      },
      entityType: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-entity-type'),
        renderHTML: (attrs: Record<string, any>) => attrs.entityType ? { 'data-entity-type': attrs.entityType } : {},
      },
      category: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-category'),
        renderHTML: (attrs: Record<string, any>) => attrs.category ? { 'data-category': attrs.category } : {},
      },
      subcategory: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-subcategory'),
        renderHTML: (attrs: Record<string, any>) => attrs.subcategory ? { 'data-subcategory': attrs.subcategory } : {},
      },
      path: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute('data-path');
          if (!raw) return [];
          try { return JSON.parse(raw); } catch { return [raw]; }
        },
        renderHTML: (attrs: Record<string, any>) => {
          const p = Array.isArray(attrs.path) ? attrs.path : [];
          return p.length > 0 ? { 'data-path': JSON.stringify(p) } : {};
        },
      },
      notes: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-notes'),
        renderHTML: (attrs: Record<string, any>) => attrs.notes ? { 'data-notes': attrs.notes } : {},
      },
      mentionedAt: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-mentioned-at'),
        renderHTML: (attrs: Record<string, any>) => attrs.mentionedAt ? { 'data-mentioned-at': attrs.mentionedAt } : {},
      },
      label: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-label'),
        renderHTML: (attrs: Record<string, any>) => attrs.label ? { 'data-label': attrs.label } : {},
      },
    };
  },

  // Override renderHTML to ensure ALL data attributes make it into the serialized HTML.
  // The base Mention extension's renderHTML has a bug where the option's renderHTML
  // returns a complete element spec, causing the attribute-level HTMLAttributes to be ignored.
  renderHTML({ node, HTMLAttributes }) {
    const displayName = node.attrs.name || node.attrs.label || node.attrs.id || 'unknown';
    return [
      'span',
      mergeAttributes(
        { 'data-type': this.name },
        this.options.HTMLAttributes || {},
        HTMLAttributes,
      ),
      `@${displayName}`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionNodeView);
  },
});

// ==========================================
// Hierarchical Mention Picker (Windows Start Menu style)
// ==========================================

interface MentionListProps {
  items: SearchResult[];
  command: (item: SearchResult) => void;
}

interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

type NavigationLevel = 'category' | 'subcategory' | 'item';

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'sample': <Beaker className='inline' size={14} style={{ display: 'inline' }} />,
  'paper': <NotebookText className='inline' size={14} style={{ display: 'inline' }} />,
  'equipment': <Microscope className='inline' size={14} style={{ display: 'inline' }} />,
};

const MentionList = React.forwardRef<MentionListRef, MentionListProps>(
  ({ items, command }, ref) => {
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [currentLevel, setCurrentLevel] = useState<NavigationLevel>('category');
    const [searchQuery, setSearchQuery] = useState('');

    // Reset when items change (new search)
    useEffect(() => {
      setSelectedCategory(null);
      setSelectedSubcategory(null);
      setSelectedIndex(0);
      setCurrentLevel('category');
      setSearchQuery('');
    }, [items]);

    // Get unique categories
    const categories = [...new Set(items.map(i => i.category))];

    // Get subcategories for selected category
    const subcategories = selectedCategory
      ? [...new Set(items.filter(i => i.category === selectedCategory).map(i => i.subcategory))]
      : [];

    // Get items for selected subcategory (filtered by search)
    const filteredItems = selectedSubcategory
      ? items.filter(i =>
        i.category === selectedCategory &&
        i.subcategory === selectedSubcategory &&
        (searchQuery === '' || i.name.toLowerCase().includes(searchQuery.toLowerCase()))
      )
      : [];

    // Get current list based on navigation level
    const getCurrentList = () => {
      if (currentLevel === 'category') return categories;
      if (currentLevel === 'subcategory') return subcategories;
      return filteredItems.map(i => i.name);
    };

    const currentList = getCurrentList();

    // Keyboard navigation
    React.useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + currentList.length - 1) % currentList.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % currentList.length);
          return true;
        }
        if (event.key === 'ArrowRight' || event.key === 'Enter') {
          if (currentLevel === 'category' && categories[selectedIndex]) {
            setSelectedCategory(categories[selectedIndex]);
            setCurrentLevel('subcategory');
            setSelectedIndex(0);
            return true;
          }
          if (currentLevel === 'subcategory' && subcategories[selectedIndex]) {
            setSelectedSubcategory(subcategories[selectedIndex]);
            setCurrentLevel('item');
            setSelectedIndex(0);
            return true;
          }
          if (currentLevel === 'item' && filteredItems[selectedIndex]) {
            command(filteredItems[selectedIndex]);
            return true;
          }
        }
        if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
          if (currentLevel === 'item') {
            setSelectedSubcategory(null);
            setCurrentLevel('subcategory');
            setSelectedIndex(0);
            setSearchQuery('');
            return true;
          }
          if (currentLevel === 'subcategory') {
            setSelectedCategory(null);
            setCurrentLevel('category');
            setSelectedIndex(0);
            return true;
          }
        }
        return false;
      },
    }));

    const handleCategoryClick = (cat: string) => {
      setSelectedCategory(cat);
      setCurrentLevel('subcategory');
      setSelectedIndex(0);
    };

    const handleSubcategoryClick = (sub: string) => {
      setSelectedSubcategory(sub);
      setCurrentLevel('item');
      setSelectedIndex(0);
    };

    const handleItemClick = (item: SearchResult) => {
      command(item);
    };

    const handleBack = () => {
      if (currentLevel === 'item') {
        setSelectedSubcategory(null);
        setCurrentLevel('subcategory');
        setSearchQuery('');
      } else if (currentLevel === 'subcategory') {
        setSelectedCategory(null);
        setCurrentLevel('category');
      }
      setSelectedIndex(0);
    };

    if (items.length === 0) {
      return (
        <div className="bg-neutral-900 border border-white/10 rounded-lg p-3 shadow-xl">
          <div className="text-sm text-white/40">No results found</div>
        </div>
      );
    }

    return (
      <div className="bg-neutral-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden w-80">
        {/* Header / Breadcrumb */}
        <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border-b border-white/10 text-xs">
          <button
            onClick={() => { setSelectedCategory(null); setSelectedSubcategory(null); setCurrentLevel('category'); }}
            className={`transition-colors ${!selectedCategory ? 'text-brand-primary font-medium' : 'text-white/50 hover:text-white'}`}
          >
            Select
          </button>
          {selectedCategory && (
            <>
              <ChevronRight size={12} className="text-white/30" />
              <button
                onClick={() => { setSelectedSubcategory(null); setCurrentLevel('subcategory'); }}
                className={`transition-colors ${selectedCategory && !selectedSubcategory ? 'text-brand-primary font-medium' : 'text-white/50 hover:text-white'}`}
              >
                {selectedCategory}
              </button>
            </>
          )}
          {selectedSubcategory && (
            <>
              <ChevronRight size={12} className="text-white/30" />
              <span className="text-brand-primary font-medium truncate">{selectedSubcategory}</span>
            </>
          )}
        </div>

        {/* Search (only shown at item level) */}
        {currentLevel === 'item' && (
          <div className="px-3 py-2 border-b border-white/10">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full px-2 py-1 bg-black/30 border border-white/10 rounded text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50"
              autoFocus
            />
          </div>
        )}

        {/* Content */}
        <div className="max-h-64 overflow-y-auto">
          {/* Category Level */}
          {currentLevel === 'category' && (
            <div className="py-1">
              {categories.map((cat, index) => {
                const count = items.filter(i => i.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => handleCategoryClick(cat)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors ${index === selectedIndex ? 'bg-brand-primary/20 text-brand-primary' : 'text-white/70 hover:bg-white/5'
                      }`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{CATEGORY_ICONS[cat] || '📁'}</span>
                      <span className="font-medium">{cat}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-white/40">{count}</span>
                      <ChevronRight size={14} className="text-white/30" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Subcategory Level */}
          {currentLevel === 'subcategory' && (
            <div className="py-1">
              <button
                onClick={handleBack}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/50 hover:bg-white/5 border-b border-white/5"
              >
                <ChevronRight size={14} className="rotate-180" />
                <span>Back</span>
              </button>
              {subcategories.map((sub, index) => {
                const count = items.filter(i => i.category === selectedCategory && i.subcategory === sub).length;
                return (
                  <button
                    key={sub}
                    onClick={() => handleSubcategoryClick(sub)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors ${index === selectedIndex ? 'bg-brand-primary/20 text-brand-primary' : 'text-white/70 hover:bg-white/5'
                      }`}
                  >
                    <span className="truncate">{sub}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-white/40">{count}</span>
                      <ChevronRight size={14} className="text-white/30" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Item Level */}
          {currentLevel === 'item' && (
            <div className="py-1">
              <button
                onClick={handleBack}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/50 hover:bg-white/5 border-b border-white/5"
              >
                <ChevronRight size={14} className="rotate-180" />
                <span>Back to {selectedSubcategory}</span>
              </button>
              {filteredItems.length === 0 ? (
                <div className="px-3 py-4 text-sm text-white/40 text-center">
                  No items match "{searchQuery}"
                </div>
              ) : (
                filteredItems.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${index === selectedIndex ? 'bg-brand-primary/20 text-brand-primary' : 'text-white/70 hover:bg-white/5'
                      }`}
                  >
                    <div className="font-medium truncate">{item.name}</div>
                    <div className="text-xs text-white/40 truncate">
                      {item.path.slice(0, -1).join(' › ')}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-3 py-2 bg-white/5 border-t border-white/10 text-xs text-white/30 flex items-center justify-between">
          <span>↑↓ navigate</span>
          <span>→ or Enter to select</span>
          <span>← to go back</span>
        </div>
      </div>
    );
  }
);

// ==========================================
// Notebook Editor with @Mentions
// ==========================================

interface NotebookEditorProps {
  experiment: Experiment;
  onSave: (content: string) => void;
  entities: SearchResult[];
}

function NotebookEditor({ experiment, onSave, entities }: NotebookEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      RichMention.configure({
        suggestion: {
          items: ({ query }: { query: string }) => {
            return entities.filter((item) =>
              item.name.toLowerCase().includes(query.toLowerCase())
            );
          },
          command: ({ editor, range, props }: any) => {
            // Store full data with timestamp when mention is inserted
            // Note: API returns entity_type (snake_case), map to entityType (camelCase)
            const mentionData: MentionData = {
              id: props.id,
              name: props.name,
              entityType: props.entity_type || props.entityType,
              category: props.category,
              subcategory: props.subcategory,
              path: props.path || [],
              notes: props.notes,
              mentionedAt: new Date().toISOString(),
            };

            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                {
                  type: 'mention',
                  attrs: mentionData,
                },
                { type: 'text', text: ' ' },
              ])
              .run();
          },
          render: () => {
            let component: ReactRenderer;
            let popup: TippyInstance[] | undefined;

            return {
              onStart: (props: any) => {
                component = new ReactRenderer(MentionList, {
                  props,
                  editor: props.editor,
                });

                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                });
              },
              onUpdate(props: any) {
                component.updateProps(props);

                if (popup && popup[0]) {
                  popup[0].setProps({
                    getReferenceClientRect: props.clientRect,
                  });
                }
              },
              onKeyDown(props: any) {
                if (props.event.key === 'Escape') {
                  if (popup && popup[0]) {
                    popup[0].hide();
                  }
                  return true;
                }
                const componentRef = component.ref as MentionListRef | null;
                return componentRef?.onKeyDown(props) || false;
              },
              onExit() {
                if (popup && popup[0]) {
                  popup[0].destroy();
                }
                component.destroy();
              },
            };
          },
        },
      }),
    ],
    content: experiment.content || '',
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-[200px]',
      },
    },
    onUpdate: ({ editor }) => {
      onSave(editor.getHTML());
    },
  });

  if (!editor) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 px-8 pb-6">
      {/* Toolbar - clean and compact like RichTextEditor */}
      <div className="flex items-center gap-1 p-1 bg-white/5 border border-white/10 rounded-lg w-fit">
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor.can().chain().focus().toggleBold().run()}
          className={`p-1.5 rounded hover:bg-white/10 transition-colors ${editor.isActive('bold') ? 'text-brand-primary bg-white/10' : 'text-white/60'
            }`}
          title="Bold"
        >
          <Bold size={16} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor.can().chain().focus().toggleItalic().run()}
          className={`p-1.5 rounded hover:bg-white/10 transition-colors ${editor.isActive('italic') ? 'text-brand-primary bg-white/10' : 'text-white/60'
            }`}
          title="Italic"
        >
          <Italic size={16} />
        </button>
        <div className="w-px h-4 bg-white/10 mx-1" />
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`p-1.5 rounded hover:bg-white/10 transition-colors ${editor.isActive('heading', { level: 1 }) ? 'text-brand-primary bg-white/10' : 'text-white/60'
            }`}
          title="Heading"
        >
          <Heading1 size={16} />
        </button>
        <div className="w-px h-4 bg-white/10 mx-1" />
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-1.5 rounded hover:bg-white/10 transition-colors ${editor.isActive('bulletList') ? 'text-brand-primary bg-white/10' : 'text-white/60'
            }`}
          title="Bullet List"
        >
          <List size={16} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-1.5 rounded hover:bg-white/10 transition-colors ${editor.isActive('orderedList') ? 'text-brand-primary bg-white/10' : 'text-white/60'
            }`}
          title="Ordered List"
        >
          <ListOrdered size={16} />
        </button>
        <div className="w-px h-4 bg-white/10 mx-1" />
        <div className="px-2 py-1 text-xs text-white/40 flex items-center gap-1">
          <span>Type</span>
          <AtSign size={12} />
          <span>to mention</span>
        </div>
      </div>

      {/* Editor Content - clean bordered container */}
      <div className="flex-1 p-4 bg-black/20 border border-white/10 rounded-xl min-h-[300px]">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// ==========================================
// Folder Select Component (Portal-based dropdown)
// ==========================================

interface FolderSelectProps {
  value: string;
  onChange: (value: string) => void;
  folders: Array<{ id: string; name: string; color?: string }>;
}

function FolderSelect({ value, onChange, folders }: FolderSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });

  const selectedFolder = folders.find((f) => f.id === value);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, [isOpen]);

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
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen]);

  const handleSelect = (id: string) => {
    onChange(id);
    setIsOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-4 py-2.5 bg-black/30 border rounded-lg text-sm text-left transition-all hover:border-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50 ${!value ? 'border-red-500/50' : 'border-white/10'
          }`}
      >
        <span className="flex items-center gap-2">
          {selectedFolder ? (
            <>
              <div
                className="w-2.5 h-2.5 rounded"
                style={{ backgroundColor: selectedFolder.color || '#17b978' }}
              />
              <span className="text-white">{selectedFolder.name}</span>
            </>
          ) : (
            <span className="text-white/50">Select folder (Required)</span>
          )}
        </span>
        <ChevronDown
          size={16}
          className={`text-white/40 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] py-1 bg-neutral-900 border border-white/20 rounded-lg shadow-2xl max-h-64 overflow-auto"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
            }}
          >
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => handleSelect(folder.id)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors ${value === folder.id
                    ? 'bg-brand-primary/15 text-brand-primary'
                    : 'text-white/70 hover:bg-white/5'
                  }`}
              >
                <span className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: folder.color || '#17b978' }}
                  />
                  {folder.name}
                </span>
                {value === folder.id && <Check size={14} className="text-brand-primary" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

// ==========================================
// Create Folder Modal
// ==========================================

interface CreateFolderModalProps {
  onClose: () => void;
  onCreate: (data: { name: string; description?: string; color?: string; parentId?: string }) => void;
  parentId: string | null;
}

function CreateFolderModal({ onClose, onCreate, parentId }: CreateFolderModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#17b978');

  const colors = ['#17b978', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#eab308'];

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
      description: description.trim() || undefined,
      color,
      parentId: parentId || undefined,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-white/10 rounded-xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
          <h2 className="text-lg font-semibold text-white">New Folder</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-2">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., CRISPR Experiments"
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-2">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-2">
              Color
            </label>
            <div className="flex gap-2">
              {colors.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-lg border-2 transition-all ${color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'
                    }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-between gap-3 px-6 py-4 border-t border-white/5 bg-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-4 py-2 bg-brand-primary text-black text-sm font-bold rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Create Experiment Modal
// ==========================================

interface CreateExperimentModalProps {
  onClose: () => void;
  onCreate: (data: { name: string; description?: string; folderId?: string }) => void;
  folders: Array<{ id: string; name: string; color?: string }>;
  defaultFolderId: string | null;
}

function CreateExperimentModal({ onClose, onCreate, folders, defaultFolderId }: CreateExperimentModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [folderId, setFolderId] = useState(defaultFolderId || (folders.length > 0 ? folders[0].id : ''));

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSubmit = () => {
    if (!name.trim() || !folderId) return;
    onCreate({
      name: name.trim(),
      description: description.trim() || undefined,
      folderId,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-white/10 rounded-xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
          <h2 className="text-lg font-semibold text-white">New Experiment</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-2">
              Folder *
            </label>
            <FolderSelect value={folderId} onChange={setFolderId} folders={folders} />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-2">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Experiment 001 - CRISPR Screen"
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description..."
              rows={3}
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50 resize-none"
            />
          </div>
        </div>

        <div className="flex justify-between gap-3 px-6 py-4 border-t border-white/5 bg-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-4 py-2 bg-brand-primary text-black text-sm font-bold rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Delete Experiment Modal
// ==========================================

interface DeleteExperimentModalProps {
  onClose: () => void;
  onConfirm: () => void;
  experimentName: string;
}

function DeleteExperimentModal({ onClose, onConfirm, experimentName }: DeleteExperimentModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const isValid = confirmText.toLowerCase() === 'delete';

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleConfirm = () => {
    if (isValid) {
      onConfirm();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-neutral-900 border border-red-500/20 rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-red-500/10">
          <div className="flex items-center gap-2">
            <AlertTriangle size={20} className="text-red-400" />
            <h3 className="text-lg font-semibold text-white">Delete Experiment</h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p className="text-sm text-red-200">
              <strong>Warning:</strong> This action cannot be undone. This will permanently delete the experiment and all its data, including attached files.
            </p>
            <p className="text-sm text-white font-semibold mt-2 line-clamp-2">{experimentName}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">
              Type <span className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-white">delete</span> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="delete"
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/50"
              autoFocus
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/5 flex justify-between items-center bg-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="px-4 py-2 bg-red-500 text-white text-sm font-bold rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Delete Experiment
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Delete Folder Modal
// ==========================================

interface DeleteFolderModalProps {
  onClose: () => void;
  onConfirm: () => void;
  folderName: string;
  experimentCount: number;
}

function DeleteFolderModal({ onClose, onConfirm, folderName, experimentCount }: DeleteFolderModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const isValid = confirmText.toLowerCase() === 'delete';

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleConfirm = () => {
    if (isValid) {
      onConfirm();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-neutral-900 border border-red-500/20 rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-red-500/10">
          <div className="flex items-center gap-2">
            <AlertTriangle size={20} className="text-red-400" />
            <h3 className="text-lg font-semibold text-white">Delete Folder</h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p className="text-sm text-red-200">
              <strong>Warning:</strong> This will permanently delete the folder and all {experimentCount} experiment{experimentCount !== 1 ? 's' : ''} inside it, including their data and attached files. This action cannot be undone.
            </p>
            <p className="text-sm text-white font-semibold mt-2">{folderName}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">
              Type <span className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-white">delete</span> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="delete"
              className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/50"
              autoFocus
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/5 flex justify-between items-center bg-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="px-4 py-2 bg-red-500 text-white text-sm font-bold rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Delete Folder & Experiments
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Main Experiments Page
// ==========================================

export function ExperimentsPage() {
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [showCreateExperimentModal, setShowCreateExperimentModal] = useState(false);
  const [showDeleteExperimentModal, setShowDeleteExperimentModal] = useState(false);
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<{ id: string; name: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: experiments = [] } = useQuery({
    queryKey: ['experiments'],
    queryFn: experimentsApi.list,
  });

  const { data: folders = [], isLoading: foldersLoading } = useQuery({
    queryKey: ['experiment-folders'],
    queryFn: experimentsApi.listFolders,
  });

  // Fetch search entities for @mentions - refetch each time the page mounts
  const { data: searchEntities = [] } = useQuery({
    queryKey: ['search-entities'],
    queryFn: experimentsApi.searchEntities,
    staleTime: 0, // Always refetch so newly added samples/papers appear immediately
  });

  const createFolderMutation = useMutation({
    mutationFn: experimentsApi.createFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiment-folders'] });
      setShowCreateFolderModal(false);
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: experimentsApi.deleteFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiment-folders'] });
      queryClient.invalidateQueries({ queryKey: ['experiments'] });
      setSelectedFolderId(null);
    },
  });

  const createExperimentMutation = useMutation({
    mutationFn: experimentsApi.create,
    onSuccess: (newExperiment) => {
      queryClient.invalidateQueries({ queryKey: ['experiments'] });
      setSelectedExperiment(newExperiment);
      setShowCreateExperimentModal(false);
    },
  });

  const updateExperimentMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      experimentsApi.update(id, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments'] });
    },
  });

  const deleteExperimentMutation = useMutation({
    mutationFn: experimentsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments'] });
      setSelectedExperiment(null);
    },
  });

  const uploadFileMutation = useMutation({
    mutationFn: ({ experimentId, file }: { experimentId: string; file: File }) =>
      experimentsApi.uploadFile(experimentId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments'] });
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedExperiment) {
      uploadFileMutation.mutate({ experimentId: selectedExperiment.id, file });
    }
  };

  const handleContentChange = useCallback(
    (content: string) => {
      if (selectedExperiment) {
        updateExperimentMutation.mutate({ id: selectedExperiment.id, content });
      }
    },
    [selectedExperiment, updateExperimentMutation]
  );

  const currentFolder = folders.find((f) => f.id === selectedFolderId);
  const currentFolderExperiments = experiments.filter((e) => e.folderId === selectedFolderId);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-white/5 bg-surface/30 backdrop-blur-md flex-shrink-0">
        <nav className="flex items-center gap-2 text-sm">
          <button
            onClick={() => {
              setSelectedExperiment(null);
              setSelectedFolderId(null);
            }}
            className={`transition-colors ${!selectedFolderId && !selectedExperiment ? 'text-white font-medium' : 'text-white/50 hover:text-white'
              }`}
          >
            All
          </button>

          {selectedFolderId && (
            <>
              <span className="text-white/30">/</span>
              <button
                onClick={() => setSelectedExperiment(null)}
                className={`transition-colors ${!selectedExperiment ? 'text-white font-medium' : 'text-white/50 hover:text-white'
                  }`}
              >
                {currentFolder?.name || 'Folder'}
              </button>
            </>
          )}

          {selectedExperiment && (
            <>
              <span className="text-white/30">/</span>
              <span className="text-white font-medium truncate max-w-md">{selectedExperiment.name}</span>
            </>
          )}
        </nav>

        <div className="flex items-center gap-3">
          {!selectedExperiment && (
            <button
              onClick={() => setShowCreateExperimentModal(true)}
              disabled={folders.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 bg-brand-primary text-black text-sm font-medium rounded-lg hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-primary"
              title={folders.length === 0 ? 'Create a folder first' : ''}
            >
              <Plus size={16} />
              New Experiment
            </button>
          )}

          {selectedExperiment && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm font-medium text-white/80 transition-colors"
              >
                <Paperclip size={16} />
                Attach Data File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileUpload}
              />
              <button
                onClick={() => setShowDeleteExperimentModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-sm font-medium transition-colors"
              >
                <Trash2 size={16} />
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex">
        {!selectedExperiment ? (
          <>
            {/* Sidebar - fills full height */}
            <div className="w-64 bg-black/20 border-r border-white/5 flex flex-col flex-shrink-0">
              <div className="flex items-center justify-between p-4 pb-2">
                <span className="text-xs font-medium text-white/40 uppercase tracking-wide">Folders</span>
                <button
                  onClick={() => setShowCreateFolderModal(true)}
                  className="w-6 h-6 flex items-center justify-center text-white/40 hover:text-brand-primary hover:bg-brand-primary/10 rounded transition-colors"
                >
                  <Plus size={14} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {foldersLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="w-5 h-5 border-2 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin" />
                  </div>
                ) : folders.length === 0 ? (
                  <div className="text-sm text-white/30 px-2 py-4 text-center border border-dashed border-white/10 rounded-lg">
                    No folders yet.
                    <br />
                    <button
                      onClick={() => setShowCreateFolderModal(true)}
                      className="text-brand-primary hover:underline mt-1"
                    >
                      Add Folder
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {folders.map((folder) => (
                      <div key={folder.id} className="group flex items-center">
                        <button
                          onClick={() => setSelectedFolderId(folder.id)}
                          className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${selectedFolderId === folder.id
                              ? 'bg-brand-primary/20 text-brand-primary'
                              : 'text-white/70 hover:bg-white/5'
                            }`}
                        >
                          <div className="w-3 h-3 rounded" style={{ backgroundColor: folder.color || '#17b978' }} />
                          <span className="flex-1 text-left truncate">{folder.name}</span>
                          <span className="text-xs text-white/40 mr-2">
                            {experiments.filter((e) => e.folderId === folder.id).length}
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            setFolderToDelete({ id: folder.id, name: folder.name });
                            setShowDeleteFolderModal(true);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-white/30 hover:text-red-400 transition-all ml-3"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Experiments List */}
            <div className="flex-1 overflow-auto p-6">
              {selectedFolderId === null ? (
                <div className="flex flex-col items-center pt-16 text-white/30">
                  <div className="w-16 h-16 mb-4 rounded-xl bg-white/5 flex items-center justify-center">
                    <FlaskConical size={32} className="opacity-50" />
                  </div>
                  <p className="text-lg font-medium">Select a folder</p>
                  <p className="text-sm">Choose a folder from the sidebar to view experiments</p>
                </div>
              ) : (
                <div>
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-white">{currentFolder?.name}</h2>
                    {currentFolder?.description && (
                      <p className="text-white/40 text-sm">{currentFolder.description}</p>
                    )}
                  </div>

                  {currentFolderExperiments.length === 0 ? (
                    <div className="text-center py-12 text-white/40">
                      No experiments in this folder yet.
                      <br />
                      <button
                        onClick={() => setShowCreateExperimentModal(true)}
                        className="text-brand-primary hover:underline mt-2"
                      >
                        Create your first experiment
                      </button>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      {currentFolderExperiments.map((exp) => (
                        <button
                          key={exp.id}
                          onClick={() => setSelectedExperiment(exp)}
                          className="bg-surface/50 hover:bg-neutral-900/80 border border-white/10 rounded-xl p-5 hover:border-brand-primary/30 transition-colors text-left"
                        >
                          <div className="flex items-start gap-3">
                            <FlaskConical size={16} className="text-white/20 mt-0.5" />
                            <div className="flex-1">
                              <h3 className="text-lg font-semibold text-white mb-1">{exp.name}</h3>
                              {exp.description && (
                                <p className="text-sm text-white/60 mb-2">{exp.description}</p>
                              )}
                              <div className="flex items-center gap-2 text-xs text-white/40">
                                <span>{new Date(exp.createdAt).toLocaleDateString()}</span>
                                <span>•</span>
                                <span className="capitalize">{exp.status.toLowerCase()}</span>
                              </div>
                            </div>
                            <ChevronRight size={20} className="text-white/20" />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          /* Experiment Detail View */
          <div className="flex-1 flex flex-col">
            <div className="px-8 pt-6 pb-2">
              <div className="flex items-start justify-between">
                <div className='mb-4'>
                  <h1 className="text-2xl font-bold text-white">{selectedExperiment.name}</h1>
                  {selectedExperiment.description && (
                    <p className="text-white/60 text-sm mt-1">{selectedExperiment.description}</p>
                  )}
                </div>
                <div className="text-xs text-white/40">
                  Created {new Date(selectedExperiment.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <h2 className="text-sm font-semibold px-8 text-white/40 uppercase tracking-wider mb-4">Notes</h2>
              <NotebookEditor experiment={selectedExperiment} onSave={handleContentChange} entities={searchEntities} />
            </div>
            <div className="px-8 pb-8 pt-4">
<div className="pt-6 border-t border-white/10">
              <button
                onClick={() => setSelectedExperiment(null)}
                className="text-sm text-white/50 hover:text-white transition-colors"
              >
                ← Back to experiments
              </button>
            </div>
              </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreateFolderModal && (
        <CreateFolderModal
          onClose={() => setShowCreateFolderModal(false)}
          onCreate={(data) => createFolderMutation.mutate(data)}
          parentId={null}
        />
      )}

      {showCreateExperimentModal && (
        <CreateExperimentModal
          onClose={() => setShowCreateExperimentModal(false)}
          onCreate={(data) => createExperimentMutation.mutate(data)}
          folders={folders}
          defaultFolderId={selectedFolderId}
        />
      )}

      {showDeleteExperimentModal && selectedExperiment && (
        <DeleteExperimentModal
          onClose={() => setShowDeleteExperimentModal(false)}
          onConfirm={() => {
            deleteExperimentMutation.mutate(selectedExperiment.id);
            setShowDeleteExperimentModal(false);
          }}
          experimentName={selectedExperiment.name}
        />
      )}

      {showDeleteFolderModal && folderToDelete && (
        <DeleteFolderModal
          onClose={() => {
            setShowDeleteFolderModal(false);
            setFolderToDelete(null);
          }}
          onConfirm={() => {
            deleteFolderMutation.mutate(folderToDelete.id);
            setShowDeleteFolderModal(false);
            setFolderToDelete(null);
          }}
          folderName={folderToDelete.name}
          experimentCount={experiments.filter((e) => e.folderId === folderToDelete.id).length}
        />
      )}
    </div>
  );
}
