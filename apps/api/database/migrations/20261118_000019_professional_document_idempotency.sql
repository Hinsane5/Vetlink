ALTER TABLE professional_documents
  ADD COLUMN upload_key text,
  ADD COLUMN upload_fingerprint char(64),
  ADD CONSTRAINT professional_documents_upload_key_length CHECK (upload_key IS NULL OR length(upload_key) BETWEEN 8 AND 128),
  ADD CONSTRAINT professional_documents_upload_pair CHECK ((upload_key IS NULL) = (upload_fingerprint IS NULL)),
  ADD CONSTRAINT professional_documents_owner_upload_key UNIQUE (owner_id, upload_key);
