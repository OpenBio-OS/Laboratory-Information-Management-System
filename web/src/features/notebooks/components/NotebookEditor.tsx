/**
 * Rich text editor component for laboratory notebooks
 * Uses TipTap with @mention support for samples, equipment, and papers
 */
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import { MentionList, MentionItem } from './MentionList';
import { notebooksApi, SearchResult } from '../../../lib/api';
import React from 'react';
import { Bold, Italic, List, ListOrdered, Undo, Redo } from 'lucide-react';

interface NotebookEditorProps {
  content: string;
  onChange: (content: string) => void;
  onMention?: (entityType: string, entityId: string, snapshotData: any) => void;
}

export const NotebookEditor: React.FC<NotebookEditorProps> = ({
  content,
  onChange,
  onMention,
}) => {
  const [entities, setEntities] = React.useState<SearchResult[]>([]);

  // Load entities for mentions on mount
  React.useEffect(() => {
    notebooksApi.searchEntities().then(setEntities).catch(console.error);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Mention.configure({
        HTMLAttributes: {
          class: 'mention bg-blue-100 text-blue-700 px-1 rounded',
        },
        suggestion: {
          items: ({ query }: { query: string }) => {
            return entities
              .filter((entity) =>
                entity.name.toLowerCase().includes(query.toLowerCase())
              )
              .slice(0, 10)
              .map((entity) => ({
                id: entity.id,
                label: entity.name,
                type: entity.entityType,
                metadata: entity.metadata,
              }));
          },

          render: () => {
            let component: ReactRenderer;
            let popup: any;

            return {
              onStart: (props: any) => {
                component = new ReactRenderer(MentionList, {
                  props,
                  editor: props.editor,
                });

                if (!props.clientRect) {
                  return;
                }

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
                component?.updateProps(props);

                if (!props.clientRect) {
                  return;
                }

                popup?.[0]?.setProps({
                  getReferenceClientRect: props.clientRect,
                });
              },

              onKeyDown(props: any) {
                if (props.event.key === 'Escape') {
                  popup?.[0]?.hide();
                  return true;
                }

                return (component?.ref as any)?.onKeyDown?.(props);
              },

              onExit() {
                popup?.[0]?.destroy();
                component?.destroy();
              },
            };
          },

          command: ({ editor, range, props }: any) => {
            const item = props as MentionItem;
            
            // Insert the mention
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                {
                  type: 'mention',
                  attrs: {
                    id: item.id,
                    label: item.label,
                  },
                },
                {
                  type: 'text',
                  text: ' ',
                },
              ])
              .run();

            // Callback for creating mention snapshot
            if (onMention) {
              onMention(item.type, item.id, item.metadata);
            }
          },
        },
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  if (!editor) {
    return null;
  }

  return (
    <div className="border rounded-lg overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="border-b bg-gray-50 p-2 flex gap-1 flex-wrap">
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-2 rounded hover:bg-gray-200 ${editor.isActive('bold') ? 'bg-gray-200' : ''}`}
          title="Bold"
        >
          <Bold size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-2 rounded hover:bg-gray-200 ${editor.isActive('italic') ? 'bg-gray-200' : ''}`}
          title="Italic"
        >
          <Italic size={18} />
        </button>
        <div className="w-px bg-gray-300 mx-1" />
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-2 rounded hover:bg-gray-200 ${editor.isActive('bulletList') ? 'bg-gray-200' : ''}`}
          title="Bullet List"
        >
          <List size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-2 rounded hover:bg-gray-200 ${editor.isActive('orderedList') ? 'bg-gray-200' : ''}`}
          title="Numbered List"
        >
          <ListOrdered size={18} />
        </button>
        <div className="w-px bg-gray-300 mx-1" />
        <button
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className="p-2 rounded hover:bg-gray-200 disabled:opacity-50"
          title="Undo"
        >
          <Undo size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className="p-2 rounded hover:bg-gray-200 disabled:opacity-50"
          title="Redo"
        >
          <Redo size={18} />
        </button>
        <div className="ml-auto text-xs text-gray-500 flex items-center px-2">
          Type <kbd className="mx-1 px-1.5 py-0.5 bg-white border rounded">@</kbd> to mention samples, equipment, or papers
        </div>
      </div>

      {/* Editor Content */}
      <div className="p-4 prose max-w-none min-h-[400px]">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};
