CREATE TYPE auth_session_status AS ENUM ('active', 'revoked');
CREATE TYPE password_reset_delivery_status AS ENUM ('pending', 'succeeded', 'failed');

CREATE TABLE user_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_hash_scheme text NOT NULL CHECK (password_hash_scheme = 'scrypt'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  active_role user_role NOT NULL,
  status auth_session_status NOT NULL DEFAULT 'active',
  access_token_hash char(64) UNIQUE,
  refresh_token_hash char(64) UNIQUE,
  access_expires_at timestamptz,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, active_role) REFERENCES role_memberships(user_id, role) ON DELETE RESTRICT,
  CHECK (
    (status = 'active'
      AND access_token_hash IS NOT NULL
      AND refresh_token_hash IS NOT NULL
      AND access_expires_at IS NOT NULL
      AND revoked_at IS NULL)
    OR
    (status = 'revoked'
      AND access_token_hash IS NULL
      AND refresh_token_hash IS NULL
      AND access_expires_at IS NULL
      AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions (user_id, created_at DESC)
  WHERE status = 'active';

CREATE TABLE auth_refresh_token_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  consumed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_refresh_token_history_session_idx
  ON auth_refresh_token_history (session_id, consumed_at DESC);

CREATE TABLE password_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  delivery_status password_reset_delivery_status NOT NULL DEFAULT 'pending',
  delivery_operation_id uuid UNIQUE,
  expires_at timestamptz NOT NULL,
  delivered_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((delivery_status = 'succeeded') = (delivered_at IS NOT NULL))
);

CREATE INDEX password_reset_requests_user_created_idx
  ON password_reset_requests (user_id, created_at DESC);
