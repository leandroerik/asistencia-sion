# Asistencia Sion

Sistema de gestión de miembros y asistencia para Iglesia Sion. Aplicación web de página única (SPA) que funciona en el navegador y sincroniza datos con Google Sheets como backend.

---

## Cómo ejecutar localmente

No hay proceso de compilación. El archivo `index.html` es la aplicación completa.

### Opción 1 — Abrir directo en el navegador
```
Doble clic en index.html
```
> Funciona para la mayoría de las funciones. Algunas APIs del navegador (como IndexedDB) pueden tener restricciones en `file://` según el navegador.

### Opción 2 — Servidor local (recomendado)

Con Python (viene instalado en macOS/Linux, disponible en Windows):
```bash
python -m http.server 8080
```
Luego abrí `http://localhost:8080` en el navegador.

Con Node.js:
```bash
npx serve .
```

### Configuración del backend

La app se conecta a Google Apps Script para leer y guardar datos. En la primera apertura:

1. Andá a la pestaña **Config** dentro de la app
2. Pegá la URL de tu despliegue de Google Apps Script
3. La app sincroniza automáticamente

Si no hay URL configurada, la app funciona con los datos cacheados en localStorage (modo offline).

---

## Arquitectura

| Capa | Tecnología |
|---|---|
| Frontend | HTML + CSS + JavaScript vanilla (sin frameworks) |
| Backend | Google Apps Script desplegado como Web App |
| Base de datos | Google Sheets |
| Caché local | `localStorage` (datos) + `IndexedDB` (fotos) |

El archivo `IglesiaSion_v14.gs` es el backend. Para redeployarlo: abrí el Google Sheets → Extensiones → Apps Script → reemplazá el código → Implementar → Nueva implementación → Web App.

---

## Secciones de la app

| Sección | Descripción |
|---|---|
| **Nueva Reunión** | Registrar asistencia de la reunión de hoy |
| **Miembros** | Ver, agregar y editar la base de datos de personas |
| **Historial** | Ver reuniones pasadas y estadísticas de asistencia |
| **Cumpleaños** | Cumpleaños del mes, envío de saludos por WhatsApp |
| **Sondeo** | Generar y publicar reportes de actividad |
| **Config** | Sedes, grupos, tipos, URL del backend |

---

## Funciones principales

### Sincronización y API

| Función | Descripción |
|---|---|
| `syncAll()` | Carga todos los datos desde Sheets en paralelo (8 GET simultáneos). Se llama al iniciar y al sincronizar manualmente. |
| `api(params)` | GET al backend GAS |
| `apiPost(body)` | POST al backend. **No usar `Content-Type: application/json`** — activaría un preflight CORS que GAS rechaza. |

### Renderizado

| Función | Descripción |
|---|---|
| `renderAll()` | Re-renderiza todas las secciones visibles |
| `renderAsist()` | Renderiza la lista de asistencia |
| `renderMiembros()` | Renderiza la sección de miembros |
| `renderHistorial()` | Renderiza el historial de reuniones |
| `toast(msg, tipo, ms)` | Notificación temporal en pantalla |
| `openModal(id)` / `closeModal(id)` | Sistema de modales |

### Miembros

| Función | Descripción |
|---|---|
| `openMemberModal(id)` | Abre el formulario de edición/creación de miembro |
| `saveMember()` | Guarda un miembro en memoria, localStorage y Sheets |
| `activeSedeMembers()` | Devuelve los miembros activos de la sede actual |
| `avHTML(m, size, id)` | Genera el HTML de un avatar (usa thumbnail para listas, foto completa en lightbox) |

### Fotos

| Función | Descripción |
|---|---|
| `compressImage(img, bytes)` | Redimensiona a máx. 400px e itera niveles de calidad para alcanzar el tamaño objetivo. Elimina EXIF vía canvas. |
| `compressToThumb(img)` | Genera thumbnail cuadrado 80×80px (~10KB). Siempre elimina EXIF. |
| `initPhotosProgressive()` | Carga al inicio en etapas: thumbnails de miembros activos → render → resto → render → fotos completas en background |
| `migratePhotos()` | Migración única: elimina EXIF de fotos antiguas y genera thumbnails faltantes |
| `openLightbox(url, nombre)` | Muestra la foto completa en pantalla completa |

### Asistencia

| Función | Descripción |
|---|---|
| `toggleAsist(id)` | Marca/desmarca presente a un miembro |
| `sincronizarAsistencia()` | Guarda la sesión de asistencia en Sheets |
| `cargarUltimaReunion()` | Carga la última reunión guardada |
| `renderAusentesEstaSemana()` | Muestra quiénes no vinieron en reuniones recientes |
| `getOrdenedMembers()` | Devuelve miembros en el orden personalizado por drag-and-drop |

### Cumpleaños y WhatsApp

| Función | Descripción |
|---|---|
| `getMiembrosConCumplesMes()` | Miembros con cumpleaños en el mes seleccionado |
| `getMensaje(key, nombre)` | Resuelve una plantilla de mensaje sustituyendo `{nombre}` |
| `waBday(cel, nombre, edad)` | Abre WhatsApp con mensaje de cumpleaños |
| `openWA(cel, nombre)` | Abre WhatsApp con mensaje de seguimiento |

---

## Modelo de datos

### Persona (miembro)
```
id, nombre, fechaNac, sexo, estadoCivil, conyugeId
celular, email, direccion
sedeId, grupoId, rol, ingreso, activo
bautizado, bautismo_fecha, bautismo_estado
ministerio
vaAlSeminario, seminario_estado, seminario_nombre, seminario_fecha_inicio, seminario_fecha_fin
comoLlego, notas, photo
```

### Reunión
```
id, fecha, tipo, sedeId, presentes (array de IDs)
```

---

## Agregar un campo nuevo a Personas

1. Agregar la columna a `HEADERS.PERSONAS` en `IglesiaSion_v14.gs`
2. Agregar el input al HTML dentro de `openMemberModal()` en `index.html`
3. Agregar el campo al objeto `data` en `saveMember()` en `index.html`
4. Redesplegar el Google Apps Script

---

## Variables de estado global

```javascript
members       // array de personas (en memoria)
sessions      // array de reuniones
sedes, grupos, tipos, tiposReunion  // catálogos
curAttend     // { [id]: true/false } — asistencia de la reunión actual
asistOrden    // [id, id, ...] — orden personalizado en la lista
curSede       // ID o nombre de la sede activa
SCRIPT_URL    // URL del backend GAS (puede cambiarse desde Config)
```
