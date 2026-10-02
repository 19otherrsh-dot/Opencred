'use client';

import { use } from 'react';
import { useApi } from '@/lib/use-api';
import { ErrorNotice } from '@/components/ui';
import { TemplateEditor } from '@/components/studio/editor';
import type { TemplateDocument } from '@/components/studio/types';

interface TemplateDetail {
  id: string;
  name: string;
  kind: string;
  version: number;
  document: TemplateDocument;
  mergeFields: string[];
  requiredFields: string[];
}

export default function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading } = useApi<TemplateDetail>(`/v1/templates/${id}`);

  if (loading) {
    return <div className="skeleton" style={{ height: '70dvh' }} />;
  }

  if (error) return <ErrorNotice error={error} />;
  if (!data) return null;

  return (
    <div style={{ margin: 'calc(var(--sp-6) * -1) calc(var(--sp-5) * -1)' }}>
      <TemplateEditor
        templateId={data.id}
        initialName={data.name}
        initialDocument={data.document}
        version={data.version}
      />
    </div>
  );
}
