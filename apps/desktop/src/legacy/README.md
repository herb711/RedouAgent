# Legacy Bridge

This directory is reserved for narrow compatibility adapters during the rewrite.

Only add small shims that help the new architecture read or migrate legacy data. Reference source remains in `apps/desktop/src_legacy`.

Do not continue developing old local-service behavior here, and do not move Hermes legacy runtime implementation into this folder.
