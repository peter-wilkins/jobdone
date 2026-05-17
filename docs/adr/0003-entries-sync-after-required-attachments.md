# Entries sync only after required attachments upload

Confirmed Entries are visible locally immediately, but an Entry with required attachments is not marked synced or made cloud-visible until those original attachments upload successfully. This was chosen over syncing text first and attachments later because the Timeline is meant to be a faithful operational record; showing a cloud Entry without its user-attached Photos would make another device see an incomplete Entry.

## Consequences

Original Photos are required attachment data. Derived artifacts such as thumbnails, OCR text, labels, and embeddings can be produced later without blocking sync.
