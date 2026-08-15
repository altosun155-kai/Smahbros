import os

# routers.draft imports auth, which raises at import time if SECRET_KEY isn't
# set -- these tests only exercise pure functions and never touch a real
# secret, so a fixed placeholder is fine here.
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")
