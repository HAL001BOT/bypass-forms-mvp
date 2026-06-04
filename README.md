# Bypass Forms MVP

Sachem-styled Interlock / ESD bypass permit tracker, built from the provided bypass form.

## Features

- Multi-user login with roles: `admin`, `supervisor`, `engineer`, `operator`, `viewer`
- Create and edit bypass permits using the DOCX sections
- Track status from draft through submitted, active, restored, and closed
- Capture approvals, implementation details, monitoring requirements, and closeout
- Audit trail for create, update, and status changes
- CSV export for bypass records
- Includes the source DOCX template in `templates/Bypass_form.docx`

## Run

```bash
npm install
npm run seed-users
npm start
```

Open `http://localhost:3010`.

## Default users

All seeded users use `bypass123!` unless overridden with `SEED_DEFAULT_PASS`.

- `admin`
- `supervisor`
- `engineer`
- `operator`
- `viewer`

Change these before real use.

## Environment

- `PORT` defaults to `3010`
- `SESSION_SECRET` should be set in production
- `DB_PATH` can override the SQLite database location
