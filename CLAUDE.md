# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Asistencia Sion** is a web-based attendance and member management system for a church (Iglesia Sion). It's a single-page application (SPA) built with vanilla JavaScript, HTML, and CSS that integrates with Google Sheets as a backend via Google Apps Script.

The application runs entirely in the browser, syncing data to a Google Sheets spreadsheet. It supports managing church members, tracking attendance at meetings, recording spiritual milestones (baptisms, seminary participation), and generating activity reports.

## Architecture

### Tech Stack
- **Frontend**: Vanilla JavaScript (no frameworks), HTML5, CSS3
- **Backend**: Google Apps Script (GAS) - serverless backend running in Google Sheets
- **Data Storage**: Google Sheets spreadsheet (ID: `1_mXRRl4xARdYM5xfrMlJPraMUQc2a4yFEYG-a2u_zFE`)
- **Styling**: Custom CSS with design tokens (colors, shadows, typography)
- **Local Storage**: Browser localStorage for offline caching and sync state
- **IndexedDB**: Optional photo storage (IndexedDB database)

### Core Files

**Frontend:**
- `index.html` (5310 lines) - Single HTML file containing all UI, styles, and JavaScript
  - CSS: Design system with custom properties, layouts, components (cards, buttons, modals, forms)
  - JavaScript: All app logic, state management, rendering, API integration, local sync

**Backend:**
- `IglesiaSion_v14.gs` (840 lines) - Google Apps Script file deployed as a web app
  - Handles HTTP GET/POST requests
  - Manages read/write operations to Google Sheets
  - Data serialization/deserialization between frontend objects and sheet rows

**Archive:**
- `asistencia-iglesia-v30.html` - Previous version (reference only)

### Data Model

The app manages five main entities stored in separate Google Sheets:

1. **Personas (Members)**
   - Core fields: id, nombre, fechaNac, sexo, estadoCivil, conyugeId
   - Contact: celular, email, direccion
   - Church link: sedeId, grupoId, rol, ingreso, activo
   - Spiritual: bautizado, bautismo_fecha, bautismo_estado
   - Ministry: ministerio
   - Seminary: vaAlSeminario, seminario_estado, seminario_nombre, seminario_fecha_inicio, seminario_fecha_fin
   - Tracking: comoLlego, notas
   - Media: photo (base64 or URL)

2. **Reuniones (Sessions/Meetings)**
   - Fields: id, fecha, tipo, sedeId, presentes (JSON array)
   - Tracks attendance at each meeting

3. **Sedes (Branch Locations)**
   - Fields: id, nombre, color, desc
   - Church branches/locations

4. **Grupos (Groups)**
   - Fields: id, sedeId, nombre, desc
   - Groups within each branch

5. **Tipos (Member Types)**
   - Fields: id, nombre, color
   - Member role classifications

**Additional Sheets:**
- `Asistencia` - Real-time attendance tracking for current session
- `Actividad` (Sondeo) - Activity snapshots with attendance statistics
- `TiposReunion` - Meeting type definitions (Domingo, Jueves, Jóvenes, Evento)
- `Mensajes` - Key-value store for UI messages/labels

### Data Flow

1. **Startup**: `syncAll()` loads data from GAS backend → stored in `members`, `sessions`, `sedes`, `grupos`, etc. variables
2. **Offline Work**: App renders UI from in-memory data; user edits work locally
3. **Sync**: User manually syncs via UI button → `apiPost()` sends batch changes to GAS
4. **Backend Persistence**: GAS updates Google Sheets rows via `upsert()` or `upsertBatch()`
5. **Local Cache**: After sync, data saved to localStorage as JSON

### Key UI Sections

The app has six main sections (tab navigation):

1. **Nueva Reunión** (New Meeting) - Record attendance for today's meeting
2. **Miembros** (Members) - View/edit member database
3. **Historial** (History) - View past meetings and attendance statistics
4. **Cumples** (Birthdays) - View upcoming birthdays, send WhatsApp wishes
5. **Sondeo** (Activity/Survey) - Generate and publish attendance activity reports
6. **Config** (Settings) - Manage sedes, grupos, tipos, meeting types, backend URL

### Important Functions & Patterns

**API Communication:**
- `api(params)` - GET requests to GAS backend (returns action results)
- `apiPost(body)` - POST requests to GAS backend (sends mutations)
- `syncAll()` - Loads all data from backend (called on startup and manual refresh)
- Error handling: Sync status shows green dot (synced), orange (syncing), red (error)

**Rendering:**
- `renderAll()` - Re-render all visible sections
- Section-specific renderers: `renderAsist()`, `renderMiembros()`, `renderHistorial()`, etc.
- Modal system: `openModal(id)`, `closeModal(id)` for dialogs
- Toasts: `toast(msg, type, duration)` for notifications

**Local Storage:**
- `saveLocal()` - Persist in-memory data to browser localStorage
- Photo storage: `savePhotoLocal()`, `getPhotoLocal()`, `deletePhotoLocal()` use IndexedDB
- Constants: `SCRIPT_URL_KEY`, `sion_members`, `sion_sessions`, `sion_photos_b64`, etc.

**ID Management:**
- `getNextId()`, `consumeNextId()` - Numeric IDs for members
- `nextIdFor(key, list)` - Generic ID generation for any entity type

**Date & Birthday Logic:**
- `fmtDate(d)` - Format dates as DD/MM/YYYY
- `bdayDaysUntil()`, `bdayAge()` - Birthday calculations
- `getMiembrosConCumplesMes()` - Find members with birthdays this month
- `waBday()`, `waBdayMasivo()` - WhatsApp greeting integration

**Attendance Tracking:**
- `curAttend` - In-memory state of current meeting attendance
- `asistOrden` - Customizable order of members in attendance list
- `sincronizarAsistencia()` - Save attendance session to backend
- `renderAusentesEstaSemana()` - Show who didn't attend recent meetings

**Photo Management:**
- `openPhotoDB()`, `loadPhotosFromDB()` - IndexedDB initialization
- Photos can be URLs or base64-encoded strings
- Lightbox: `openLightbox(url, nombre)`, `closeLightbox()`

### GAS Backend API

**GET Actions:**
- `getMembers` / `getPersonas` - Fetch all members
- `getSessions` - Fetch all meetings
- `getSedes`, `getGrupos`, `getTipos` - Fetch reference data
- `getTiposReunion` - Fetch meeting types
- `getMensajes` - Fetch UI messages/labels
- `getOrden` - Fetch current attendance sheet state

**POST Actions:**
- `saveMember` / `savePersona` - Create/update member (upsert)
- `saveMembersBatch` / `savePersonasBatch` - Batch save members
- `deleteMember` / `deletePersona` - Delete member
- `saveSession` - Create/update meeting session
- `deleteSession` - Delete meeting
- `saveSede`, `saveGrupo`, `saveTipos` - Bulk replace reference data
- `saveTiposReunion` - Bulk replace meeting types
- `saveMensajes` - Save UI messages
- `saveSondeo` - Save formatted activity report snapshot
- `clearAsistencia` - Wipe attendance sheet
- `updateAsistenciaBatch` - Apply checkbox updates to attendance sheet

**Response Format:**
```javascript
{ ok: true, ...data }     // Success
{ ok: false, error: msg } // Error
```

### GAS Helper Functions

- `jsonOk(data)`, `jsonErr(msg)` - Response formatting
- `sheetToObjects(sheetName, headers)` - Convert sheet rows to objects
- `objToRow(obj, headers)` - Convert object to sheet row
- `upsert(sheetName, headers, obj)` - Create/update single row
- `upsertBatch(sheetName, headers, objs)` - Batch create/update
- `deleteById(sheetName, id)` - Delete by ID
- `replaceSheet(sheetName, headers, rows)` - Clear and re-populate sheet
- `flattenPersona(raw)` - Normalize member object before saving (handles legacy field names, flattens nested objects)
- `getAsistenciaSheet()` - Get current attendance sheet reference

### Development Notes

**Versioning:**
- GAS file is versioned: `IglesiaSion_v14.gs`
- Changes tracked in git with descriptive commit messages (v13, v12, etc.)
- Backward compatibility handled in frontend (legacy field name mapping)

**Legacy Compatibility:**
- Frontend sends `tipoAsistente`, backend maps to `rol`
- Old seminario fields (`seminario1`, `seminario2`) dropped in favor of flattened columns
- Photo storage evolved: URL → base64 → IndexedDB

**Known Patterns:**
- Data flattening: Nested objects (bautismo, seminario) stored as flat columns in sheets, reconstructed on read
- Batch operations: Frontend collects changes, sends as batch POST for efficiency
- Offline-first: App works offline, syncs when possible
- Linear search: Small dataset size (typically <500 members) allows O(n) lookups in sheets

**UI/UX Patterns:**
- Tab navigation with `.sec` visibility toggle
- Color coding: Members by sede (color palette), attendance status (green/yellow/red)
- Initials avatar: `ini(name)` generates 2-char avatar from name
- Emoji integration: Icons for meeting types, status badges

## GAS Deployment

The backend is deployed as a Google Apps Script web app. To redeploy:

1. Open the Google Sheets document
2. Go to Tools → Script Editor
3. Replace the code in the `.gs` file with the latest version
4. Deploy as web app (Deploy → New deployment → Web app)
5. Copy new deployment URL → Update `SCRIPT_URL_DEFAULT` in `index.html`

The current deployment URL is stored as `SCRIPT_URL_DEFAULT` in `index.html` and can be overridden via the Config tab.

## Important Notes

- **No Build Process**: Single HTML file served directly; no build step required
- **Time Zone**: Hardcoded to `America/Argentina/Buenos_Aires` in GAS
- **Google Sheets Integration**: Any field added to `HEADERS` in GAS must be manually added to the spreadsheet or handled gracefully when columns are missing
- **API Rate Limits**: GAS has execution time limits; prefer batch operations (`saveMembersBatch`, `updateAsistenciaBatch`) over single-row writes
- **Photo Storage**: Photos evolve URL → base64 → IndexedDB; `savePhotoLocal()`/`getPhotoLocal()` use IndexedDB, not localStorage
- **Localization**: All UI is in Spanish; user-facing strings are stored in the "Mensajes" sheet and retrieved via `getMensajes`
- **Attendance Sheet is Ephemeral**: The `Asistencia` sheet is rebuilt each session via `clearAsistencia` + `updateAsistenciaBatch`; changes there are not permanent
- **New Member Fields**: Add to `HEADERS.PERSONAS` in GAS, add the input in `openMemberModal()` HTML generation, redeploy GAS
