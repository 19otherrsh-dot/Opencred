'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { buildCanvasHtml } from '@opencred/renderer/dist/html';
import { sampleMergeContext } from '@opencred/renderer/dist/context';
import type { TemplateDocument, TemplateElement } from './types';

/**
 * The editing canvas.
 *
 * The design decision that matters here: the artwork is produced by
 * `buildCanvasHtml` — literally the same function the render worker feeds to
 * headless Chromium — and the editor draws only an invisible interaction layer
 * on top of it. There is no second renderer for the editor, so what a designer
 * positions is what a recipient receives.
 *
 * Interaction is pointer-event based (mouse, trackpad, pen and touch in one
 * code path) with delta scaling by the zoom level, so dragging at 40% zoom
 * moves an element by the distance the pointer actually travelled on the page.
 */

interface DragState {
  mode: 'move' | 'resize';
  handle?: Handle;
  pointerId: number;
  startX: number;
  startY: number;
  origin: { x: number; y: number; width: number; height: number };
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLES: Array<{ id: Handle; cursor: string; x: number; y: number }> = [
  { id: 'nw', cursor: 'nwse-resize', x: 0, y: 0 },
  { id: 'n', cursor: 'ns-resize', x: 0.5, y: 0 },
  { id: 'ne', cursor: 'nesw-resize', x: 1, y: 0 },
  { id: 'e', cursor: 'ew-resize', x: 1, y: 0.5 },
  { id: 'se', cursor: 'nwse-resize', x: 1, y: 1 },
  { id: 's', cursor: 'ns-resize', x: 0.5, y: 1 },
  { id: 'sw', cursor: 'nesw-resize', x: 0, y: 1 },
  { id: 'w', cursor: 'ew-resize', x: 0, y: 0.5 },
];

const SNAP = 8;

export function StudioCanvas({
  document: doc,
  zoom,
  selectedId,
  onSelect,
  onChange,
  onCommit,
  sampleValues,
  snapToGrid = false,
}: {
  document: TemplateDocument;
  zoom: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Live update during a drag; not pushed to undo history. */
  onChange: (id: string, patch: Partial<TemplateElement>) => void;
  /** Called once when a gesture finishes, so undo has one entry per drag. */
  onCommit: () => void;
  sampleValues?: Record<string, string>;
  /** Snap movement to a 10px grid instead of to the canvas centre lines. */
  snapToGrid?: boolean;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });

  const context = useMemo(
    () => sampleMergeContext({ level: 'Professional', ...(sampleValues ?? {}) }),
    [sampleValues],
  );

  // The artwork. Regenerated on every document change; it is a pure string
  // build, so this is far cheaper than a re-render of equivalent React trees.
  const html = useMemo(
    () => buildCanvasHtml(doc, context, { editorGuides: true }),
    [doc, context],
  );

  const selected = doc.elements.find((el) => el.id === selectedId) ?? null;

  const beginDrag = useCallback(
    (event: React.PointerEvent, element: TemplateElement, mode: 'move' | 'resize', handle?: Handle) => {
      if (element.locked) return;
      event.preventDefault();
      event.stopPropagation();
      (event.target as Element).setPointerCapture(event.pointerId);

      drag.current = {
        mode,
        handle,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
        },
      };
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const state = drag.current;
      if (!state || !selected) return;

      const dx = (event.clientX - state.startX) / zoom;
      const dy = (event.clientY - state.startY) / zoom;

      if (state.mode === 'move') {
        let x = Math.round(state.origin.x + dx);
        let y = Math.round(state.origin.y + dy);

        // Snap to the canvas centre lines and edges. The guide only appears
        // when a snap actually engaged, so it never lies about alignment.
        const centreX = doc.canvas.width / 2 - state.origin.width / 2;
        const centreY = doc.canvas.height / 2 - state.origin.height / 2;
        let guideX: number | null = null;
        let guideY: number | null = null;

        if (snapToGrid) {
          x = Math.round(x / 10) * 10;
          y = Math.round(y / 10) * 10;
        } else {
          // Center snapping is only active when grid snap is off
          if (Math.abs(x - centreX) < SNAP) {
            x = Math.round(centreX);
            guideX = doc.canvas.width / 2;
          }
          if (Math.abs(y - centreY) < SNAP) {
            y = Math.round(centreY);
            guideY = doc.canvas.height / 2;
          }
        }

        setGuides({ x: guideX, y: guideY });
        onChange(selected.id, { x, y } as Partial<TemplateElement>);
        return;
      }

      const handle = state.handle!;
      let { x, y, width, height } = state.origin;

      if (handle.includes('e')) width = Math.max(8, Math.round(state.origin.width + dx));
      if (handle.includes('s')) height = Math.max(4, Math.round(state.origin.height + dy));
      if (handle.includes('w')) {
        width = Math.max(8, Math.round(state.origin.width - dx));
        x = Math.round(state.origin.x + (state.origin.width - width));
      }
      if (handle.includes('n')) {
        height = Math.max(4, Math.round(state.origin.height - dy));
        y = Math.round(state.origin.y + (state.origin.height - height));
      }

      onChange(selected.id, { x, y, width, height } as Partial<TemplateElement>);
    },
    // `snapToGrid` belongs here: without it the callback closes over the value
    // it had when the drag handler was last rebuilt, and toggling snap would
    // appear to do nothing until something else changed.
    [selected, zoom, doc.canvas.width, doc.canvas.height, onChange, snapToGrid],
  );

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setGuides({ x: null, y: null });
    onCommit();
  }, [onCommit]);

  /** Arrow-key nudging, so precise placement does not require a steady hand. */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!selected || selected.locked) return;
      const step = event.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = moves[event.key];
      if (!move) return;

      event.preventDefault();
      onChange(selected.id, {
        x: selected.x + move[0],
        y: selected.y + move[1],
      } as Partial<TemplateElement>);
      onCommit();
    },
    [selected, onChange, onCommit],
  );

  return (
    <div className="studio-canvas-area" onPointerDown={() => onSelect(null)}>
      <div
        ref={surfaceRef}
        className="studio-canvas"
        style={{
          width: doc.canvas.width,
          height: doc.canvas.height,
          transform: `scale(${zoom})`,
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="application"
        aria-label="Template canvas. Select an element and use the arrow keys to move it."
      >
        {/* The artwork, produced by the shared renderer. */}
        <div
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {/* Alignment guides, drawn only while a snap is active. */}
        {guides.x !== null && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: guides.x,
              top: 0,
              bottom: 0,
              width: 1,
              background: 'var(--brand)',
              opacity: 0.8,
            }}
          />
        )}
        {guides.y !== null && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: guides.y,
              left: 0,
              right: 0,
              height: 1,
              background: 'var(--brand)',
              opacity: 0.8,
            }}
          />
        )}

        {/* The interaction layer: one transparent hit box per element. */}
        {doc.elements.map((element) => (
          <div
            key={element.id}
            className={`studio-el${element.id === selectedId ? ' selected' : ''}`}
            style={{
              left: element.x,
              top: element.y,
              width: element.width,
              height: element.height,
              transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
              cursor: element.locked ? 'not-allowed' : 'move',
              opacity: element.hidden ? 0.3 : 1,
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelect(element.id);
              beginDrag(event, element, 'move');
            }}
            role="button"
            tabIndex={-1}
            aria-label={`${element.type} element`}
          />
        ))}

        {/* Resize handles for the current selection. */}
        {selected && !selected.locked && (
          <>
            {HANDLES.map((handle) => (
              <div
                key={handle.id}
                className="studio-handle"
                style={{
                  left: selected.x + selected.width * handle.x - 5,
                  top: selected.y + selected.height * handle.y - 5,
                  cursor: handle.cursor,
                  // Handles keep a constant on-screen size regardless of zoom,
                  // otherwise they become unusable at 30%.
                  transform: `scale(${1 / zoom})`,
                }}
                onPointerDown={(event) => beginDrag(event, selected, 'resize', handle.id)}
              />
            ))}

            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: selected.x,
                top: selected.y - 22 / zoom,
                fontSize: 11 / zoom,
                color: 'var(--brand)',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}
            >
              {Math.round(selected.width)} × {Math.round(selected.height)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
