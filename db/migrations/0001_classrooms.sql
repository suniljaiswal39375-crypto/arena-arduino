CREATE TABLE users (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text, email text UNIQUE, email_verified timestamptz, image text,
  role text NOT NULL DEFAULT 'student' CONSTRAINT users_role_check CHECK (role IN ('student','teacher'))
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));
CREATE TABLE accounts (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL, provider text NOT NULL, provider_account_id text NOT NULL,
  refresh_token text, access_token text, expires_at integer, token_type text, scope text, id_token text, session_state text,
  PRIMARY KEY (provider, provider_account_id)
);
CREATE TABLE sessions (
  session_token text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE TABLE verification_tokens (identifier text NOT NULL, token text NOT NULL, expires timestamptz NOT NULL, PRIMARY KEY(identifier, token));
CREATE TABLE classrooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  join_code text NOT NULL UNIQUE CHECK (join_code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$'),
  archived boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX classrooms_owner_idx ON classrooms(owner_id);
CREATE TABLE memberships (
  classroom_id uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(classroom_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);
CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), classroom_id uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160), mission_slug text NOT NULL,
  due_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assignments_class_idx ON assignments(classroom_id);
CREATE TABLE submissions (
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project jsonb NOT NULL, version integer NOT NULL DEFAULT 1 CONSTRAINT submission_version_positive CHECK (version > 0),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  review_status text NOT NULL DEFAULT 'submitted' CONSTRAINT submission_review_check CHECK (review_status IN ('submitted','reviewed','needs-work')),
  feedback text NOT NULL DEFAULT '' CHECK (length(feedback) <= 2000), reviewed_at timestamptz,
  PRIMARY KEY(assignment_id, student_id)
);
CREATE TABLE rate_limits (key text PRIMARY KEY, count integer NOT NULL CHECK (count > 0), expires_at timestamptz NOT NULL);
CREATE INDEX rate_limits_expiry_idx ON rate_limits(expires_at);
