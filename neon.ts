import { defineConfig } from '@neon/config/v1';

export default defineConfig({
  // Declare your Neon services here
  auth: false,
  // Object storage for user-produced files, split by how its URLs are used
  // rather than by what kind of file it is. The app's existing key prefixes
  // (`handyman-documents/`, `avatars/`, `receipts/`) decide which bucket an
  // object lands in, so key generation is untouched — see
  // STORAGE_NEON_PUBLIC_PREFIXES.
  //
  // Buckets are branch-scoped and copy-on-write, so a preview branch inherits
  // a consistent snapshot of both these files and the rows pointing at them.
  buckets: {
    // PRIVATE (the default). Handyman KYC verification documents, under the
    // `handyman-documents/` prefix. Every read goes through a presigned URL
    // with an expiry — which is the reason to prefer this over the Cloudinary
    // driver, whose "authenticated" URLs are signed but never expire.
    // Named `staging` because it predates this config and already held the
    // branch's credentials; the name is historical, not meaningful — the app
    // takes it from STORAGE_NEON_BUCKET, so nothing in code assumes it.
    staging: {},
    // PUBLIC_READ, and deliberately a separate bucket. Avatars and receipts
    // need a plain URL that a client can store and re-read later: `getUrl()`
    // is unsigned, so against the private bucket its address is refused, and
    // a presigned URL would expire while still stored. Keys carry a UUID, so
    // the address is unguessable, but anyone holding one can read it — the
    // same property the Cloudinary URLs already had.
    //
    // Identity documents are NOT here. Keeping them in the private bucket is
    // the whole point of the split; do not add `handyman-documents` to
    // STORAGE_NEON_PUBLIC_PREFIXES.
    'fetchit-public': { access: 'public_read' },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: '7d' };
    }
    // Existing branch: no changes
    return {};
  },
});
