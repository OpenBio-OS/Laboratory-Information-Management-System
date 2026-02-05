import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, List, ListOrdered, Heading1, Heading2 } from 'lucide-react';

interface RichTextEditorProps {
    content: string;
    onChange: (content: string) => void;
    editable?: boolean;
}

export function RichTextEditor({ content, onChange, editable = true }: RichTextEditorProps) {
    const editor = useEditor({
        extensions: [
            StarterKit,
        ],
        content: content,
        editable: editable,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML());
        },
        editorProps: {
            attributes: {
                class: 'prose prose-invert max-w-none focus:outline-none min-h-[150px]',
            },
        },
    });

    if (!editor) {
        return null;
    }

    if (!editable) {
        return <EditorContent editor={editor} />;
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1 p-1 bg-white/5 border border-white/10 rounded-lg w-fit">
                <button
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    disabled={!editor.can().chain().focus().toggleBold().run()}
                    className={`p-1.5 rounded hover:bg-white/10 transition-colors ${editor.isActive('bold') ? 'text-brand-primary bg-white/10' : 'text-white/60'}`}
                    title="Bold"
                >
                    <Bold size={16} />
                </button>
                <button
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    disabled={!editor.can().chain().focus().toggleItalic().run()}
                    className={`p-1.5 rounded hover:bg-white/10 transition-colors ${editor.isActive('italic') ? 'text-brand-primary bg-white/10' : 'text-white/60'}`}
                    title="Italic"
                >
                    <Italic size={16} />
                </button>
                <div className="w-px h-4 bg-white/10 mx-1" />
                <button
                    onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                    className={`p-1.5 rounded hover:bg-white/10 transition-colors ${editor.isActive('heading', { level: 1 }) ? 'text-brand-primary bg-white/10' : 'text-white/60'}`}
                    title="Heading 1"
                >
                    <Heading1 size={16} />
                </button>
                <button
                    onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                    className={`p-1.5 rounded hover:bg-white/10 transition-colors ${editor.isActive('heading', { level: 2 }) ? 'text-brand-primary bg-white/10' : 'text-white/60'}`}
                    title="Heading 2"
                >
                    <Heading2 size={16} />
                </button>
                <div className="w-px h-4 bg-white/10 mx-1" />
                <button
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                    className={`p-1.5 rounded hover:bg-white/10 transition-colors ${editor.isActive('bulletList') ? 'text-brand-primary bg-white/10' : 'text-white/60'}`}
                    title="Bullet List"
                >
                    <List size={16} />
                </button>
                <button
                    onClick={() => editor.chain().focus().toggleOrderedList().run()}
                    className={`p-1.5 rounded hover:bg-white/10 transition-colors ${editor.isActive('orderedList') ? 'text-brand-primary bg-white/10' : 'text-white/60'}`}
                    title="Ordered List"
                >
                    <ListOrdered size={16} />
                </button>
            </div>
            <div className="p-4 bg-black/20 border border-white/10 rounded-xl min-h-[200px]">
                <EditorContent editor={editor} />
            </div>
        </div>
    );
}
