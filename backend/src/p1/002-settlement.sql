CREATE TABLE settlement_version (
  group_buy_id TEXT NOT NULL REFERENCES group_buy(id),
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  candidate_json TEXT NOT NULL CHECK (json_valid(candidate_json)),
  confirmed_at TEXT,
  PRIMARY KEY (group_buy_id, version_no)
) STRICT;
CREATE TRIGGER settlement_version_update BEFORE UPDATE ON settlement_version
WHEN OLD.confirmed_at IS NOT NULL OR NEW.confirmed_at IS NULL OR NEW.candidate_json <> OLD.candidate_json
  OR NEW.version_no <> OLD.version_no OR NEW.group_buy_id <> OLD.group_buy_id
BEGIN SELECT RAISE(ABORT, 'immutable settlement version'); END;
CREATE TRIGGER settlement_version_delete BEFORE DELETE ON settlement_version
BEGIN SELECT RAISE(ABORT, 'immutable settlement version'); END;
CREATE TRIGGER settlement_version_confirm_matches_snapshot BEFORE UPDATE OF confirmed_at ON settlement_version
WHEN (SELECT count(*) FROM settlement_line WHERE group_buy_id = OLD.group_buy_id AND version_no = OLD.version_no)
  <> json_array_length(OLD.candidate_json, '$.lines')
BEGIN SELECT RAISE(ABORT, 'incomplete settlement lines'); END;

CREATE TABLE settlement_line (
  group_buy_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  line_no INTEGER NOT NULL CHECK (line_no BETWEEN 0 AND 3),
  PRIMARY KEY (group_buy_id, version_no, user_id),
  UNIQUE (group_buy_id, version_no, line_no),
  FOREIGN KEY (group_buy_id,version_no) REFERENCES settlement_version(group_buy_id,version_no)
) STRICT;
CREATE TRIGGER settlement_line_insert BEFORE INSERT ON settlement_line
WHEN NOT EXISTS (
  SELECT 1 FROM settlement_version WHERE group_buy_id = NEW.group_buy_id AND version_no = NEW.version_no
    AND confirmed_at IS NULL AND json_extract(candidate_json, '$.lines[' || NEW.line_no || '].userId') = NEW.user_id
)
BEGIN SELECT RAISE(ABORT, 'settlement line not in candidate'); END;
CREATE TRIGGER settlement_line_update BEFORE UPDATE ON settlement_line
BEGIN SELECT RAISE(ABORT, 'immutable settlement line'); END;
CREATE TRIGGER settlement_line_delete BEFORE DELETE ON settlement_line
BEGIN SELECT RAISE(ABORT, 'immutable settlement line'); END;

CREATE TABLE settlement_state (
  group_buy_id TEXT PRIMARY KEY REFERENCES group_buy(id),
  pending_version INTEGER,
  current_version INTEGER,
  FOREIGN KEY (group_buy_id,pending_version) REFERENCES settlement_version(group_buy_id,version_no),
  FOREIGN KEY (group_buy_id,current_version) REFERENCES settlement_version(group_buy_id,version_no),
  CHECK (pending_version IS NULL OR current_version IS NULL OR pending_version > current_version)
) STRICT;
CREATE TABLE settlement_confirmation (
  group_buy_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY (group_buy_id,version_no,user_id),
  FOREIGN KEY (group_buy_id,version_no,user_id) REFERENCES settlement_line(group_buy_id,version_no,user_id)
) STRICT;
CREATE TRIGGER settlement_confirmation_only_candidate BEFORE INSERT ON settlement_confirmation
WHEN NOT EXISTS (
  SELECT 1 FROM settlement_state AS s JOIN settlement_line AS l
    ON l.group_buy_id = s.group_buy_id AND l.version_no = s.pending_version
  WHERE s.group_buy_id = NEW.group_buy_id AND s.pending_version = NEW.version_no
    AND l.user_id = NEW.user_id AND l.line_no > 0
)
BEGIN SELECT RAISE(ABORT, 'not a member of the pending candidate'); END;
CREATE TRIGGER settlement_confirmation_update BEFORE UPDATE ON settlement_confirmation
BEGIN SELECT RAISE(ABORT, 'immutable settlement confirmation'); END;
CREATE TRIGGER settlement_confirmation_delete BEFORE DELETE ON settlement_confirmation
BEGIN SELECT RAISE(ABORT, 'immutable settlement confirmation'); END;
CREATE TABLE settlement_event (
  event_no INTEGER PRIMARY KEY,
  group_buy_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('TRANSFER_REPORTED','TRANSFER_CONFIRMED','REFUND_CONFIRMED','MERCHANT_REFUND_CONFIRMED','REVERSAL','RECEIVED','REVERSED')),
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  related_event_id TEXT,
  happened_at INTEGER NOT NULL,
  UNIQUE (group_buy_id,event_id),
  UNIQUE (group_buy_id,actor_id,request_key),
  FOREIGN KEY (group_buy_id,version_no,user_id) REFERENCES settlement_line(group_buy_id,version_no,user_id),
  FOREIGN KEY (group_buy_id,related_event_id) REFERENCES settlement_event(group_buy_id,event_id)
) STRICT;
CREATE INDEX settlement_event_replay ON settlement_event(group_buy_id,event_no);
CREATE UNIQUE INDEX settlement_single_related_command ON settlement_event(group_buy_id,kind,related_event_id) WHERE related_event_id IS NOT NULL;
CREATE TRIGGER settlement_event_requires_confirmed_version BEFORE INSERT ON settlement_event
WHEN NOT EXISTS (
  SELECT 1 FROM settlement_version WHERE group_buy_id = NEW.group_buy_id AND version_no = NEW.version_no AND confirmed_at IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'settlement event requires confirmed version'); END;
CREATE TRIGGER settlement_event_update BEFORE UPDATE ON settlement_event
BEGIN SELECT RAISE(ABORT, 'immutable settlement event'); END;
CREATE TRIGGER settlement_event_delete BEFORE DELETE ON settlement_event
BEGIN SELECT RAISE(ABORT, 'immutable settlement event'); END;
CREATE TABLE settlement_action (
  group_buy_id TEXT NOT NULL REFERENCES group_buy(id),
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('NO_SHOW','RETURN_REQUIRED','ORDER_ISSUE','CORRECTION')),
  version_no INTEGER NOT NULL,
  user_id TEXT,
  opened_at INTEGER NOT NULL,
  resolved_at INTEGER,
  PRIMARY KEY (group_buy_id,id),
  FOREIGN KEY (group_buy_id,version_no) REFERENCES settlement_version(group_buy_id,version_no),
  FOREIGN KEY (group_buy_id,version_no,user_id) REFERENCES settlement_line(group_buy_id,version_no,user_id),
  CHECK (kind NOT IN ('NO_SHOW','RETURN_REQUIRED') OR user_id IS NOT NULL)
) STRICT;
CREATE TABLE saving_record (
  group_buy_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  actual_quantity INTEGER NOT NULL CHECK (actual_quantity > 0),
  actual_net_cost INTEGER NOT NULL CHECK (actual_net_cost >= 0),
  numerator TEXT NOT NULL,
  denominator TEXT NOT NULL,
  eligible INTEGER NOT NULL CHECK (eligible IN (0,1)),
  PRIMARY KEY (group_buy_id,user_id),
  FOREIGN KEY (group_buy_id,version_no,user_id) REFERENCES settlement_line(group_buy_id,version_no,user_id)
) STRICT;
CREATE INDEX savings_by_user ON saving_record(user_id,eligible);
