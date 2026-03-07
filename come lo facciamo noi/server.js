// ============================================
// CONFIGURAZIONE E IMPORTAZIONI
// ============================================
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const app  = express();
const PORT = 3000;
const DB_PATH     = path.join(__dirname, 'data', 'db.json');
const PUBLIC_PATH = path.join(__dirname, 'public');

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.static(PUBLIC_PATH));
app.use(express.json());
// Logger: registra tutte le richieste con timestamp
app.use((req, res, next) => { console.log(new Date().toISOString(), req.method, req.url); next(); });

// ============================================
// FUNZIONI UTILITY E HELPER
// ============================================

/**
 * Legge il database dal file JSON
 * @returns {object} Contenuto del database
 */
function readDB()      { return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')); }

/**
 * Salva il database nel file JSON
 * @param {object} d - Dati da salvare
 */
function writeDB(d)    { fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2)); }

/**
 * Genera un ID univoco casuale (hex)
 * @returns {string} ID generato
 */
function genId()       { return crypto.randomBytes(8).toString('hex'); }

/**
 * Rimuove la password dall'oggetto utente per la risposta
 * @param {object} u - Oggetto utente
 * @returns {object} Utente senza password
 */
function safeUser(u)   { const { password, ...s } = u; return s; }

// ============================================
// MIDDLEWARE DI AUTENTICAZIONE
// ============================================

/**
 * Middleware che verifica se l'utente è autenticato
 * Legge l'ID utente dall'header X-User-Id
 */
function requireAuth(req, res, next) {
  const user = readDB().users.find(u => u.id === req.headers['x-user-id']);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  req.currentUser = user;
  next();
}

// ============================================
// ROTTE AUTENTICAZIONE
// ============================================

/**
 * POST /api/auth/register
 * Crea un nuovo account utente
 */
app.post('/api/auth/register', (req, res) => {
  const { username, password, avatar, bio } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Campi obbligatori mancanti' });
  const db = readDB();
  if (db.users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Username già in uso' });
  const user = { id: genId(), username: username.trim(), password, avatar: avatar || '🎧', bio: bio || '', createdAt: new Date().toISOString() };
  db.users.push(user);
  writeDB(db);
  res.status(201).json({ message: 'Registrazione avvenuta', user: safeUser(user) });
});

/**
 * POST /api/auth/login
 * Autentica un utente con username e password
 */
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Credenziali mancanti' });
  const user = readDB().users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Username o password errati' });
  res.json({ message: 'Login ok', user: safeUser(user) });
});

// ============================================
// ROTTE PLAYLIST - GET
// ============================================

/**
 * GET /api/playlists
 * Restituisce tutte le playlist con i dati dell'autore
 */
app.get('/api/playlists', (req, res) => {
  const db = readDB();
  res.json(db.playlists.map(pl => ({ ...pl, author: safeUser(db.users.find(u => u.id === pl.userId) || {}) })));
});

/**
 * GET /api/playlists/:id
 * Restituisce una playlist specifica con i dati dell'autore
 */
app.get('/api/playlists/:id', (req, res) => {
  const db = readDB();
  const pl = db.playlists.find(p => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'Playlist non trovata' });
  res.json({ ...pl, author: safeUser(db.users.find(u => u.id === pl.userId) || {}) });
});

// ============================================
// ROTTE PLAYLIST - CREATE, UPDATE, DELETE
// ============================================

/**
 * POST /api/playlists
 * Crea una nuova playlist (utente autenticato)
 */
app.post('/api/playlists', requireAuth, (req, res) => {
  const { name, subtitle, cover } = req.body;
  if (!name) return res.status(400).json({ error: 'Il nome è obbligatorio' });
  const db = readDB();
  const pl = { id: genId(), userId: req.currentUser.id, name: name.trim(), subtitle: subtitle?.trim() || '', cover: cover || '🎵', songs: [], createdAt: new Date().toISOString() };
  db.playlists.push(pl);
  writeDB(db);
  res.status(201).json(pl);
});

/**
 * PUT /api/playlists/:id
 * Modifica una playlist (solo il proprietario)
 */
app.put('/api/playlists/:id', requireAuth, (req, res) => {
  const db = readDB();
  const i  = db.playlists.findIndex(p => p.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Playlist non trovata' });
  if (db.playlists[i].userId !== req.currentUser.id) return res.status(403).json({ error: 'Non autorizzato' });
  db.playlists[i] = { ...db.playlists[i], ...req.body };
  writeDB(db);
  res.json(db.playlists[i]);
});

/**
 * DELETE /api/playlists/:id
 * Elimina una playlist (solo il proprietario)
 */
app.delete('/api/playlists/:id', requireAuth, (req, res) => {
  const db = readDB();
  const i  = db.playlists.findIndex(p => p.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Playlist non trovata' });
  if (db.playlists[i].userId !== req.currentUser.id) return res.status(403).json({ error: 'Non autorizzato' });
  db.playlists.splice(i, 1);
  writeDB(db);
  res.json({ message: 'Playlist eliminata' });
});

// ============================================
// ROTTE CANZONI (SONGS)
// ============================================

/**
 * POST /api/playlists/:id/songs
 * Aggiunge una canzone a una playlist (solo il proprietario)
 */
app.post('/api/playlists/:id/songs', requireAuth, (req, res) => {
  const { title, artist, duration } = req.body;
  if (!title || !artist) return res.status(400).json({ error: 'Titolo e artista sono obbligatori' });
  const db = readDB();
  const i  = db.playlists.findIndex(p => p.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Playlist non trovata' });
  if (db.playlists[i].userId !== req.currentUser.id) return res.status(403).json({ error: 'Non autorizzato' });
  const song = { id: genId(), title: title.trim(), artist: artist.trim(), duration: duration?.trim() || '0:00' };
  db.playlists[i].songs.push(song);
  writeDB(db);
  res.status(201).json(song);
});

/**
 * DELETE /api/playlists/:id/songs/:songId
 * Rimuove una canzone da una playlist (solo il proprietario)
 */
app.delete('/api/playlists/:id/songs/:songId', requireAuth, (req, res) => {
  const db = readDB();
  const i  = db.playlists.findIndex(p => p.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Playlist non trovata' });
  if (db.playlists[i].userId !== req.currentUser.id) return res.status(403).json({ error: 'Non autorizzato' });
  const before = db.playlists[i].songs.length;
  db.playlists[i].songs = db.playlists[i].songs.filter(s => s.id !== req.params.songId);
  if (db.playlists[i].songs.length === before) return res.status(404).json({ error: 'Canzone non trovata' });
  writeDB(db);
  res.json({ message: 'Canzone rimossa' });
});

// ============================================
// ERROR HANDLING E FALLBACK
// ============================================

// Endpoint non trovato (404)
app.use('/api/*path', (req, res) => res.status(404).json({ error: 'Endpoint non trovato' }));

// Gestore errori generale
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Errore interno' }); });

// ============================================
// AVVIO SERVER
// ============================================
app.listen(PORT, () => console.log(`🎵 TuneNest → http://localhost:${PORT}`));