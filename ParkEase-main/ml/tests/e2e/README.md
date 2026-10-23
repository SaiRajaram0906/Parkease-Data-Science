# End-to-end checks

These two scripts exercise the whole running stack (database, API server,
Data Science service, web app). They were used for the Phase 10 testing and
are kept as a record of what was tested.

They assume a fresh database holding one user (`muthu@example.com`, owner, no
password) and one spot with 2 spaces owned by that user, with the API on port 5000 and the web app on 5173.
They create bookings and stop the Data Science service on purpose to test the
fallback, so do not run them against data you want to keep.

- `api_check.py`: 135 checks through the HTTP API, including what each role may and may not do.
- `browser_check.py <screenshot-folder>`: 49 checks in a real browser, one
  journey per role (needs `pip install playwright` and a Chromium install).
