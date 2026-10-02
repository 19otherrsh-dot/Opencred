import Link from 'next/link';
import type { Translator } from '@/lib/locale';

/**
 * The "no such credential" screen.
 *
 * Written carefully, because it is shown in two very different situations: a
 * typo in a hand-entered id, and a forged certificate whose id was invented.
 * It must be unambiguous about the second without accusing someone who simply
 * mistyped the first.
 *
 * This is a plain component rendered by the page rather than a `not-found.tsx`
 * boundary. See the note in `page.tsx` for why.
 */
export function CredentialNotFound({ t }: { t: Translator }) {
  return (
    <main
      id="main"
      className="container container-narrow"
      style={{ padding: '15vh 0' }}
      dir={t.dir}
      lang={t.locale}
    >
      <div className="verify-status verify-invalid" role="status">
        <span className="verify-status-icon" aria-hidden="true">
          ✕
        </span>
        <div>
          {/*
            A real h1, not a styled div. This page has no other heading, and a
            page with no heading gives a screen-reader user nothing to navigate
            by — they land on it with no idea what it says. The class carries
            the sizing so it does not look like a page title.
          */}
          <h1 style={{ fontSize: '1.05rem', fontWeight: 600, letterSpacing: 'normal' }}>
            {t.t('notFound.title')}
          </h1>
          <div className="subtle" style={{ fontWeight: 400 }}>
            {t.t('notFound.subtitle')}
          </div>
        </div>
      </div>

      <div className="stack" style={{ marginTop: 'var(--sp-5)' }}>
        <p className="muted">{t.t('notFound.reasons')}</p>
        <ul className="muted" style={{ paddingInlineStart: 20 }}>
          <li>
            <strong>{t.t('notFound.typo.label')}</strong> {t.t('notFound.typo.body')}
          </li>
          <li>
            <strong>{t.t('notFound.forged.label')}</strong> {t.t('notFound.forged.body')}
          </li>
        </ul>

        <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
          <Link className="btn btn-primary" href="/verify">
            {t.t('notFound.tryAnother')}
          </Link>
          <Link className="btn btn-ghost" href="/">
            OpenCred
          </Link>
        </div>
      </div>
    </main>
  );
}
