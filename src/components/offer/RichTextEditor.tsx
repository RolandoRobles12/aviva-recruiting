import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Node, mergeAttributes } from '@tiptap/core';
import { useEffect } from 'react';
import { Bold, Italic, List, ListOrdered, Undo, Redo } from 'lucide-react';

// ─── Variable definitions (color-coded) ──────────────────────────────────────

export const VARIABLES = [
  // Candidato
  { id: 'firstName',          label: 'Nombre',            colorClass: 'var-blue'   },
  { id: 'lastName',           label: 'Apellido',          colorClass: 'var-blue'   },
  // Puesto (datos del job en Viterbit)
  { id: 'position',           label: 'Puesto',            colorClass: 'var-purple' },
  { id: 'departmentProfile',  label: 'Perfil del puesto', colorClass: 'var-purple' },
  { id: 'hiringManager',      label: 'Líder',             colorClass: 'var-purple' },
  { id: 'company',            label: 'Empresa',           colorClass: 'var-purple' },
  // Compensación
  { id: 'salary',             label: 'Salario',           colorClass: 'var-green'  },
  { id: 'benefits',           label: 'Beneficios',        colorClass: 'var-amber'  },
  // Fechas
  { id: 'startDate',          label: 'Fecha de inicio',   colorClass: 'var-rose'   },
  { id: 'date',               label: 'Fecha de hoy',      colorClass: 'var-rose'   },
];

// ─── Conversion helpers ───────────────────────────────────────────────────────

export function templateToHtml(template: string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, id) => {
    const v = VARIABLES.find((v) => v.id === id);
    return `<span data-variable="${id}" class="variable-chip ${v?.colorClass ?? ''}">${v?.label ?? id}</span>`;
  });
}

export function htmlToTemplate(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('[data-variable]').forEach((el) => {
    const id = el.getAttribute('data-variable');
    if (id) el.replaceWith(`{{${id}}}`);
  });
  return div.innerHTML;
}

// ─── Custom TipTap node ───────────────────────────────────────────────────────

const VariableNode = Node.create({
  name: 'variable',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id:         { default: null },
      label:      { default: '' },
      colorClass: { default: '' },
    };
  },

  parseHTML() {
    return [{
      tag: 'span[data-variable]',
      getAttrs: (el) => {
        const element = el as HTMLElement;
        const id = element.getAttribute('data-variable');
        const v = VARIABLES.find((v) => v.id === id);
        return { id, label: v?.label ?? id ?? '', colorClass: v?.colorClass ?? '' };
      },
    }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-variable': node.attrs.id,
        class: `variable-chip ${node.attrs.colorClass}`,
        contenteditable: 'false',
      }),
      node.attrs.label,
    ];
  },
});

// ─── Toolbar button ───────────────────────────────────────────────────────────

function ToolbarBtn({ onClick, active, title, children }: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`p-1.5 rounded transition-colors ${
        active ? 'bg-gray-200 text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
}

export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, VariableNode],
    content: templateToHtml(value),
    onUpdate: ({ editor }) => onChange(htmlToTemplate(editor.getHTML())),
    editorProps: {
      attributes: { class: 'rich-editor-content' },
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (htmlToTemplate(editor.getHTML()) !== value) {
      editor.commands.setContent(templateToHtml(value), false);
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className="flex flex-col border border-gray-200 rounded-xl overflow-hidden bg-white focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent h-full">

      {/* Formatting toolbar */}
      <div className="flex items-center gap-0.5 px-3 py-2 border-b border-gray-100 bg-gray-50 shrink-0">
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Negrita">
          <Bold size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Cursiva">
          <Italic size={14} />
        </ToolbarBtn>
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Lista">
          <List size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Lista numerada">
          <ListOrdered size={14} />
        </ToolbarBtn>
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} title="Deshacer">
          <Undo size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} title="Rehacer">
          <Redo size={14} />
        </ToolbarBtn>
      </div>

      {/* Variable palette */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 shrink-0">
        <p className="text-xs text-gray-400 mb-2">
          Haz clic en una variable para insertarla donde está el cursor:
        </p>
        <div className="flex flex-wrap gap-2">
          {VARIABLES.map((v) => (
            <button
              key={v.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().insertContent({
                  type: 'variable',
                  attrs: { id: v.id, label: v.label, colorClass: v.colorClass },
                }).run();
              }}
              className={`variable-chip ${v.colorClass} cursor-pointer hover:opacity-75 transition-opacity text-xs px-3 py-1`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Editor area — fills remaining height */}
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
