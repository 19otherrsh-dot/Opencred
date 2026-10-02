import { permanentRedirect } from 'next/navigation';

/**
 * `/verify/:id` redirects to `/v/:id`.
 *
 * There is exactly one canonical verification URL, and it is the short one:
 * `/v/:id` is what every QR code encodes, what every delivery email links, and
 * what is printed on the certificate itself. A second page rendering the same
 * answer at a second URL would be one more thing to keep in sync, and the two
 * would eventually disagree about whether a credential is valid.
 *
 * This route exists only so that a hand-typed or historically shared
 * `/verify/…` link still resolves. 308 rather than 302 so caches and search
 * engines record the canonical location.
 */
export default async function VerifyRedirect({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  permanentRedirect(`/v/${encodeURIComponent(publicId)}`);
}
