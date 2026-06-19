# Stay Back Route Management System

A **Progressive Web Application (PWA)** for managing students who stay back after
regular school hours and require transport allocation. Installable on Android, iOS,
Windows and Mac; works offline for basic viewing; role-based login; Excel exports;
and pluggable WhatsApp notifications (SmartPing).

---

## 1. Features

| Module | Capabilities |
|---|---|
| **Login** | Username/password, JWT-based, role-aware UI |
| **Dashboard** | Summary cards + quick actions |
| **Students** | Add/Edit/Delete, search, filter, sort, pagination, bulk-select, **bulk Excel/CSV upload with validation preview**, Excel export |
| **5 PM Trips** | Select/filter students, "Assign for 5 PM Trip", today's trip list |
| **Buses** | Bus master CRUD, live occupancy %, GPS tracking link |
| **Route Assignment** | Manual assignment, **auto capacity validation**, route occupancy view |
| **Route Replacement** | Replace a route for all linked students, with **audit log** |
| **Notifications** | Review → "Send Route Notification" via SmartPing WhatsApp, delivery log, resend failed |
| **Reports** | Daily Route, Bus Occupancy, WhatsApp Delivery — all **export to Excel** |
| **Users** | Manage Transport Incharge / Data Entry accounts |
| **PWA** | Installable, offline caching, push-notification-ready, app icon + splash |

### Roles
- **Transport Incharge** — full access (students, buses, routes, replacement, WhatsApp, users, reports).
- **Data Entry User** — Add/Edit students, bulk upload, view route allocation. **No** bus config, **no** WhatsApp sending, **no** user management, **no** delete.

Role rules are enforced **on the server** (middleware) and reflected in the UI.

---

## 2. Technology Stack

- **Backend:** Node.js + Express
- **Database:** **MySQL / MariaDB** (via `mysql2`). The app **auto-creates the database
  and all tables** on first start using the `DB_*` settings in `.env`.
- **Auth:** JWT (`jsonwebtoken`) + `bcryptjs` password hashing
- **Excel:** `exceljs` (import parsing + export)
- **Frontend:** Vanilla JS PWA (no build step), responsive CSS, service worker
- **Uploads:** `multer`

> The data layer is isolated in `db/database.js`, which exposes an async
> `prepare().get/all/run` + `transaction()` API used by every `routes/*.js`. The
> connection runs in **UTC** and returns dates as strings so timestamps line up
> across the app.

---

## 3. Project Structure

```
Route Management System/
├── server.js                 # Express app entry, serves API + PWA
├── package.json
├── .env.example              # copy to .env and set DB_* + JWT_SECRET
├── db/
│   ├── schema.sql            # full MySQL table schema
│   ├── database.js           # MySQL pool, auto-create DB + tables, async query API
│   └── seed.js               # default users + sample data
├── middleware/
│   └── auth.js               # JWT sign/verify + role authorization
├── routes/                   # API endpoints (one file per module)
│   ├── auth.js  dashboard.js  students.js  buses.js
│   ├── routes.js  trips.js  notifications.js  reports.js  users.js
├── services/
│   ├── excel.js              # workbook build + upload parsing
│   └── whatsapp.js           # SmartPing integration (plug CURL here)
├── tools/
│   └── gen-icons.js          # regenerates PNG app icons
└── public/                   # PWA frontend
    ├── index.html  manifest.json  service-worker.js
    ├── css/styles.css
    ├── js/  (api.js, ui.js, pages.js, app.js)
    └── icons/  (icon.svg, icon-192/512.png, maskable)
```

---

## 4. Setup & Run

Prerequisites: **Node.js 18+** (tested on Node 23) and a reachable **MySQL/MariaDB**
server.

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env          # (Windows PowerShell: copy .env.example .env)
#    -> open .env and set:
#         DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME   (your MySQL server)
#         JWT_SECRET                                         (a long random string)

# 3. Seed default users + sample data
#    (this also auto-creates the database + tables if they don't exist)
npm run seed

# 4. Start the server
npm start
```

Open **http://localhost:3000**

### Database notes
- The app connects with the `DB_*` credentials and runs
  `CREATE DATABASE IF NOT EXISTS <DB_NAME>` then creates the tables — so **you don't
  need to create the schema manually**. The DB user needs `CREATE`/`ALTER`/`INDEX`
  privileges (plus `CREATE DATABASE` if `DB_NAME` doesn't already exist).
- If the user lacks `CREATE DATABASE` rights, create the empty database yourself and
  grant the user access to it; the app will still create the tables inside it.
- The schema lives in [db/schema.sql](db/schema.sql) if you prefer to review/import it manually.

### Default logins (created by the seed)
| Role | Username | Password |
|---|---|---|
| Transport Incharge | `admin` | `admin123` |
| Data Entry User | `dataentry` | `data123` |

> Change these immediately in production (Users screen → Edit, or via the account menu → Change Password).

### Useful scripts
```bash
npm start          # run server
npm run dev        # run with auto-reload (node --watch)
npm run seed       # seed if empty
npm run reset-db   # wipe ALL data and re-seed
node tools/gen-icons.js   # regenerate PNG icons from the design
```

---

## 5. WhatsApp / SmartPing Integration

Notifications are sent via **SmartPing BSP (api-wa.co campaign API)**, implemented in
`services/whatsapp.js`:

```
POST https://backend.api-wa.co/campaign/smartpingbsp/api/v2
{ "apiKey", "campaignName", "destination", "userName",
  "templateParams": [ student_name, bus_number, tracking_link ],
  "paramsFallbackValue": { "FirstName": "user" }, ... }
```

Until an API key is set, it runs in **SIMULATION mode** — messages are logged as *Sent*
(so you can test preview → send → delivery log → resend) but nothing is delivered.

### To go live
In `.env` set:
```ini
WHATSAPP_ENABLED=true
SMARTPING_API_KEY=<your api-wa.co API key>
SMARTPING_API_URL=https://backend.api-wa.co/campaign/smartpingbsp/api/v2
SMARTPING_CAMPAIGN_NAME=staybacktransport
SMARTPING_USERNAME=Digital Caampus
SMARTPING_COUNTRY_CODE=91     # optional: prefixed to bare 10-digit numbers
```

`templateParams` is sent in the order `[student_name, bus_number, tracking_link]`.
If your approved "staybacktransport" template has a different number or order of
variables, edit the `TEMPLATE_PARAMS` array in `services/whatsapp.js` to match it.

### Message template (preview/log copy)
The message stored in the delivery log uses these variables: `{{student_name}}`,
`{{bus_number}}`, `{{tracking_link}}`.

Default message:
```
Dear Parent,

Your ward {{student_name}} has been assigned to Bus {{bus_number}} for today's stay-back transport.

Live Tracking:
{{tracking_link}}

Thank you.
```

Delivery is logged per recipient with status **Sent / Failed / Pending**, and failed
messages can be re-sent from the Notifications → Message Tracking tab.

---

## 6. API Reference

All `/api/*` routes (except login) require `Authorization: Bearer <token>`.

### Auth
| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | `/api/auth/login` | any | `{username, password}` → `{token, user}` |
| GET | `/api/auth/me` | any | current user |
| POST | `/api/auth/change-password` | any | `{currentPassword, newPassword}` |

### Dashboard
| GET | `/api/dashboard/summary` | any | summary card counts |

### Students
| Method | Endpoint | Role | Notes |
|---|---|---|---|
| GET | `/api/students` | any | query: `search, class, section, category, route, status, sort, dir, page, pageSize` |
| GET | `/api/students/filters` | any | distinct values for dropdowns |
| GET | `/api/students/:id` | any | |
| POST | `/api/students` | any | create |
| PUT | `/api/students/:id` | any | update |
| DELETE | `/api/students/:id` | incharge | |
| POST | `/api/students/bulk-delete` | incharge | `{ids:[]}` |
| POST | `/api/students/bulk-upload/validate` | any | multipart `file` → validation preview |
| POST | `/api/students/bulk-upload/import` | any | multipart `file` → import valid rows |

### Buses
| GET | `/api/buses` · `/api/buses/:id` | any | includes occupancy |
| POST/PUT/DELETE | `/api/buses[...]` | incharge | |

### Routes
| GET | `/api/routes/occupancy` | any | route/bus capacity view |
| GET | `/api/routes/list` | any | distinct routes |
| POST | `/api/routes/assign` | incharge | `{studentIds, route, force}` → 409 `capacityWarning` if over capacity |
| GET | `/api/routes/replace/preview?old=&new=` | incharge | affected count |
| POST | `/api/routes/replace` | incharge | `{oldRoute, newRoute, force}` |
| GET | `/api/routes/replace/log` | incharge | audit log |

### Trips (5 PM)
| GET | `/api/trips/today?date=` | any |
| POST | `/api/trips/assign` | any | `{studentIds, date?}` |
| DELETE | `/api/trips/:tripId` | any |
| POST | `/api/trips/clear` | any |

### Notifications
| GET | `/api/notifications/preview?scope=trip|route&route=&date=` | any |
| POST | `/api/notifications/send` | incharge | `{studentIds, template?}` |
| POST | `/api/notifications/resend/:logId` | incharge |
| GET | `/api/notifications/log?status=&date=` | any |

### Reports (each has a matching `/export` returning `.xlsx`)
| GET | `/api/reports/daily-route` · `/daily-route/export` |
| GET | `/api/reports/bus-occupancy` · `/bus-occupancy/export` |
| GET | `/api/reports/whatsapp` · `/whatsapp/export` |
| GET | `/api/reports/students/export` |

### Users (incharge only)
| GET/POST | `/api/users` · PUT/DELETE `/api/users/:id` |

---

## 7. Database Schema (overview)

See `db/schema.sql` for the full DDL. Tables:

- **users** — `username, password_hash, full_name, role(transport_incharge|data_entry), status`
- **buses** — `bus_number, route_number, seating_capacity, gps_link, driver_name, driver_mobile, status`
- **students** — `student_code, name, class, section, category, parent_name, parent_mobile, route_number, status`
- **trip_assignments** — `student_id, trip_date, route_number, bus_id, assigned_by` (one row per student per date)
- **route_replacement_log** — `old_route, new_route, affected_count, updated_by_name, created_at`
- **notification_log** — `student_name, mobile, bus_number, tracking_link, message, status, provider_response, sent_at`

Occupancy is **derived** at query time (active students whose `route_number` matches a
bus's route), so it always reflects current data.

---

## 8. PWA / Install

- **Install button** appears automatically (Chrome/Edge/Android) via the in-app banner;
  or use the browser's "Install app" option. On iOS Safari: *Share → Add to Home Screen*.
- **Offline:** the app shell and the most recent API responses are cached by the service
  worker, so dashboards/listings remain viewable offline (an "offline" bar appears; editing is disabled).
- **Icons/splash:** generated in `public/icons/`. Re-run `node tools/gen-icons.js` after
  editing the design in `tools/gen-icons.js` / `public/icons/icon.svg`.
- **Push notifications:** the service worker already handles `push` and
  `notificationclick`; wire a push provider + VAPID keys when needed.

---

## 9. Deployment

The app is a single Node process serving both API and the PWA. Any host that runs
Node works (VPS, Render, Railway, Azure App Service, a school server, etc.).

### Generic / Linux VPS
```bash
git clone <repo> && cd "Route Management System"
npm install --omit=dev
cp .env.example .env     # set JWT_SECRET, PORT, SmartPing vars
npm run seed
# keep it running with a process manager:
npm i -g pm2
pm2 start server.js --name route-mgmt
pm2 save && pm2 startup
```
Put **Nginx/Caddy** in front for HTTPS (a PWA must be served over **HTTPS** —
or `localhost` — for service worker + install to work).

Example Nginx reverse proxy:
```nginx
server {
  server_name routes.yourschool.com;
  location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; }
}
# then: certbot --nginx -d routes.yourschool.com
```

### Windows Server
1. Install Node.js LTS.
2. Copy the folder, run `npm install`, set up `.env`, run `npm run seed`.
3. Run as a service with [NSSM](https://nssm.cc/) (`nssm install RouteMgmt`) pointing to
   `node.exe` with argument `server.js`, or use `pm2-windows-service`.
4. Front with IIS (URL Rewrite / ARR) or Caddy for HTTPS.

### Environment variables
| Var | Purpose |
|---|---|
| `PORT` | server port (default 3000) |
| `DB_HOST` / `DB_PORT` | MySQL host/port (default `localhost:3306`) |
| `DB_USER` / `DB_PASSWORD` | MySQL credentials |
| `DB_NAME` | database name (auto-created; default `stayback_routes`) |
| `DB_CONNECTION_LIMIT` | pool size (default 10) |
| `JWT_SECRET` | **set a long random string** |
| `JWT_EXPIRES_IN` | token lifetime (default `12h`) |
| `WHATSAPP_ENABLED` | `true` to send via SmartPing |
| `SMARTPING_*` | SmartPing endpoint/auth/template/sender |

### Backups
Back up the MySQL database on a schedule, e.g.:
```bash
mysqldump -h $DB_HOST -u $DB_USER -p stayback_routes > backup.sql
```
To reset all data and re-seed (development only): `npm run reset-db`.

---

## 10. Notes & Hardening

- Change default passwords before going live.
- Set a strong `JWT_SECRET`; tokens are stored client-side in `localStorage`.
- `npm audit` reports one *moderate* advisory from a transitive `uuid` inside ExcelJS;
  it is not reachable in this app's usage (we never pass a `buf` to uuid). Downgrading
  ExcelJS would be a breaking change, so it is intentionally left as-is.
- The app uses connection pooling (`DB_CONNECTION_LIMIT`) and runs the DB session in
  UTC. For multi-server deployments, point every instance at the same MySQL server.
- Restrict the MySQL user's privileges to `DB_NAME` once the database has been created.
