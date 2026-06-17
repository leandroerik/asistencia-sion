// ════════════════════════════════════════════════════════════════════
//  IGLESIA SION — Google Apps Script Backend  v13
//  Spreadsheet: https://docs.google.com/spreadsheets/d/1_mXRRl4xARdYM5xfrMlJPraMUQc2a4yFEYG-a2u_zFE
//
//  CAMBIOS v13 (sobre v12):
//  - Nuevo campo en Persona: vaAlSeminario ('Sí'/'No')
//  - Columnas seminario aplanadas en Sheets: seminario_estado,
//    seminario_nombre, seminario_fecha_inicio, seminario_fecha_fin
//  - flattenPersona: persiste el objeto seminario del frontend como
//    columnas planas en lugar de descartarlo.
//  - doGet/getMembers: reconstruye el objeto seminario desde columnas planas.
//  - migrarPersonasConSeminario(): rellena vaAlSeminario y columnas de
//    seminario en filas existentes (correr UNA VEZ tras el deploy).
//
//  CAMBIOS v12 (sobre v11):
//  - clearAsistencia: nueva acción POST que borra todos los datos de la
//    hoja Asistencia (deja solo el header). Útil para empezar de cero.
//  - updateAsistenciaBatch: aplica checkboxes reales automáticamente
//    después de escribir los datos, sin necesidad de correr una función
//    manual desde el editor.

const SS_ID = '1_mXRRl4xARdYM5xfrMlJPraMUQc2a4yFEYG-a2u_zFE';

const SH = {
  PERSONAS:   'Personas',
  SESSIONS:   'Reuniones',
  SEDES:      'Sedes',
  GRUPOS:     'Grupos',
  TIPOS:      'Tipos',
  ASISTENCIA: 'Asistencia',
  SONDEO:     'Actividad',
};

// ── Esquema canónico de Persona ───────────────────────────────────────
// Este orden define las columnas en la hoja de Sheets
const HEADERS = {
  PERSONAS: [
    // Identidad
    'id', 'nombre', 'fechaNac', 'sexo', 'estadoCivil', 'rolFamiliar',
    // Contacto
    'celular', 'email', 'direccion',
    // Vínculo eclesiástico
    'sedeId', 'grupoId', 'rol', 'ingreso', 'activo',
    // Estado espiritual
    'bautizado', 'bautismo_fecha', 'bautismo_estado',
    // Ministerio
    'ministerio',
    // Seminario
    'vaAlSeminario', 'seminario_estado',
    // Seguimiento
    'comoLlego', 'notas',
    // Interno (no editable directamente)
    'photo',
  ],
  SESSIONS:   ['id','fecha','tipo','sedeId','presentes'],
  SEDES:      ['id','nombre','color','desc'],
  GRUPOS:     ['id','sedeId','nombre','desc'],
  TIPOS:      ['id','nombre','color'],
  ASISTENCIA: ['nombre','presente'],
  SONDEO:     ['nombre','sede','grupo','rol','estado','faltas','pct','presencias','totalReun','ultimaVez','celular','email'],
};

// ── Helpers generales ─────────────────────────────────────────────────

function jsonOk(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, ...data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonErr(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.openById(SS_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1A5FB4')
      .setFontColor('#FFFFFF');
    sh.setColumnWidth(1, 240);
    if (headers.length > 1) sh.setColumnWidth(2, 120);
  }
  return sh;
}

function sheetToObjects(sheetName, headers) {
  const sh   = getOrCreateSheet(sheetName, headers);
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];
  const keys = data[0];
  return data.slice(1)
    .filter(row => row[0] !== '')
    .map(row => {
      const obj = {};
      keys.forEach((k, i) => { obj[k] = row[i] === undefined ? '' : row[i]; });
      return obj;
    });
}

function objToRow(obj, headers) {
  return headers.map(h => {
    const v = obj[h];
    if (v === null || v === undefined) return '';
    if (typeof v === 'object')        return JSON.stringify(v);
    return v;
  });
}

function upsert(sheetName, headers, obj) {
  if (!obj.id) return;
  const sh    = getOrCreateSheet(sheetName, headers);
  const idStr = String(obj.id);
  const data  = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === idStr) {
      sh.getRange(i + 1, 1, 1, headers.length).setValues([objToRow(obj, headers)]);
      return;
    }
  }
  sh.appendRow(objToRow(obj, headers));
}

function upsertBatch(sheetName, headers, objs) {
  if (!objs || !objs.length) return 0;
  const sh   = getOrCreateSheet(sheetName, headers);
  const data = sh.getDataRange().getValues();
  const idx  = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] !== '') idx[String(data[i][0])] = i + 1;
  }
  const toAppend = [];
  objs.forEach(obj => {
    if (!obj.id) return;
    const row    = objToRow(obj, headers);
    const rowNum = idx[String(obj.id)];
    if (rowNum) { sh.getRange(rowNum, 1, 1, headers.length).setValues([row]); }
    else        { toAppend.push(row); }
  });
  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, headers.length).setValues(toAppend);
  }
  return objs.length;
}

function deleteById(sheetName, id) {
  const ss = SpreadsheetApp.openById(SS_ID);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return;
  const data = sh.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(id)) { sh.deleteRow(i + 1); return; }
  }
}

function replaceSheet(sheetName, headers, rows) {
  const sh = getOrCreateSheet(sheetName, headers);
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, headers.length)
      .setValues(rows.map(r => objToRow(r, headers)));
  }
}

// Normaliza un objeto persona al esquema canónico antes de guardarlo
function flattenPersona(raw) {
  const f = { ...raw };
  delete f.action;

  // Compatibilidad: tipoAsistente → rol (el frontend sigue enviando tipoAsistente)
  if (f.tipoAsistente && !f.rol) { f.rol = f.tipoAsistente; }
  // Eliminar campos legacy que ya no van a Sheets
  delete f.tipoAsistente;
  delete f.congregacion;
  delete f.grupo;
  delete f.ultReunion;
  delete f.seminario1; delete f.seminario1_fecha; delete f.seminario1_estado;
  delete f.seminario2; delete f.seminario2_fecha; delete f.seminario2_estado;
  // _isDup es interno del frontend
  delete f._isDup;

  // seminario: objeto del frontend → columnas planas en Sheets
  if (f.seminario && typeof f.seminario === 'object') {
    const sem = f.seminario;
    // vaAlSeminario: 'Sí' si hay estado registrado, o si ya venía explícito
    if (f.vaAlSeminario === undefined) {
      f.vaAlSeminario = (sem.estado && sem.estado !== '') ? 'Sí' : 'No';
    }
    f.seminario_estado = sem.estado || '';
    delete f.seminario;
  }

  // vaAlSeminario: normalizar a 'Sí'/'No'
  if (f.vaAlSeminario !== undefined) {
    f.vaAlSeminario = (f.vaAlSeminario === true || f.vaAlSeminario === 'true' || f.vaAlSeminario === 'Sí') ? 'Sí' : 'No';
  }

  // bautismo como objeto → columnas planas
  if (f.bautismo && typeof f.bautismo === 'object') {
    f.bautizado       = f.bautismo.estado === 'Realizado' ? 'Sí' : (f.bautismo.estado || '');
    f.bautismo_fecha  = f.bautismo.fecha  || '';
    f.bautismo_estado = f.bautismo.estado || '';
    delete f.bautismo;
  }

  // activo: boolean → 'Sí'/'No' para legibilidad en Sheets
  if (f.activo !== undefined) {
    f.activo = (f.activo === true || f.activo === 'true') ? 'Sí' : 'No';
  }

  // celular siempre string
  if (f.celular !== undefined) f.celular = String(f.celular || '');

  // v22: photo se guarda tal cual (base64 o URL). No se filtra.
  // El frontend ya comprime la imagen a ~150KB antes de enviar.

  return f;
}

// Alias para retrocompatibilidad
const flattenMember = flattenPersona;

// ── Helper hoja Asistencia ────────────────────────────────────────────
function getAsistenciaSheet() {
  const ss = SpreadsheetApp.openById(SS_ID);
  const sh = ss.getSheetByName(SH.ASISTENCIA);
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  if (!data.length) return null;
  const hdrs       = data[0].map(h => String(h).toLowerCase().trim());
  const colNombre  = hdrs.findIndex(h => ['nombre','nombres','name'].includes(h));
  const colPresente = hdrs.findIndex(h => ['presente','presentes','asistencia','attendance'].includes(h));
  return {
    sh,
    data,
    colNombre:  colNombre  === -1 ? 0 : colNombre,
    colPresente: colPresente === -1 ? 1 : colPresente,
  };
}

// ── GET ──────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    const action = (e.parameter || {}).action;

    if (action === 'getMembers' || action === 'getPersonas') {
      const rows = sheetToObjects(SH.PERSONAS, HEADERS.PERSONAS);
      const members = rows.map(m => {
        // Reconstruir objeto bautismo desde columnas planas
        if (m['bautismo_fecha'] || m['bautismo_estado']) {
          m.bautismo = { fecha: m['bautismo_fecha'] || '', estado: m['bautismo_estado'] || '' };
        }
        // activo: 'Sí'/'No' → boolean
        m.activo = m.activo === 'Sí' || m.activo === true || m.activo === 'true';
        // celular siempre string
        m.celular = String(m.celular || '');
        // vaAlSeminario: 'Sí'/'No' → boolean
        m.vaAlSeminario = m.vaAlSeminario === 'Sí' || m.vaAlSeminario === true;
        // Reconstruir objeto seminario desde columna plana
        if (m['seminario_estado']) {
          m.seminario = { estado: m['seminario_estado'] };
        }
        return m;
      });
      return jsonOk({ members });
    }

    if (action === 'getSessions') {
      const rows     = sheetToObjects(SH.SESSIONS, HEADERS.SESSIONS);
      const sessions = rows.map(s => {
        if (typeof s.presentes === 'string' && s.presentes.startsWith('[')) {
          try { s.presentes = JSON.parse(s.presentes); } catch(e) { s.presentes = []; }
        } else if (!Array.isArray(s.presentes)) { s.presentes = []; }
        return s;
      });
      return jsonOk({ sessions });
    }

    if (action === 'getSedes')  return jsonOk({ sedes:  sheetToObjects(SH.SEDES,  HEADERS.SEDES)  });
    if (action === 'getGrupos') return jsonOk({ grupos: sheetToObjects(SH.GRUPOS, HEADERS.GRUPOS) });
    if (action === 'getTipos')  return jsonOk({ tipos:  sheetToObjects(SH.TIPOS,  HEADERS.TIPOS)  });
    if (action === 'getTiposReunion') {
      const sh = SpreadsheetApp.openById(SS_ID).getSheetByName('TiposReunion');
      if (!sh || sh.getLastRow() < 2) return jsonOk({ tiposReunion: [] });
      const rows = sheetToObjects('TiposReunion', ['id','label','icon','diaSemana']);
      return jsonOk({ tiposReunion: rows });
    }

    if (action === 'getMensajes') {
      const ss = SpreadsheetApp.openById(SS_ID);
      const sh = ss.getSheetByName('Mensajes');
      if (!sh || sh.getLastRow() < 2) return jsonOk({ mensajes: {} });
      const data = sh.getDataRange().getValues();
      const mensajes = {};
      // Esperamos dos columnas: clave | valor
      data.slice(1).forEach(row => {
        if (row[0]) mensajes[String(row[0]).trim()] = String(row[1] || '');
      });
      return jsonOk({ mensajes });
    }

    // ── Orden + estado de asistencia actual ───────────────────────
    if (action === 'getOrden') {
      const r = getAsistenciaSheet();
      if (!r || r.data.length <= 1) return jsonOk({ orden: [] });
      const { data, colNombre, colPresente } = r;
      const orden = data.slice(1)
        .filter(row => String(row[colNombre] || '').trim() !== '')
        .map(row => ({
          nombre:   String(row[colNombre] || '').trim(),
          presente: row[colPresente] === true
                    || String(row[colPresente]).toUpperCase() === 'TRUE',
        }));
      return jsonOk({ orden });
    }

    return jsonErr('Accion no reconocida: ' + action);

  } catch(err) {
    return jsonErr('Error GET: ' + err.message + ' | ' + err.stack);
  }
}

// ── POST ─────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'saveMember' || action === 'savePersona') {
      upsert(SH.PERSONAS, HEADERS.PERSONAS, flattenPersona(body));
      return jsonOk({ saved: body.id });
    }

    if (action === 'saveMembersBatch' || action === 'savePersonasBatch') {
      const lista = (body.members || body.personas || []).map(flattenPersona);
      return jsonOk({ saved: upsertBatch(SH.PERSONAS, HEADERS.PERSONAS, lista), count: lista.length });
    }

    if (action === 'deleteMember' || action === 'deletePersona') {
      deleteById(SH.PERSONAS, body.id);
      return jsonOk({ deleted: body.id });
    }

    if (action === 'saveSession') {
      const s = { ...body }; delete s.action;
      if (Array.isArray(s.presentes)) s.presentes = JSON.stringify(s.presentes);
      upsert(SH.SESSIONS, HEADERS.SESSIONS, s);
      return jsonOk({ saved: s.id });
    }

    if (action === 'deleteSession') {
      deleteById(SH.SESSIONS, body.id);
      return jsonOk({ deleted: body.id });
    }

    if (action === 'saveSede')  { replaceSheet(SH.SEDES,  HEADERS.SEDES,  body.sedes  || []); return jsonOk({ saved: (body.sedes  ||[]).length }); }
    if (action === 'saveGrupo') { replaceSheet(SH.GRUPOS, HEADERS.GRUPOS, body.grupos || []); return jsonOk({ saved: (body.grupos ||[]).length }); }
    if (action === 'saveTipos') { replaceSheet(SH.TIPOS,  HEADERS.TIPOS,  body.tipos  || []); return jsonOk({ saved: (body.tipos  ||[]).length }); }

    if (action === 'saveTiposReunion') {
      const HDR = ['id','label','icon','diaSemana'];
      replaceSheet('TiposReunion', HDR, body.tiposReunion || []);
      return jsonOk({ saved: (body.tiposReunion || []).length });
    }

    if (action === 'saveMensajes') {
      const ss = SpreadsheetApp.openById(SS_ID);
      let sh = ss.getSheetByName('Mensajes');
      if (!sh) {
        sh = ss.insertSheet('Mensajes');
        sh.appendRow(['clave', 'valor']);
        sh.setFrozenRows(1);
        sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#1A5FB4').setFontColor('#FFFFFF');
      } else {
        if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
      }
      const mensajes = body.mensajes || {};
      const filas = Object.entries(mensajes).map(([k, v]) => [k, v]);
      if (filas.length) sh.getRange(sh.getLastRow() + 1, 1, filas.length, 2).setValues(filas);
      return jsonOk({ saved: filas.length });
    }

    // ── Actividad: snapshot completo con formato visual ──────────
    if (action === 'saveSondeo') {
      const ss      = SpreadsheetApp.openById(SS_ID);
      const filas   = body.filas   || [];
      const resumen = body.resumen || {};
      const E = ''; // celda vacía — todas las filas DEBEN tener 12 columnas

      let sh = ss.getSheetByName(SH.SONDEO);
      if (!sh) {
        sh = ss.insertSheet(SH.SONDEO);
      } else {
        sh.clearContents();
        sh.clearFormats();
      }

      const fechaLeg = resumen.fecha
        ? Utilities.formatDate(new Date(resumen.fecha + 'T12:00:00'), 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy')
        : '';

      // Todas las filas deben tener exactamente 12 columnas
      const titulo = 'ACTIVIDAD — ' + (resumen.sede || '') + ' — ' + fechaLeg;
      const bloqueResumen = [
        // fila 1: título (se mergea después)
        [titulo,          E,              E,           E,              E,           E,           E,E,E,E,E,E],
        // fila 2: metadata
        ['Sede',          resumen.sede||'','Fecha',    fechaLeg,       'Ventana',   String(resumen.ventana||'')+' reuniones', E,E,E,E,E,E],
        // fila 3: vacía
        [E,E,E,E,E,E,E,E,E,E,E,E],
        // fila 4: conteos
        ['✅ Regulares',  resumen.regulares||0, '⚠️ 1 falta', resumen.alerta||0, '🔴 2 faltas', resumen.riesgo||0, '💀 3+', resumen.critico||0, 'Total', resumen.total||0, E, E],
        // fila 5: vacía
        [E,E,E,E,E,E,E,E,E,E,E,E],
        // fila 6: vacía
        [E,E,E,E,E,E,E,E,E,E,E,E],
        // fila 7: cabecera de tabla
        ['Nombre','Sede','Grupo','Tipo asistente','Estado','Faltas consec.','% Asistencia','Presencias','Total reun.','Última vez','Celular','Email'],
      ];

      sh.getRange(1, 1, bloqueResumen.length, 12).setValues(bloqueResumen);

      // Estilo título (fila 1 mergeada)
      sh.getRange(1, 1, 1, 12).merge()
        .setFontSize(14).setFontWeight('bold')
        .setBackground('#1A5FB4').setFontColor('#FFFFFF')
        .setHorizontalAlignment('center');

      // Estilo metadata (fila 2)
      sh.getRange(2, 1, 1, 12).setBackground('#F0F2F5').setFontColor('#444444').setFontSize(10);

      // Estilo conteos (fila 4)
      sh.getRange(4, 1, 1, 12).setBackground('#EBF2FC').setFontWeight('bold');

      // Estilo cabecera de tabla (fila 7)
      sh.getRange(7, 1, 1, 12).setFontWeight('bold').setBackground('#2C3E50').setFontColor('#FFFFFF');

      sh.setFrozenRows(7);

      // ── Filas de datos desde fila 8 ──────────────────────────────
      if (filas.length) {
        const COLOR = {
          regular:    { bg: '#EAF7F0', txt: '#1E6B47' },
          alerta:     { bg: '#FEF9E7', txt: '#7C5C00' },
          riesgo:     { bg: '#FEF3E7', txt: '#A0510E' },
          critico:    { bg: '#FBEAEA', txt: '#8B1C1C' },
          'sin-datos':{ bg: '#F5F5F5', txt: '#666666' },
        };
        const ESTADO_LABEL = {
          regular:'✅ Regular', alerta:'⚠️ 1 falta',
          riesgo:'🔴 2 faltas', critico:'💀 3+ faltas', 'sin-datos':'⬜ Sin datos',
        };

        const dataRows = filas.map(f => [
          f.nombre      || '',
          f.sede        || '',
          f.grupo       || '',
          f.tipoAsistente || f.rol || '',  // el frontend envía tipoAsistente
          ESTADO_LABEL[f.estadoCod] || f.estado || '',
          f.faltas      !== '' && f.faltas      !== undefined ? f.faltas      : '',
          f.pct         !== '' && f.pct         !== undefined ? (f.pct + '%') : '—',
          f.presencias  !== '' && f.presencias  !== undefined ? f.presencias  : '',
          f.totalReun   !== '' && f.totalReun   !== undefined ? f.totalReun   : '',
          f.ultimaVez   || 'Nunca',
          f.celular     || '',
          f.email       || '',
        ]);

        const startRow = 8;
        sh.getRange(startRow, 1, dataRows.length, 12).setValues(dataRows);

        filas.forEach((f, i) => {
          const c = COLOR[f.estadoCod] || COLOR['sin-datos'];
          sh.getRange(startRow + i, 1, 1, 12).setBackground(c.bg);
          sh.getRange(startRow + i, 5).setFontWeight('bold').setFontColor(c.txt);
        });

        sh.getRange(7, 1, dataRows.length + 1, 12)
          .setBorder(true, true, true, true, true, true, '#CCCCCC', SpreadsheetApp.BorderStyle.SOLID);
      }

      [240, 100, 100, 100, 110, 70, 80, 80, 80, 100, 130, 180]
        .forEach((w, i) => sh.setColumnWidth(i + 1, w));

      return jsonOk({ saved: filas.length, sheet: SH.SONDEO });
    }

    if (action === 'uploadPhoto') {
      try {
        const b64data = body.base64;
        if (!b64data || !b64data.includes(',')) return jsonErr('base64 inválido o vacío');
        const rawB64  = b64data.split(',').pop();
        const mime    = body.mimeType || 'image/jpeg';
        const fname   = body.filename || ('foto_' + Date.now() + '.jpg');
        const decoded = Utilities.base64Decode(rawB64);
        const blob    = Utilities.newBlob(decoded, mime, fname);

        let folder;
        try {
          folder = DriveApp.getFileById(SS_ID).getParents().next();
        } catch(fe) {
          folder = DriveApp.getRootFolder(); // fallback: carpeta raíz
        }

        const file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        return jsonOk({ url: 'https://drive.google.com/uc?id=' + file.getId() });
      } catch(photoErr) {
        return jsonErr('Error subiendo foto: ' + photoErr.message);
      }
    }

    // ── Tilde individual: app → Sheets en tiempo real ─────────────
    if (action === 'updateAsistencia') {
      const r = getAsistenciaSheet();
      if (!r) return jsonErr('Hoja Asistencia no encontrada. Corra setup primero.');
      const { sh, data, colNombre, colPresente } = r;
      const key = String(body.nombre || '').toLowerCase().trim();
      const val = body.presente === true || body.presente === 'true';

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][colNombre] || '').toLowerCase().trim() === key) {
          sh.getRange(i + 1, colPresente + 1).setValue(val);
          return jsonOk({ updated: body.nombre, presente: val });
        }
      }
      // No existe en la hoja → agregar al final
      const newRow = ['', ''];
      newRow[colNombre]  = body.nombre;
      newRow[colPresente] = val;
      sh.appendRow(newRow);
      return jsonOk({ added: body.nombre, presente: val });
    }

    // ── Limpiar hoja Asistencia (borrar todos los datos, dejar header) ──
    if (action === 'clearAsistencia') {
      const ss = SpreadsheetApp.openById(SS_ID);
      const sh = ss.getSheetByName(SH.ASISTENCIA);
      if (!sh) return jsonErr('Hoja Asistencia no encontrada. Corra setup primero.');
      if (sh.getLastRow() > 1) {
        sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
      }
      return jsonOk({ cleared: true });
    }

    // ── Snapshot completo al guardar la reunión ───────────────────
    if (action === 'updateAsistenciaBatch') {
      const r = getAsistenciaSheet();
      if (!r) return jsonErr('Hoja Asistencia no encontrada. Corra setup primero.');
      const { sh, data, colNombre, colPresente } = r;

      const filaMap = {};
      for (let i = 1; i < data.length; i++) {
        const k = String(data[i][colNombre] || '').toLowerCase().trim();
        if (k) filaMap[k] = i + 1;
      }

      const lista    = body.asistencias || [];
      const toAppend = [];

      lista.forEach(item => {
        const k    = String(item.nombre || '').toLowerCase().trim();
        const val  = item.presente === true || item.presente === 'true';
        const fila = filaMap[k];
        if (fila) {
          sh.getRange(fila, colPresente + 1).setValue(val);
        } else {
          const newRow = ['', ''];
          newRow[colNombre]  = item.nombre;
          newRow[colPresente] = val;
          toAppend.push(newRow);
        }
      });

      if (toAppend.length) {
        sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, 2).setValues(toAppend);
      }

      // Aplicar checkboxes reales automáticamente (no requiere correr función manual)
      aplicarCheckboxes();

      return jsonOk({ updated: lista.length });
    }

    return jsonErr('Accion POST no reconocida: ' + action);

  } catch(err) {
    return jsonErr('Error POST: ' + err.message + ' | ' + err.stack);
  }
}

// ── Aplica checkboxes reales a la columna "presente" de Asistencia ──
function aplicarCheckboxes() {
  const ss = SpreadsheetApp.openById(SS_ID);
  const sh = ss.getSheetByName(SH.ASISTENCIA);
  if (!sh || sh.getLastRow() < 2) return;

  const r = getAsistenciaSheet();
  if (!r) return;
  const colPresente = r.colPresente + 1; // 1-based
  const lastRow     = sh.getLastRow();

  const rango = sh.getRange(2, colPresente, lastRow - 1, 1);

  // Convertir TRUE/FALSE string → boolean antes de aplicar checkbox
  const vals = rango.getValues().map(row => {
    const v = row[0];
    if (v === true  || String(v).toUpperCase() === 'TRUE')  return [true];
    if (v === false || String(v).toUpperCase() === 'FALSE') return [false];
    return [false];
  });
  rango.setValues(vals);

  // Validación de checkbox
  const rule = SpreadsheetApp.newDataValidation()
    .requireCheckbox()
    .setAllowInvalid(false)
    .build();
  rango.setDataValidation(rule);
  rango.setHorizontalAlignment('center');

  Logger.log('Checkboxes aplicados a ' + (lastRow - 1) + ' filas');
}

// Función manual — corré desde el editor si ya tenés filas en Asistencia
function convertirACheckboxes() {
  aplicarCheckboxes();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Checkboxes aplicados correctamente', '✅ Listo', 4
  );
}

// ── SETUP — corré esto una sola vez ─────────────────────────────────

function setup() {
  // Hojas principales con sus headers definidos en HEADERS{}
  const sheetMap = [
    { name: SH.PERSONAS,   headers: HEADERS.PERSONAS   },
    { name: SH.SESSIONS,   headers: HEADERS.SESSIONS   },
    { name: SH.SEDES,      headers: HEADERS.SEDES      },
    { name: SH.GRUPOS,     headers: HEADERS.GRUPOS     },
    { name: SH.TIPOS,      headers: HEADERS.TIPOS      },
    { name: SH.ASISTENCIA, headers: HEADERS.ASISTENCIA },
    { name: SH.SONDEO,     headers: HEADERS.SONDEO     },
    // TiposReunion no está en SH{} ni en HEADERS{} — crearla igual
    { name: 'TiposReunion', headers: ['id','label','icon','diaSemana'] },
  ];

  sheetMap.forEach(({ name, headers }) => {
    getOrCreateSheet(name, headers);
    Logger.log('Hoja lista: ' + name);
  });

  aplicarCheckboxes();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Hojas creadas: ' + sheetMap.map(s => s.name).join(', '),
    '✅ Setup completo v10', 5
  );
}

// ── Migración: copia "Miembros" → "Personas" ────────────────────────
// Corré esto UNA VEZ si ya tenías datos en la hoja "Miembros"
function migrarMiembrosAPersonas() {
  const ss      = SpreadsheetApp.openById(SS_ID);
  const shVieja = ss.getSheetByName('Miembros');
  if (!shVieja) { SpreadsheetApp.getUi().alert('No hay hoja "Miembros". Nada que migrar.'); return; }
  const datos = shVieja.getDataRange().getValues();
  if (datos.length <= 1) { SpreadsheetApp.getUi().alert('La hoja "Miembros" está vacía.'); return; }

  const shNueva    = getOrCreateSheet(SH.PERSONAS, HEADERS.PERSONAS);
  const hdrsViejos = datos[0].map(h => String(h).toLowerCase().trim());
  const col        = n => hdrsViejos.indexOf(n);
  const filas      = [];

  datos.slice(1).forEach(row => {
    if (!row[0]) return;
    const p = {
      id:             row[col('id')]              || '',
      nombre:         row[col('nombre')]           || '',
      fechaNac:       row[col('fechanac')]          || '',
      sexo:           row[col('sexo')]              || '',
      estadoCivil:    row[col('estadocivil')]       || '',
      rolFamiliar:    row[col('rolfamiliar')]       || '',
      celular:        String(row[col('celular')]   || ''),
      email:          row[col('email')]             || '',
      direccion:      row[col('direccion')]          || '',
      sedeId:         row[col('sedeid')]             || '',
      grupoId:        row[col('grupoid')]            || '',
      rol:            row[col('tipoasistente')]  || row[col('rol')] || '',
      ingreso:        row[col('ingreso')]            || '',
      activo:         'Sí',
      bautizado:      row[col('bautismo_estado')] === 'Realizado' ? 'Sí' : '',
      bautismo_fecha: row[col('bautismo_fecha')]    || '',
      bautismo_estado:row[col('bautismo_estado')]   || '',
      ministerio:     '',
      comoLlego:      '',
      notas:          row[col('notas')]              || '',
      photo:          row[col('photo')]              || '',
    };
    filas.push(HEADERS.PERSONAS.map(h => p[h] !== undefined ? p[h] : ''));
  });

  if (filas.length) {
    shNueva.getRange(shNueva.getLastRow() + 1, 1, filas.length, HEADERS.PERSONAS.length).setValues(filas);
  }
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `${filas.length} personas migradas "Miembros" → "Personas"`, '✅ Migración completa', 6
  );
}

// ── DATOS INICIALES ──────────────────────────────────────────────────
// Corré esta función una sola vez para poblar Sedes, Grupos,
// Tipos de asistente y Tipos de reunión con la configuración base.
// No toca la hoja Personas ni Reuniones.
function cargarDatosIniciales() {
  const ss = SpreadsheetApp.openById(SS_ID);

  // ── SEDES ────────────────────────────────────────────────────
  const sedesData = [
    { id:'1', nombre:'Capital', color:'#1A5FB4', desc:'' },
    { id:'2', nombre:'Catan',   color:'#1E8A59', desc:'' },
  ];
  replaceSheet(SH.SEDES, HEADERS.SEDES, sedesData);

  // ── GRUPOS ───────────────────────────────────────────────────
  const gruposData = [
    { id:'1', sedeId:'1', nombre:'General',          desc:'' },
    { id:'2', sedeId:'1', nombre:'Seminario Biblico', desc:'Cursando' },
  ];
  replaceSheet(SH.GRUPOS, HEADERS.GRUPOS, gruposData);

  // ── TIPOS DE ASISTENTE (de menor a mayor cargo) ───────────────
  const tiposData = [
    { id:'1', nombre:'Visita',            color:'#BE185D' },
    { id:'2', nombre:'Asistente Regular', color:'#0E7490' },
    { id:'3', nombre:'Miembro',           color:'#1E8A59' },
    { id:'5', nombre:'Líder',             color:'#1A5FB4' },
    { id:'6', nombre:'Diácono',           color:'#C96B10' },
    { id:'7', nombre:'Pastor',            color:'#6E3DAA' },
  ];
  replaceSheet(SH.TIPOS, HEADERS.TIPOS, tiposData);

  // ── TIPOS DE REUNIÓN ─────────────────────────────────────────
  const SH_TIPOS_REUNION = 'TiposReunion';
  const HDR_TIPOS_REUNION = ['id','label','icon','diaSemana'];
  const tiposReunionData = [
    { id:'1', label:'Domingo', icon:'⛪', diaSemana: 0 },
    { id:'2', label:'Jueves',  icon:'📖', diaSemana: 4 },
    { id:'3', label:'Jóvenes', icon:'🔥', diaSemana: 6 },
    { id:'4', label:'Evento',  icon:'🌟', diaSemana: null },
  ];
  replaceSheet(SH_TIPOS_REUNION, HDR_TIPOS_REUNION, tiposReunionData);

  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Sedes: ${sedesData.length} · Grupos: ${gruposData.length} · Tipos asistente: ${tiposData.length} · Tipos reunión: ${tiposReunionData.length}`,
    '✅ Datos iniciales cargados', 6
  );
  Logger.log('Datos iniciales cargados correctamente.');
}

// ── Migración v13: rellena vaAlSeminario y columnas de seminario ────
// Corre esta función UNA SOLA VEZ después de hacer deploy de v13.
// Actualiza todas las filas existentes en la hoja Personas:
//   - vaAlSeminario = 'Sí' si seminario_estado tiene valor, sino 'No'
//   - Deja intactos los campos seminario_* si ya existen.
// Las filas nuevas que vengan del frontend ya traerán todo correcto.
function migrarPersonasConSeminario() {
  const ss = SpreadsheetApp.openById(SS_ID);
  const sh = ss.getSheetByName(SH.PERSONAS);
  if (!sh) {
    SpreadsheetApp.getUi().alert('No se encontró la hoja Personas.');
    return;
  }

  const data = sh.getDataRange().getValues();
  if (data.length <= 1) {
    SpreadsheetApp.getUi().alert('La hoja Personas está vacía.');
    return;
  }

  const hdrs = data[0].map(h => String(h).trim());

  // Índices de las columnas que nos interesan (1-based para getRange)
  const col = name => hdrs.indexOf(name);
  const iVaAlSeminario   = col('vaAlSeminario');
  const iSeminarioEstado = col('seminario_estado');

  if (iVaAlSeminario === -1) {
    SpreadsheetApp.getUi().alert(
      'La columna "vaAlSeminario" no existe.\n' +
      'Asegurate de haber corrido setup() primero para que el header se actualice.'
    );
    return;
  }

  let actualizadas = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // fila vacía, skip

    const yaTieneValor = String(row[iVaAlSeminario] || '').trim() !== '';
    if (yaTieneValor) continue; // ya migrada, no tocar

    const tieneEstadoSeminario = iSeminarioEstado !== -1 &&
      String(row[iSeminarioEstado] || '').trim() !== '';

    const nuevoValor = tieneEstadoSeminario ? 'Sí' : 'No';
    sh.getRange(i + 1, iVaAlSeminario + 1).setValue(nuevoValor);
    actualizadas++;
  }

  SpreadsheetApp.getActiveSpreadsheet().toast(
    actualizadas + ' personas actualizadas con vaAlSeminario.',
    '✅ Migración v13 completa', 6
  );
  Logger.log('migrarPersonasConSeminario: ' + actualizadas + ' filas actualizadas.');
}
