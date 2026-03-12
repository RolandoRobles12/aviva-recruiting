import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Node, mergeAttributes } from '@tiptap/core';
import { useEffect } from 'react';
import { Bold, Italic, List, ListOrdered, Heading2, Undo, Redo } from 'lucide-react';

// ─── Variable definitions ─────────────────────────────────────────────────────

export const VARIABLES = [
  { id: 'firstName', label: 'Nombre' },
  { id: 'lastName', label: 'Apellido' },
  { id: 'position', label: 'Posición' },
  { id: 'salary', label: 'Salario' },
  { id: 'benefits', label: 'Beneficios' },
  { id: 'startDate', label: 'Fecha de inicio' },
];

// ─── Conversion helpers ───────────────────────────────────────────────────────

/** Convert {{variable}} placeholders → editor-renderable <span data-variable> */
export function templateToHtml(template: string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, id) => {
    const v = VARIABLES.find((v) => v.id === id);
    return `<span data-variable="${id}">${v?.label ?? id}</span>`;
  });
}

/** Convert editor HTML with <span data-variable> → {{variable}} for storage */
export function htmlToTemplate(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('[data-variable]').forEach((el) => {
    const id = el.getAttribute('data-variable');
    if (id) el.replaceWith(`{{${id}}}`);
  });
  return div.innerHTML;
}

// ─── Custom TipTap node for variable chips ────────────────────────────────────

const VariableNode = Node.create({
  name: 'variable',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: null },
      label: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-variable]',
        getAttrs: (el) => {
          const element = el as HTMLElement;
          const id = element.getAttribute('data-variable');
          const v = VARIABLES.find((v) => v.id === id);
          return { id, label: v?.label ?? id ?? '' };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-variable': node.attrs.id,
        class: 'variable-chip',
        contenteditable: 'false',
      }),
      node.attrs.label,
    ];
  },
});

// ─── Toolbar button ───────────────────────────────────────────────────────────

function ToolbarBtn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-gray-200 text-gray-900'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Rich text editor component ───────────────────────────────────────────────

interface RichTextEditorProps {
  /** HTML with {{variable}} placeholders */
  value: string;
  /** Returns HTML with {{variable}} placeholders */
  onChange: (html: string) => void;
}

export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, VariableNode],
    content: templateToHtml(value),
    onUpdate: ({ editor }) => {
      onChange(htmlToTemplate(editor.getHTML()));
    },
    editorProps: {
      attributes: {
        class: 'rich-editor-content',
      },
    },
  });

  // Sync external value changes (e.g. loading a different template)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = htmlToTemplate(editor.getHTML());
    if (current !== value) {
      editor.commands.setContent(templateToHtml(value), false);
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent">
      {/* Formatting toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 bg-gray-50">
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="Negrita"
        >
          <Bold size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="Cursiva"
        >
          <Italic size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive('heading', { level: 2 })}
          title="Encabezado"
        >
          <Heading2 size={14} />
        </ToolbarBtn>
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="Lista"
        >
          <List size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="Lista numerada"
        >
          <ListOrdered size={14} />
        </ToolbarBtn>
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarBtn
          onClick={() => editor.chain().focus().undo().run()}
          title="Deshacer"
        >
          <Undo size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().redo().run()}
          title="Rehacer"
        >
          <Redo size={14} />
        </ToolbarBtn>
      </div>

      {/* Variable insertion chips */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-100 bg-gray-50/60 flex-wrap">
        <span className="text-xs text-gray-400 font-medium">Insertar:</span>
        {VARIABLES.map((v) => (
          <button
            key={v.id}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              editor
                .chain()
                .focus()
                .insertContent({ type: 'variable', attrs: { id: v.id, label: v.label } })
                .run();
            }}
            className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 transition-colors cursor-pointer"
          >
            + {v.label}
          </button>
        ))}
      </div>

      {/* Editor area */}
      <EditorContent editor={editor} />
    </div>
  );
}
