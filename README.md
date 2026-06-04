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
- `SEED_DEFAULT_PASS` seeds default users on first startup when the users table is empty

## Deploy to Render

This repo includes `render.yaml` for a Render Blueprint.

1. In Render, choose **New +** -> **Blueprint**.
2. Connect GitHub and select `HAL001BOT/bypass-forms-mvp`.
3. Keep the Blueprint path as `render.yaml`.
4. When Render asks for `SEED_DEFAULT_PASS`, enter a temporary strong password.
5. Create the service.
6. After the first successful login, change or rotate seeded user passwords before real use.

The Blueprint creates a Node web service with:

- Build command: `npm ci`
- Start command: `npm start`
- SQLite DB path: `/opt/render/project/src/storage/bypass-forms.db`
- Persistent disk mounted at `/opt/render/project/src/storage`

The persistent disk is required because Render service filesystems are otherwise ephemeral.
