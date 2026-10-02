'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { FONT_CHOICES, SYSTEM_TOKENS, type TemplateDocument, type TemplateElement } from './types';

/**
 * The properties panel.
 *
 * Every control writes straight through to the template document, which is the
 * same JSON the renderer consumes — there is no intermediate editor model to
 * translate, and therefore nothing that can drift.
 */

interface BrandPalette {
  primary?: string;
  secondary?: string;
  accent?: string;
  surface?: string;
  text?: string;
}

/**
 * As returned by `GET /v1/org/assets`.
 *
 * `reference` is the value that must go into a template — an
 * `opencred://asset/<storage key>` URI that the render worker resolves to bytes
 * and inlines. Constructing one from the asset id instead would produce a
 * reference that resolves to nothing, and the failure would only show up as a
 * blank image on issued credentials.
 */
interface OrgAsset {
  id: string;
  reference: string;
  filename: string;
  contentType: string;
  purpose: string;
}

function Num({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="stack" style={{ gap: 3 }}>
      <span className="prop-label">
        {label}
        {suffix ? ` (${suffix})` : ''}
      </span>
      <input
        className="mini-input"
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Color({
  label,
  value,
  onChange,
  swatches,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  swatches?: string[];
}) {
  // `transparent` and rgba() are legal in the document but not in an <input
  // type="color">, so the swatch falls back to white and the text field stays
  // authoritative.
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff';
  return (
    <label className="stack" style={{ gap: 3 }}>
      <span className="prop-label">{label}</span>
      <div className="row" style={{ gap: 4 }}>
        <input
          className="color-input"
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 38, flex: 'none' }}
          aria-label={`${label} colour swatch`}
        />
        <input
          className="mini-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour value`}
          spellCheck={false}
        />
      </div>
      {swatches && swatches.length > 0 && (
        <div className="row" style={{ gap: 4, marginTop: 4 }}>
          {swatches.map((swatch, i) => (
            <button
              key={i}
              type="button"
              style={{ width: 16, height: 16, background: swatch, border: '1px solid var(--border)', borderRadius: '2px', padding: 0, cursor: 'pointer' }}
              onClick={() => onChange(swatch)}
              title={`Use brand color ${swatch}`}
            />
          ))}
        </div>
      )}
    </label>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="stack" style={{ gap: 3 }}>
      <span className="prop-label">{label}</span>
      <select
        className="mini-input"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PropertiesPanel({
  document: doc,
  element,
  onChange,
  onCommit,
  onDelete,
  onDuplicate,
  onCanvasChange,
}: {
  document: TemplateDocument;
  element: TemplateElement | null;
  onChange: (patch: Partial<TemplateElement>) => void;
  onCommit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCanvasChange: (patch: Partial<TemplateDocument['canvas']>) => void;
}) {
  const [tokenOpen, setTokenOpen] = useState(false);
  const [palette, setPalette] = useState<BrandPalette | null>(null);
  const [assets, setAssets] = useState<OrgAsset[]>([]);

  // The brand kit and the uploaded assets, so a designer picks their own logo
  // from a list rather than pasting a storage reference by hand.
  useEffect(() => {
    let cancelled = false;

    void api
      .get<{ brandKit?: { palette?: BrandPalette } }>('/v1/org/branding')
      .then((response) => {
        if (!cancelled) setPalette(response.brandKit?.palette ?? null);
      })
      .catch(() => undefined);

    void api
      .get<OrgAsset[]>('/v1/org/assets')
      .then((response) => {
        if (!cancelled) setAssets(Array.isArray(response) ? response : []);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  // Order matters: these appear as swatches, and primary should be first.
  const swatches = palette
    ? ([palette.primary, palette.secondary, palette.accent, palette.text].filter(
        Boolean,
      ) as string[])
    : [];

  const set = <K extends string>(key: K, value: unknown) => {
    onChange({ [key]: value } as Partial<TemplateElement>);
    onCommit();
  };

  const availableTokens = [
    ...SYSTEM_TOKENS,
    ...doc.fields.map((field) => ({ token: field.key, label: field.label })),
  ];

  if (!element) {
    return (
      <aside className="studio-panel studio-panel-right" aria-label="Canvas properties">
        <div className="stack-sm stack">
          <h3 style={{ fontSize: '0.9rem' }}>Canvas</h3>
          <p className="subtle">Select an element to edit it.</p>
        </div>

        <div className="prop-grid">
          <Num
            label="Width"
            value={doc.canvas.width}
            onChange={(v) => onCanvasChange({ width: v })}
            min={64}
            suffix="px"
          />
          <Num
            label="Height"
            value={doc.canvas.height}
            onChange={(v) => onCanvasChange({ height: v })}
            min={64}
            suffix="px"
          />
        </div>

        <Color
          label="Background"
          value={doc.canvas.background}
          onChange={(v) => onCanvasChange({ background: v })}
          swatches={swatches}
        />

        <Num
          label="Safe area"
          value={doc.canvas.safeArea}
          onChange={(v) => onCanvasChange({ safeArea: v })}
          min={0}
          suffix="px"
        />

        <p className="subtle">
          The safe area is an editor guide only. It marks the margin an office printer is likely to
          crop, and is never rendered onto a credential.
        </p>
      </aside>
    );
  }

  return (
    <aside className="studio-panel studio-panel-right" aria-label="Element properties">
      <div className="row row-between">
        <h3 style={{ fontSize: '0.9rem', textTransform: 'capitalize' }}>{element.type}</h3>
        <div className="row" style={{ gap: 2 }}>
          <button className="btn btn-ghost btn-sm" onClick={onDuplicate} title="Duplicate">
            ⧉
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onDelete}
            title="Delete"
            style={{ color: 'var(--danger)' }}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="prop-grid">
        <Num label="X" value={element.x} onChange={(v) => set('x', v)} />
        <Num label="Y" value={element.y} onChange={(v) => set('y', v)} />
        <Num label="Width" value={element.width} onChange={(v) => set('width', v)} min={1} />
        <Num label="Height" value={element.height} onChange={(v) => set('height', v)} min={1} />
        <Num
          label="Rotation"
          value={element.rotation}
          onChange={(v) => set('rotation', v)}
          min={-360}
          max={360}
          suffix="°"
        />
        <Num
          label="Opacity"
          value={element.opacity}
          onChange={(v) => set('opacity', v)}
          min={0}
          max={1}
          step={0.05}
        />
      </div>

      {element.type === 'text' && (
        <>
          <label className="stack" style={{ gap: 3 }}>
            <span className="prop-label">Content</span>
            <textarea
              className="mini-input"
              rows={3}
              value={element.content}
              onChange={(e) => onChange({ content: e.target.value } as Partial<TemplateElement>)}
              onBlur={onCommit}
            />
          </label>

          <div className="stack-sm stack">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setTokenOpen((open) => !open)}
              aria-expanded={tokenOpen}
            >
              Insert a merge field
            </button>
            {tokenOpen && (
              <div
                className="stack"
                style={{ gap: 2, maxHeight: 180, overflowY: 'auto' }}
              >
                {availableTokens.map((entry) => (
                  <button
                    key={entry.token}
                    className="layer-item"
                    onClick={() => {
                      onChange({
                        content: `${element.content}{{${entry.token}}}`,
                      } as Partial<TemplateElement>);
                      onCommit();
                    }}
                  >
                    <code className="mono" style={{ fontSize: '0.7rem' }}>
                      {`{{${entry.token}}}`}
                    </code>
                    <span className="subtle" style={{ marginLeft: 'auto', fontSize: '0.7rem' }}>
                      {entry.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Choice
            label="Font"
            value={element.fontFamily}
            options={FONT_CHOICES.map((f) => ({ value: f, label: f }))}
            onChange={(v) => set('fontFamily', v)}
          />

          <div className="prop-grid">
            <Num label="Size" value={element.fontSize} onChange={(v) => set('fontSize', v)} min={1} />
            <Choice
              label="Weight"
              value={String(element.fontWeight)}
              options={[300, 400, 500, 600, 700, 800].map((w) => ({
                value: String(w),
                label: String(w),
              }))}
              onChange={(v) => set('fontWeight', Number(v))}
            />
            <Choice
              label="Align"
              value={element.align}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Centre' },
                { value: 'right', label: 'Right' },
              ]}
              onChange={(v) => set('align', v)}
            />
            <Choice
              label="Vertical"
              value={element.verticalAlign}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'middle', label: 'Middle' },
                { value: 'bottom', label: 'Bottom' },
              ]}
              onChange={(v) => set('verticalAlign', v)}
            />
            <Num
              label="Line height"
              value={element.lineHeight}
              onChange={(v) => set('lineHeight', v)}
              min={0.5}
              max={4}
              step={0.05}
            />
            <Num
              label="Tracking"
              value={element.letterSpacing}
              onChange={(v) => set('letterSpacing', v)}
              step={0.5}
            />
          </div>

          <Color label="Colour" value={element.color} onChange={(v) => set('color', v)} swatches={swatches} />

          <Choice
            label="Case"
            value={element.textTransform}
            options={[
              { value: 'none', label: 'As typed' },
              { value: 'uppercase', label: 'UPPERCASE' },
              { value: 'lowercase', label: 'lowercase' },
              { value: 'capitalize', label: 'Capitalise' },
            ]}
            onChange={(v) => set('textTransform', v)}
          />

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={element.autoFit}
              onChange={(e) => set('autoFit', e.target.checked)}
            />
            <span style={{ fontSize: '0.8rem' }}>
              Shrink to fit
              <span className="hint" style={{ display: 'block' }}>
                Long names shrink instead of overflowing. Strongly recommended for anything holding
                a recipient name.
              </span>
            </span>
          </label>

          {element.autoFit && (
            <Num
              label="Minimum size"
              value={element.minFontSize}
              onChange={(v) => set('minFontSize', v)}
              min={1}
            />
          )}
        </>
      )}

      {element.type === 'shape' && (
        <>
          <Choice
            label="Shape"
            value={element.shape}
            options={[
              { value: 'rectangle', label: 'Rectangle' },
              { value: 'ellipse', label: 'Ellipse' },
              { value: 'line', label: 'Line' },
            ]}
            onChange={(v) => set('shape', v)}
          />
          <Color label="Fill" value={element.fill} onChange={(v) => set('fill', v)} swatches={swatches} />
          <Color label="Stroke" value={element.stroke} onChange={(v) => set('stroke', v)} swatches={swatches} />
          <div className="prop-grid">
            <Num
              label="Stroke width"
              value={element.strokeWidth}
              onChange={(v) => set('strokeWidth', v)}
              min={0}
            />
            <Num
              label="Corner radius"
              value={element.borderRadius}
              onChange={(v) => set('borderRadius', v)}
              min={0}
            />
          </div>
          <Choice
            label="Brand colour"
            value={element.brandRef ?? ''}
            options={[
              { value: '', label: 'Fixed colour' },
              { value: 'primary', label: 'Brand primary' },
              { value: 'secondary', label: 'Brand secondary' },
              { value: 'accent', label: 'Brand accent' },
            ]}
            onChange={(v) => set('brandRef', v || undefined)}
          />
        </>
      )}

      {element.type === 'image' && (
        <>
          <label className="stack" style={{ gap: 3 }}>
            <span className="prop-label">Source</span>
            <input
              className="mini-input"
              value={element.src}
              onChange={(e) => onChange({ src: e.target.value } as Partial<TemplateElement>)}
              onBlur={onCommit}
              placeholder="https://… or opencred://asset/…"
              spellCheck={false}
            />
          </label>
          
          {assets.length > 0 && (
            <Choice
              label="Brand asset"
              value=""
              options={[
                { value: '', label: 'Select an uploaded asset...' },
                ...assets.map((a) => ({ value: a.reference, label: a.filename || a.id })),
              ]}
              onChange={(v) => { if (v) set('src', v); }}
            />
          )}

          <Choice
            label="Brand slot"
            value={element.brandRef ?? ''}
            options={[
              { value: '', label: 'Use the source above' },
              { value: 'logo', label: 'Brand logo' },
              { value: 'logoMark', label: 'Brand mark' },
              { value: 'watermark', label: 'Watermark' },
            ]}
            onChange={(v) => set('brandRef', v || undefined)}
          />
          <Choice
            label="Fit"
            value={element.fit}
            options={[
              { value: 'contain', label: 'Contain' },
              { value: 'cover', label: 'Cover' },
              { value: 'fill', label: 'Stretch' },
            ]}
            onChange={(v) => set('fit', v)}
          />
          <Num
            label="Corner radius"
            value={element.borderRadius}
            onChange={(v) => set('borderRadius', v)}
            min={0}
          />
        </>
      )}

      {element.type === 'qr' && (
        <>
          <Choice
            label="Encodes"
            value={element.source}
            options={[
              { value: 'verification', label: 'Verification page' },
              { value: 'custom', label: 'Custom value' },
            ]}
            onChange={(v) => set('source', v)}
          />
          {element.source === 'custom' && (
            <label className="stack" style={{ gap: 3 }}>
              <span className="prop-label">Value</span>
              <input
                className="mini-input"
                value={element.value ?? ''}
                onChange={(e) => onChange({ value: e.target.value } as Partial<TemplateElement>)}
                onBlur={onCommit}
              />
            </label>
          )}
          <Color
            label="Foreground"
            value={element.foreground}
            onChange={(v) => set('foreground', v)}
            swatches={swatches}
          />
          <Color
            label="Background"
            value={element.background}
            onChange={(v) => set('background', v)}
            swatches={swatches}
          />
          <Choice
            label="Error correction"
            value={element.errorCorrection}
            options={[
              { value: 'L', label: 'L — 7%' },
              { value: 'M', label: 'M — 15% (recommended)' },
              { value: 'Q', label: 'Q — 25%' },
              { value: 'H', label: 'H — 30%, for logo overlays' },
            ]}
            onChange={(v) => set('errorCorrection', v)}
          />
          <p className="subtle" style={{ fontSize: '0.75rem' }}>
            Keep this at least 90px square. Below that it stops scanning reliably from print.
          </p>
        </>
      )}

      {element.type === 'signature' && (
        <>
          <label className="stack" style={{ gap: 3 }}>
            <span className="prop-label">Signature image</span>
            <input
              className="mini-input"
              value={element.src}
              onChange={(e) => onChange({ src: e.target.value } as Partial<TemplateElement>)}
              onBlur={onCommit}
              placeholder="opencred://asset/…"
              spellCheck={false}
            />
          </label>

          {assets.length > 0 && (
            <Choice
              label="Brand asset"
              value=""
              options={[
                { value: '', label: 'Select an uploaded signature...' },
                ...assets.map((a) => ({ value: a.reference, label: a.filename || a.id })),
              ]}
              onChange={(v) => { if (v) set('src', v); }}
            />
          )}

          <label className="stack" style={{ gap: 3 }}>
            <span className="prop-label">Name</span>
            <input
              className="mini-input"
              value={element.name}
              onChange={(e) => onChange({ name: e.target.value } as Partial<TemplateElement>)}
              onBlur={onCommit}
            />
          </label>
          <label className="stack" style={{ gap: 3 }}>
            <span className="prop-label">Title</span>
            <input
              className="mini-input"
              value={element.title}
              onChange={(e) => onChange({ title: e.target.value } as Partial<TemplateElement>)}
              onBlur={onCommit}
            />
          </label>
          <label className="stack" style={{ gap: 3 }}>
            <span className="prop-label">Brand kit signature</span>
            <input
              className="mini-input"
              value={element.signatureRef ?? ''}
              onChange={(e) =>
                onChange({ signatureRef: e.target.value || undefined } as Partial<TemplateElement>)
              }
              onBlur={onCommit}
              placeholder="primary"
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={element.showRule}
              onChange={(e) => set('showRule', e.target.checked)}
            />
            <span style={{ fontSize: '0.8rem' }}>Show the signature rule</span>
          </label>
        </>
      )}

      <hr className="divider" />

      <label className="stack" style={{ gap: 3 }}>
        <span className="prop-label">Show only when</span>
        <input
          className="mini-input"
          value={element.showIf ?? ''}
          onChange={(e) => onChange({ showIf: e.target.value || undefined } as Partial<TemplateElement>)}
          onBlur={onCommit}
          placeholder="grade"
          spellCheck={false}
        />
        <span className="hint" style={{ fontSize: '0.72rem' }}>
          A merge field name. The element is hidden for rows where it is empty — one template can
          serve learners with and without a grade.
        </span>
      </label>

      <div className="row">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={element.locked}
            onChange={(e) => set('locked', e.target.checked)}
          />
          <span style={{ fontSize: '0.8rem' }}>Lock</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={element.hidden}
            onChange={(e) => set('hidden', e.target.checked)}
          />
          <span style={{ fontSize: '0.8rem' }}>Hide</span>
        </label>
      </div>
    </aside>
  );
}
