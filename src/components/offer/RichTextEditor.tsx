import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { Node, mergeAttributes } from '@tiptap/core';
import { useEffect, useRef, useState } from 'react';
import mammoth from 'mammoth';
import {
  Bold, Italic, UnderlineIcon, List, ListOrdered, Undo, Redo,
  Heading1, Heading2, Heading3, AlignLeft, AlignCenter, AlignRight,
  ImageIcon, FileUp, X,
} from 'lucide-react';

// ─── Variable definitions ─────────────────────────────────────────────────────
// hidden = true → still rendered as chip in existing templates, but NOT shown
// in the insertion palette (inserted automatically or not user-facing).

export const VARIABLES = [
  { id: 'name',              label: 'Nombre completo',  colorClass: 'var-blue'   },
  { id: 'firstName',         label: 'Nombre',           colorClass: 'var-blue'   },
  { id: 'lastName',          label: 'Apellido',         colorClass: 'var-blue'   },
  { id: 'position',          label: 'Puesto',           colorClass: 'var-purple' },
  { id: 'departmentProfile', label: 'Perfil del puesto',colorClass: 'var-purple' },
  { id: 'hiringManager',     label: 'Líder',            colorClass: 'var-purple' },
  { id: 'company',           label: 'Empresa',          colorClass: 'var-purple' },
  { id: 'salary',            label: 'Salario',          colorClass: 'var-green'  },
  { id: 'benefits',          label: 'Beneficios',       colorClass: 'var-amber', hidden: true },
  { id: 'startDate',         label: 'Fecha de inicio',  colorClass: 'var-rose'   },
  { id: 'date',              label: 'Fecha de hoy',     colorClass: 'var-rose'   },
] as const satisfies Array<{ id: string; label: string; colorClass: string; hidden?: boolean }>;

// ─── Viterbit → system variable mapping ──────────────────────────────────────
// Maps ${viterbit_variable} names (used in Word templates) to {{systemVariable}}.
const VITERBIT_VAR_MAP: Record<string, string> = {
  name:                       'name',
  first_name:                 'firstName',
  last_name:                  'lastName',
  job_department_profile:     'departmentProfile',
  custom_job_empresa:         'company',
  custom_job_hiring_manager:  'hiringManager',
  hired_start_date_job:       'startDate',
  hired_salary_job:           'salary',
  position:                   'position',
  date:                       'date',
  benefits:                   'benefits',
};

// ─── Conversion helpers ───────────────────────────────────────────────────────

export function templateToHtml(template: string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, id) => {
    const v = VARIABLES.find((v) => v.id === id);
    return `<span data-variable="${id}" class="variable-chip ${v?.colorClass ?? 'var-gray'}">${v?.label ?? id}</span>`;
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

// ─── Custom TipTap node for variable chips ────────────────────────────────────

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
        return { id, label: v?.label ?? id ?? '', colorClass: v?.colorClass ?? 'var-gray' };
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

// ─── Toolbar helpers ──────────────────────────────────────────────────────────

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

function Divider() {
  return <div className="w-px h-4 bg-gray-200 mx-0.5" />;
}

// ─── DOCX import helpers ──────────────────────────────────────────────────────

// Scan HTML for {{variable}} patterns not in our VARIABLES list
function findUnknownVars(html: string): string[] {
  const matches = [...html.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  const known = new Set(VARIABLES.map((v) => v.id));
  return [...new Set(matches.filter((id) => !known.has(id as typeof VARIABLES[number]['id'])))];
}

/**
 * Convert Viterbit-style ${variable} patterns to system {{variable}} patterns.
 * Handles both ${var} and ${ var } (with whitespace).
 */
function convertViterbitVars(html: string): string {
  return html.replace(/\$\{\s*(\w+)\s*\}/g, (_, viterbitName: string) => {
    const systemName = VITERBIT_VAR_MAP[viterbitName];
    return systemName ? `{{${systemName}}}` : `{{${viterbitName}}}`;
  });
}

// ─── Main component ───────────────────────────────────────────────────────────

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
}

export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docxInputRef = useRef<HTMLInputElement>(null);
  const [docxWarning, setDocxWarning] = useState<string[] | null>(null);
  const [importing, setImporting] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      VariableNode,
      Underline,
      Image.configure({ allowBase64: true, inline: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: templateToHtml(value),
    onUpdate: ({ editor }) => onChange(htmlToTemplate(editor.getHTML())),
    editorProps: {
      attributes: { class: 'rich-editor-content' },
      // Allow paste of images from clipboard
      handlePaste(view, event) {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (!file) continue;
            const reader = new FileReader();
            reader.onload = (e) => {
              const src = e.target?.result as string;
              view.dispatch(
                view.state.tr.replaceSelectionWith(
                  view.state.schema.nodes.image.create({ src })
                )
              );
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
        return false;
      },
    },
  });

  // Sync external value changes
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (htmlToTemplate(editor.getHTML()) !== value) {
      editor.commands.setContent(templateToHtml(value), { emitUpdate: false });
    }
  }, [value, editor]);

  const handleInsertImage = () => {
    imageInputRef.current?.click();
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      editor.chain().focus().setImage({ src }).run();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleDocxImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    e.target.value = '';
    setImporting(true);
    setDocxWarning(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml(
        { arrayBuffer },
        {
          convertImage: mammoth.images.imgElement((image) =>
            image.read('base64').then((data) => ({
              src: `data:${image.contentType};base64,${data}`,
            }))
          ),
        }
      );
      // Convert Viterbit ${variable} patterns to system {{variable}} patterns
      const converted = convertViterbitVars(result.value);
      // Detect unknown variables in the imported content
      const unknown = findUnknownVars(converted);
      if (unknown.length > 0) setDocxWarning(unknown);
      // Convert {{variable}} patterns to colored chips
      const htmlWithChips = templateToHtml(converted);
      editor.commands.setContent(htmlWithChips, { emitUpdate: true });
      onChange(htmlToTemplate(editor.getHTML()));
    } finally {
      setImporting(false);
    }
  };

  if (!editor) return null;

  const visibleVariables = VARIABLES.filter((v) => !('hidden' in v && v.hidden));

  return (
    <div className="flex flex-col border border-gray-200 rounded-xl overflow-hidden bg-white focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent h-full">

      {/* Hidden file inputs */}
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFileChange} />
      <input ref={docxInputRef} type="file" accept=".docx" className="hidden" onChange={handleDocxImport} />

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-3 py-2 border-b border-gray-100 bg-gray-50 shrink-0 flex-wrap">
        {/* Undo / Redo */}
        <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} title="Deshacer">
          <Undo size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} title="Rehacer">
          <Redo size={14} />
        </ToolbarBtn>

        <Divider />

        {/* Headings */}
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive('heading', { level: 1 })}
          title="Título 1"
        >
          <Heading1 size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive('heading', { level: 2 })}
          title="Título 2"
        >
          <Heading2 size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive('heading', { level: 3 })}
          title="Título 3"
        >
          <Heading3 size={14} />
        </ToolbarBtn>

        <Divider />

        {/* Text style */}
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
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          title="Subrayado"
        >
          <UnderlineIcon size={14} />
        </ToolbarBtn>

        <Divider />

        {/* Alignment */}
        <ToolbarBtn
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          active={editor.isActive({ textAlign: 'left' })}
          title="Alinear izquierda"
        >
          <AlignLeft size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          active={editor.isActive({ textAlign: 'center' })}
          title="Centrar"
        >
          <AlignCenter size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          active={editor.isActive({ textAlign: 'right' })}
          title="Alinear derecha"
        >
          <AlignRight size={14} />
        </ToolbarBtn>

        <Divider />

        {/* Lists */}
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

        <Divider />

        {/* Image */}
        <ToolbarBtn onClick={handleInsertImage} title="Insertar imagen">
          <ImageIcon size={14} />
        </ToolbarBtn>

        {/* DOCX import — pushed to the right */}
        <div className="ml-auto">
          <button
            type="button"
            title="Importar desde Word (.docx)"
            disabled={importing}
            onMouseDown={(e) => { e.preventDefault(); docxInputRef.current?.click(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors disabled:opacity-50"
          >
            <FileUp size={13} />
            {importing ? 'Importando…' : 'Importar Word'}
          </button>
        </div>
      </div>

      {/* ── DOCX unknown-variable warning ────────────────────────────────────── */}
      {docxWarning && docxWarning.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-100 shrink-0">
          <span className="text-amber-500 shrink-0 mt-0.5 text-sm">⚠️</span>
          <div className="flex-1 text-xs text-amber-800 leading-relaxed">
            <strong>Variables no reconocidas:</strong>{' '}
            {docxWarning.map((id) => (
              <code key={id} className="bg-amber-100 px-1 rounded mr-1">{`{{${id}}}`}</code>
            ))}
            — se mantienen como texto. Puedes reemplazarlas manualmente con los botones de abajo.
          </div>
          <button
            type="button"
            onClick={() => setDocxWarning(null)}
            className="text-amber-400 hover:text-amber-600 shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Variable palette ─────────────────────────────────────────────────── */}
      <div className="px-3 py-2.5 border-b border-gray-100 bg-gray-50/60 shrink-0">
        <p className="text-xs text-gray-400 mb-2 font-medium">Insertar dato automático:</p>
        <div className="flex flex-wrap gap-1.5">
          {visibleVariables.map((v) => (
            <button
              key={v.id}
              type="button"
              title={`Insertar ${v.label}`}
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().insertContent({
                  type: 'variable',
                  attrs: { id: v.id, label: v.label, colorClass: v.colorClass },
                }).run();
              }}
              className={`variable-chip ${v.colorClass} cursor-pointer hover:opacity-75 transition-opacity`}
            >
              + {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Editor area ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
