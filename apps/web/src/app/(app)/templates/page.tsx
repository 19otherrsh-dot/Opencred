'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { formatDateShort, formatNumber } from '@/lib/format';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Select,
  SkeletonRows,
} from '@/components/ui';

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  librarySlug: string | null;
  version: number;
  archivedAt: string | null;
  credentialCount: number;
  updatedAt: string;
}

interface LibraryEntry {
  slug: string;
  name: string;
  category: string;
  kind: string;
  orientation: string;
  tags: string[];
  width: number;
  height: number;
}

export default function TemplatesPage() {
  const router = useRouter();
  const { can } = useAuth();
  const templates = useApi<TemplateRow[]>('/v1/templates?includeArchived=true');
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="stack-lg stack">
      <div className="row row-between row-wrap">
        <div>
          <h1>Design studio</h1>
          <p className="subtle">
            Templates are open JSON documents. Edit them here, or contribute one to the library.
          </p>
        </div>
        {can('templates:write') && (
          <Button variant="primary" onClick={() => setPickerOpen(true)}>
            New template
          </Button>
        )}
      </div>

      {templates.error && <ErrorNotice error={templates.error} />}

      {templates.loading ? (
        <SkeletonRows rows={4} />
      ) : (templates.data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            title="No templates yet"
            action={
              <Button variant="primary" onClick={() => setPickerOpen(true)}>
                Start from the library
              </Button>
            }
          >
            The starter library has 150 ready-made certificate and badge designs, all CC0.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-3">
          {templates.data?.map((template) => (
            <article key={template.id} className="card card-pad stack-sm stack">
              <div className="row row-between">
                <span className="badge badge-neutral">{template.kind}</span>
                {template.archivedAt && <span className="badge badge-warn">Archived</span>}
              </div>

              <h3 style={{ fontSize: '1rem' }}>
                <Link href={`/templates/${template.id}`}>{template.name}</Link>
              </h3>

              {template.description && (
                <p className="subtle" style={{ minHeight: '2.4em' }}>
                  {template.description}
                </p>
              )}

              <div className="row row-between subtle" style={{ marginTop: 'auto' }}>
                <span>{formatNumber(template.credentialCount)} issued</span>
                <span>v{template.version} · {formatDateShort(template.updatedAt)}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <LibraryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onCreated={(id) => router.push(`/templates/${id}`)}
      />
    </div>
  );
}

/**
 * The starter-library picker (FR-DES-03).
 *
 * Filtered client-side because the whole index is a few hundred rows of
 * metadata — round-tripping to the server for every keystroke would be slower
 * and would not be any more correct.
 */
function LibraryPicker({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const library = useApi<{ categories: string[]; templates: LibraryEntry[] }>(
    open ? '/v1/templates/library' : null,
  );
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<LibraryEntry | null>(null);

  const create = useMutation(async () => {
    const template = await api.post<{ id: string }>('/v1/templates', {
      name: name.trim() || selected?.name || 'Untitled template',
      ...(selected ? { fromLibrary: selected.slug } : { kind: kind || 'certificate' }),
    });
    onClose();
    onCreated(template.id);
  });

  const entries = (library.data?.templates ?? []).filter((entry) => {
    if (kind && entry.kind !== kind) return false;
    if (category && entry.category !== category) return false;
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return (
      entry.name.toLowerCase().includes(needle) ||
      entry.tags.some((tag) => tag.includes(needle)) ||
      entry.category.toLowerCase().includes(needle)
    );
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Start a new template"
      footer={
        <div className="row row-between">
          <span className="subtle">
            {library.data ? `${entries.length} of ${library.data.templates.length} designs` : ''}
          </span>
          <div className="row">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              loading={create.busy}
              onClick={() => void create.run()}
              disabled={!selected && !kind}
            >
              {selected ? 'Use this design' : 'Start from blank'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="stack">
        {create.error && <ErrorNotice error={create.error} />}

        <Field label="Template name" hint="You can rename it later.">
          {(props) => (
            <Input
              {...props}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={selected?.name ?? 'Course completion certificate'}
            />
          )}
        </Field>

        <div className="row row-wrap">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search designs"
            aria-label="Search the template library"
            style={{ maxWidth: 200 }}
          />
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            aria-label="Filter by kind"
            style={{ maxWidth: 150 }}
          >
            <option value="">All kinds</option>
            <option value="certificate">Certificates</option>
            <option value="badge">Badges</option>
          </Select>
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filter by category"
            style={{ maxWidth: 160 }}
          >
            <option value="">All categories</option>
            {(library.data?.categories ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>

        {library.loading ? (
          <SkeletonRows rows={5} />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 'var(--sp-2)',
              maxHeight: 320,
              overflowY: 'auto',
              padding: 2,
            }}
          >
            {entries.slice(0, 120).map((entry) => (
              <button
                key={entry.slug}
                type="button"
                onClick={() => setSelected(entry)}
                aria-pressed={selected?.slug === entry.slug}
                className="card"
                style={{
                  padding: 'var(--sp-3)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderColor:
                    selected?.slug === entry.slug ? 'var(--brand)' : 'var(--border)',
                  boxShadow: selected?.slug === entry.slug ? '0 0 0 1px var(--brand)' : undefined,
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    aspectRatio: `${entry.width} / ${entry.height}`,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)',
                    marginBottom: 6,
                  }}
                />
                <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{entry.name}</div>
                <div className="subtle" style={{ fontSize: '0.72rem' }}>
                  {entry.category} · {entry.orientation}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
