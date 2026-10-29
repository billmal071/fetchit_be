import { defineConfig } from '@neon/config/v1';

export default defineConfig({
  // Declare your Neon services here
  auth: false,
  // Object storage for user-produced files: handyman KYC verification
  // documents, avatars and shopping receipts. One bucket, with the prefixes
  // the app already generates (`avatars/`, `receipts/`, handyman documents),
  // so switching to this driver needs no change to key generation.
  //
  // PRIVATE (the default): these are identity documents. Every read goes
  // through a presigned URL with an expiry — which is the reason to prefer
  // this over the Cloudinary driver, whose "authenticated" URLs are signed
  // but never expire.
  //
  // Buckets are branch-scoped and copy-on-write, so a preview branch inherits
  // a consistent snapshot of both these files and the rows pointing at them.
  buckets: {
    'fetchit-uploads': {},
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
