CREATE UNIQUE INDEX verification_submissions_one_pending_per_vet_idx
  ON verification_submissions (vet_id)
  WHERE status = 'pending';
