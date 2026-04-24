-- Drop the vestigial key_nonce column from items.
--
-- The key_nonce was written during rotateProfileKey but never read.
-- The XChaCha20-Poly1305 nonce for DEK wrapping lives prepended in the
-- first 24 bytes of encrypted_item_key (see encryptItem/dekeyItem in
-- packages/crypto/src/client/items.ts). The separate column was a
-- design-era vestige that predates the combined-blob encoding.
--
-- Existing rows with non-null key_nonce are safe to drop: decryption
-- uses only encrypted_item_key (which carries the nonce inline).

ALTER TABLE "items" DROP COLUMN IF EXISTS "key_nonce";
