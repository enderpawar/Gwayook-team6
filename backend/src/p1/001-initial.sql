CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_salt BLOB NOT NULL CHECK (length(password_salt) = 16),
  password_hash BLOB NOT NULL CHECK (length(password_hash) = 64),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE auth_session (
  token_hash BLOB PRIMARY KEY CHECK (length(token_hash) = 32),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
) STRICT;

CREATE TABLE product_analysis (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER NOT NULL CHECK (confirmed_at >= created_at),
  input_origin TEXT NOT NULL CHECK (input_origin IN ('MANUAL', 'CAPTURE', 'SAMPLE')),
  preset_id TEXT,
  allocation_mode TEXT NOT NULL CHECK (allocation_mode = 'SEALED_PACKAGE'),
  bulk_qty INTEGER NOT NULL CHECK (bulk_qty BETWEEN 1 AND 9007199254740991),
  unit_name TEXT NOT NULL CHECK (unit_name IN ('롤', '병', '개')),
  allocation_step INTEGER NOT NULL CHECK (allocation_step = 1),
  uniform_units INTEGER NOT NULL CHECK (uniform_units = 1),
  product_amount INTEGER NOT NULL CHECK (product_amount BETWEEN 0 AND 9007199254740991),
  shipping_fee INTEGER NOT NULL CHECK (shipping_fee BETWEEN 0 AND 9007199254740991),
  discount_amount INTEGER NOT NULL CHECK (discount_amount BETWEEN 0 AND 9007199254740991),
  includes_shipping INTEGER NOT NULL CHECK (includes_shipping IN (0, 1)),
  includes_discount INTEGER NOT NULL CHECK (includes_discount IN (0, 1)),
  is_estimate INTEGER NOT NULL CHECK (is_estimate = 0),
  total_amount INTEGER NOT NULL CHECK (total_amount BETWEEN 0 AND 9007199254740991),
  comparison_status TEXT NOT NULL CHECK (comparison_status IN ('READY', 'PENDING')),
  comparison_pending_reason TEXT,
  bulk_spec_base_amount INTEGER CHECK (bulk_spec_base_amount BETWEEN 1 AND 9007199254740991),
  baseline_spec_base_amount INTEGER CHECK (baseline_spec_base_amount BETWEEN 1 AND 9007199254740991),
  product_json TEXT NOT NULL CHECK (json_valid(product_json)),
  UNIQUE (id, user_id),
  CHECK (total_amount = product_amount + (1 - includes_shipping) * shipping_fee - (1 - includes_discount) * discount_amount),
  CHECK ((input_origin = 'SAMPLE') = (preset_id IS NOT NULL)),
  CHECK ((comparison_status = 'READY') = (baseline_spec_base_amount IS NOT NULL)),
  CHECK (comparison_status <> 'READY' OR bulk_spec_base_amount IS NOT NULL),
  CHECK ((comparison_status = 'PENDING') = (comparison_pending_reason IS NOT NULL))
) STRICT;

CREATE TRIGGER product_analysis_is_immutable BEFORE UPDATE ON product_analysis
BEGIN
  SELECT RAISE(ABORT, 'product_analysis is immutable');
END;

CREATE TABLE group_buy (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES users(id),
  analysis_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED', 'SETTLING', 'PICKUP', 'COMPLETED', 'CANCELLED')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  draft_input TEXT CHECK (draft_input IS NULL OR json_valid(draft_input)),
  headcount INTEGER CHECK (headcount BETWEEN 2 AND 4),
  public_location TEXT,
  application_deadline INTEGER,
  pickup_candidates TEXT CHECK (pickup_candidates IS NULL OR json_valid(pickup_candidates)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER,
  closed_at INTEGER,
  FOREIGN KEY (analysis_id, host_id) REFERENCES product_analysis(id, user_id),
  CHECK ((status = 'DRAFT' AND analysis_id IS NULL AND draft_input IS NOT NULL AND published_at IS NULL)
    OR (status <> 'DRAFT' AND analysis_id IS NOT NULL AND draft_input IS NULL AND published_at IS NOT NULL
      AND headcount IS NOT NULL AND application_deadline IS NOT NULL AND pickup_candidates IS NOT NULL))
) STRICT;

CREATE INDEX group_buy_by_host ON group_buy(host_id, updated_at DESC, id);

CREATE TABLE group_invite (
  id TEXT PRIMARY KEY,
  group_buy_id TEXT NOT NULL REFERENCES group_buy(id),
  token_hash BLOB NOT NULL UNIQUE CHECK (length(token_hash) = 32),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > issued_at),
  revoked_at INTEGER,
  UNIQUE (group_buy_id, id)
) STRICT;

CREATE UNIQUE INDEX one_active_invite ON group_invite(group_buy_id) WHERE revoked_at IS NULL;

CREATE TABLE group_participation (
  group_buy_id TEXT NOT NULL REFERENCES group_buy(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  invite_id TEXT NOT NULL,
  alias TEXT NOT NULL CHECK (length(alias) BETWEEN 1 AND 40),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'WITHDRAWN', 'REJECTED', 'EXCLUDED')),
  requested_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT REFERENCES users(id),
  approval_seq INTEGER CHECK (approval_seq BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (group_buy_id, user_id),
  UNIQUE (group_buy_id, approval_seq),
  FOREIGN KEY (group_buy_id, invite_id) REFERENCES group_invite(group_buy_id, id),
  CHECK (status <> 'APPROVED' OR approval_seq IS NOT NULL),
  CHECK ((decided_at IS NULL) = (decided_by IS NULL))
) STRICT;

CREATE TABLE group_seat (
  group_buy_id TEXT NOT NULL REFERENCES group_buy(id),
  seat_no INTEGER NOT NULL CHECK (seat_no BETWEEN 0 AND 3),
  user_id TEXT REFERENCES users(id),
  assigned_at INTEGER,
  role TEXT GENERATED ALWAYS AS (CASE WHEN seat_no = 0 THEN 'ORGANIZER' ELSE 'MEMBER' END) VIRTUAL,
  participant_user_id TEXT GENERATED ALWAYS AS (CASE WHEN seat_no > 0 THEN user_id END) VIRTUAL,
  PRIMARY KEY (group_buy_id, seat_no),
  UNIQUE (group_buy_id, user_id),
  FOREIGN KEY (group_buy_id, participant_user_id) REFERENCES group_participation(group_buy_id, user_id),
  CHECK (seat_no > 0 OR user_id IS NOT NULL),
  CHECK ((user_id IS NULL) = (assigned_at IS NULL))
) STRICT;

CREATE TABLE group_buy_event (
  event_no INTEGER PRIMARY KEY,
  group_buy_id TEXT NOT NULL REFERENCES group_buy(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  subject_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL,
  happened_at INTEGER NOT NULL,
  detail_json TEXT CHECK (detail_json IS NULL OR json_valid(detail_json))
) STRICT;

CREATE INDEX group_buy_events ON group_buy_event(group_buy_id, event_no);
