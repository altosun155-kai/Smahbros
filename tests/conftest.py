import os
import tempfile

# routers.draft imports auth, which raises at import time if SECRET_KEY isn't
# set -- these tests only exercise pure functions and never touch a real
# secret, so a fixed placeholder is fine here.
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")

# database.py builds its engine from DATABASE_URL at import time, defaulting
# to sqlite:///./smash.db (the real local dev DB) if unset -- tests that need
# a real DB (see test_bracket_swap_api.py) must never touch that file, so
# this points every test at a throwaway temp file instead. Must be set before
# anything imports database.py or api.py, hence this lives in conftest.py's
# top level, not a fixture.
os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkstemp(suffix='.db')[1]}")
