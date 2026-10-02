'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useMutation } from '@/lib/use-api';
import { Banner, Button, ErrorNotice } from '@/components/ui';
import { StudioCanvas } from './canvas';
import { PropertiesPanel } from './properties';
import {
  ELEMENT_LABELS,
  createElement,
  type ElementType,
  type TemplateDocument,
  type TemplateElement,
} from './types';

/**
 * The design studio (FR-DES-01).
 *
 * History is a plain array of document snapshots. Templates are small — a few
 * hundred elements at the very most — so snapshotting is cheaper in both code
 * and bugs than a command/inverse-command undo stack, and it cannot get out of
 * step with the document the way a patch log can.
 */

const MAX_HISTORY = 60;

export function TemplateEditor({
  templateId,
  initialName,
  initialDocument,
  version,
}: {
  templateId: string;
  initialName: string;
  initialDocument: TemplateDocument;
  version: number;
}) {
  const [name, setName] = useState(initialName);
  const [doc, setDoc] = useState<TemplateDocument>(initialDocument);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.55);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(false);

  const history = useRef<TemplateDocument[]>([initialDocument]);
  const historyIndex = useRef(0);

  const selected = doc.elements.find((el) => el.id === selectedId) ?? null;

  // --- History -------------------------------------------------------------

  const commit = useCallback(() => {
    setDoc((current) => {
      const last = history.current[historyIndex.current];
      if (JSON.stringify(last) === JSON.stringify(current)) return current;

      history.current = history.current.slice(0, historyIndex.current + 1);
      history.current.push(current);
      if (history.current.length > MAX_HISTORY) history.current.shift();
      historyIndex.current = history.current.length - 1;
      setDirty(true);
      return current;
    });
  }, []);

  const undo = useCallback(() => {
    if (historyIndex.current <= 0) return;
    historyIndex.current -= 1;
    setDoc(history.current[historyIndex.current]);
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    if (historyIndex.current >= history.current.length - 1) return;
    historyIndex.current += 1;
    setDoc(history.current[historyIndex.current]);
    setDirty(true);
  }, []);

  // --- Mutations -----------------------------------------------------------

  const patchElement = useCallback((id: string, patch: Partial<TemplateElement>) => {
    setDoc((current) => ({
      ...current,
      elements: current.elements.map((el) =>
        el.id === id ? ({ ...el, ...patch } as TemplateElement) : el,
      ),
    }));
  }, []);

  const addElement = useCallback(
    (type: ElementType) => {
      const id = `${type[0]}${Date.now().toString(36)}`;
      setDoc((current) => ({
        ...current,
        elements: [...current.elements, createElement(type, current.canvas, id)],
      }));
      setSelectedId(id);
      // Committed on the next tick so the new element is in the snapshot.
      setTimeout(commit, 0);
    },
    [commit],
  );

  const deleteElement = useCallback(
    (id: string) => {
      setDoc((current) => ({
        ...current,
        elements: current.elements.filter((el) => el.id !== id),
      }));
      setSelectedId(null);
      setTimeout(commit, 0);
    },
    [commit],
  );

  const duplicateElement = useCallback(
    (id: string) => {
      setDoc((current) => {
        const source = current.elements.find((el) => el.id === id);
        if (!source) return current;
        const copy = {
          ...source,
          id: `${source.type[0]}${Date.now().toString(36)}`,
          x: source.x + 16,
          y: source.y + 16,
        } as TemplateElement;
        return { ...current, elements: [...current.elements, copy] };
      });
      setTimeout(commit, 0);
    },
    [commit],
  );

  const reorder = useCallback(
    (id: string, direction: -1 | 1) => {
      setDoc((current) => {
        const index = current.elements.findIndex((el) => el.id === id);
        const target = index + direction;
        if (index === -1 || target < 0 || target >= current.elements.length) return current;
        const elements = [...current.elements];
        [elements[index], elements[target]] = [elements[target], elements[index]];
        return { ...current, elements };
      });
      setTimeout(commit, 0);
    },
    [commit],
  );

  // --- Saving --------------------------------------------------------------

  const save = useMutation(async () => {
    await api.patch(`/v1/templates/${templateId}`, { name, document: doc });
    setDirty(false);
    setSavedAt(new Date());
  });

  // Warn before losing unsaved work. The browser controls the wording; all we
  // can do is signal that there is something to lose.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // --- Keyboard ------------------------------------------------------------

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save.run();
        return;
      }
      if (meta && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (meta && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
        event.preventDefault();
        redo();
        return;
      }
      if (!typing && (event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        deleteElement(selectedId);
      }
      if (!typing && meta && event.key.toLowerCase() === 'd' && selectedId) {
        event.preventDefault();
        duplicateElement(selectedId);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, save, selectedId, deleteElement, duplicateElement]);

  const fields = useMemo(() => doc.fields.map((f) => f.key), [doc.fields]);

  return (
    <div className="stack" style={{ gap: 0 }}>
      <header
        className="row row-between row-wrap"
        style={{
          padding: 'var(--sp-3) var(--sp-5)',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      >
        <div className="row" style={{ minWidth: 0 }}>
          <Link className="btn btn-ghost btn-sm" href="/templates">
            ←
          </Link>
          <label className="sr-only" htmlFor="template-name">
            Template name
          </label>
          <input
            id="template-name"
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            style={{ maxWidth: 320, fontWeight: 600 }}
          />
          <span className="subtle">v{version}</span>
        </div>

        <div className="row">
          <div className="pill-tabs" role="group" aria-label="Zoom">
            <button onClick={() => setZoom((z) => Math.max(0.15, z - 0.1))} aria-label="Zoom out">
              −
            </button>
            <button aria-selected="true" onClick={() => setZoom(0.55)}>
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={() => setZoom((z) => Math.min(2, z + 0.1))} aria-label="Zoom in">
              +
            </button>
          </div>
          
          <Button 
            size="sm" 
            variant={snapToGrid ? "primary" : "secondary"} 
            onClick={() => setSnapToGrid(!snapToGrid)} 
            title="Toggle Snap to Grid (10px)"
          >
            Snap {snapToGrid ? 'On' : 'Off'}
          </Button>

          <Button size="sm" onClick={undo} title="Undo (Ctrl+Z)" disabled={historyIndex.current <= 0}>
            Undo
          </Button>
          <Button size="sm" onClick={redo} title="Redo (Ctrl+Shift+Z)" disabled={historyIndex.current >= history.current.length - 1}>
            Redo
          </Button>

          <span className="subtle">
            {dirty ? 'Unsaved changes' : savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : 'Saved'}
          </span>

          <Button variant="primary" size="sm" loading={save.busy} onClick={() => void save.run()}>
            Save
          </Button>
        </div>
      </header>

      {save.error && (
        <div style={{ padding: 'var(--sp-3) var(--sp-5)' }}>
          <ErrorNotice error={save.error} />
        </div>
      )}

      <div className="studio">
        <aside className="studio-panel" aria-label="Elements and layers">
          <div className="stack-sm stack">
            <h3 style={{ fontSize: '0.85rem' }}>Add</h3>
            <div className="stack" style={{ gap: 4 }}>
              {(Object.keys(ELEMENT_LABELS) as ElementType[]).map((type) => (
                <button
                  key={type}
                  className="btn btn-secondary btn-sm"
                  onClick={() => addElement(type)}
                >
                  {ELEMENT_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          <div className="stack-sm stack">
            <div className="row row-between">
              <h3 style={{ fontSize: '0.85rem' }}>Layers</h3>
              <span className="subtle" style={{ fontSize: '0.72rem' }}>
                {doc.elements.length}
              </span>
            </div>

            <div className="stack" style={{ gap: 1 }}>
              {/* Reversed so the topmost painted element is at the top of the
                  list, which is what every design tool does and what a designer
                  expects. */}
              {[...doc.elements].reverse().map((element) => (
                <div key={element.id} className="row" style={{ gap: 2 }}>
                  <button
                    className="layer-item"
                    aria-selected={element.id === selectedId}
                    onClick={() => setSelectedId(element.id)}
                  >
                    <span aria-hidden="true" style={{ opacity: 0.6 }}>
                      {element.type === 'text'
                        ? 'T'
                        : element.type === 'image'
                          ? '▣'
                          : element.type === 'qr'
                            ? '▦'
                            : element.type === 'signature'
                              ? '✎'
                              : '▭'}
                    </span>
                    <span className="truncate">
                      {element.type === 'text'
                        ? element.content.slice(0, 24) || 'Empty text'
                        : ELEMENT_LABELS[element.type]}
                    </span>
                    {element.locked && (
                      <span className="subtle" style={{ marginLeft: 'auto' }} title="Locked">
                        🔒
                      </span>
                    )}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => reorder(element.id, 1)}
                    aria-label="Bring forward"
                    title="Bring forward"
                  >
                    ↑
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => reorder(element.id, -1)}
                    aria-label="Send backward"
                    title="Send backward"
                  >
                    ↓
                  </button>
                </div>
              ))}
            </div>
          </div>

          {fields.length > 0 && (
            <div className="stack-sm stack">
              <h3 style={{ fontSize: '0.85rem' }}>Merge fields</h3>
              <p className="subtle" style={{ fontSize: '0.75rem' }}>
                Declared by this template. These become the CSV columns issuers map.
              </p>
              <div className="stack" style={{ gap: 2 }}>
                {doc.fields.map((field) => (
                  <div key={field.key} className="subtle" style={{ fontSize: '0.75rem' }}>
                    <code className="mono">{field.key}</code>
                    {field.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        <StudioCanvas
          document={doc}
          zoom={zoom}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChange={patchElement}
          onCommit={commit}
          snapToGrid={snapToGrid}
        />

        <PropertiesPanel
          document={doc}
          element={selected}
          onChange={(patch) => selected && patchElement(selected.id, patch)}
          onCommit={commit}
          onDelete={() => selected && deleteElement(selected.id)}
          onDuplicate={() => selected && duplicateElement(selected.id)}
          onCanvasChange={(patch) => {
            setDoc((current) => ({ ...current, canvas: { ...current.canvas, ...patch } }));
            setTimeout(commit, 0);
          }}
        />
      </div>

      <div style={{ padding: 'var(--sp-4) var(--sp-5)' }}>
        <Banner tone="info">
          The canvas above is drawn by the same renderer that produces the issued PDF, so this is
          not an approximation — what you position here is what recipients receive.
        </Banner>
      </div>
    </div>
  );
}
