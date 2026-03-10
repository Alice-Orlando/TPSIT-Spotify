const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const app  = express();
const PORT = 3000;
const DB_PATH     = path.join(__dirname, 'data', 'db.json');
const PUBLIC_PATH = path.join(__dirname, 'public');

app.use(express.static(PUBLIC_PATH));
app.use(express.json());
// Logger: registra tutte le richieste con timestamp
app.use((req, res, next) => { console.log(new Date().toISOString(), req.method, req.url); next(); });

/** legge il file db.json e lo trasforma in un oggetto JavaScript usabile. È come "aprire" il tuo archivio dati.*/
function readDB()      { return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')); }

/** prende i dati e li salva nel file db.json. È come "salvare" il file.*/
function writeDB(d)    { fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2)); }

/**genera un codice casuale (es. a3f9c12b...) da usare come ID univoco per ogni utente, playlist o canzone.*/
function genId()       { return crypto.randomBytes(8).toString('hex'); }

/** prima di mandare i dati di un utente al browser, rimuove la password.*/
function safeUser(u)   { const { password, ...s } = u; return s; }


function requireAuth(req, res, next) {

  // Legge l'ID utente che il browser ha mandato nell'header della richiesta
  const userId = req.headers['x-user-id'];

  // Se non c'è nessun ID, l'utente non è loggato → blocca subito
  if (!userId) {
    return res.status(401).json({ error: 'Non autenticato' });
  }

  // Apre il database e cerca un utente con quell'ID
  const db   = readDB();
  const user = db.users.find(function(u) {
    return u.id === userId;
  });

  // Se non esiste nessun utente con quell'ID → blocca
  if (!user) {
    return res.status(401).json({ error: 'Utente non trovato' });
  }
  req.currentUser = user;
  next();
}

app.post('/api/auth/register', function(req, res) {

  // Estrae i dati mandati dal browser nel corpo della richiesta
  const username = req.body.username;
  const avatar   = req.body.avatar;
  const bio      = req.body.bio;

  // Se username è vuoto → blocca con errore 400 ("richiesta sbagliata")
  if (!username) {
    return res.status(400).json({ error: 'Username obbligatorio' });
  }

  // Apre il database
  const db = readDB();

  const utenteEsistente = db.users.find(function(u) {
    return u.username.toLowerCase() === username.toLowerCase();
  });

  // Se l'username è già preso → blocca con errore 409 ("conflitto")
  if (utenteEsistente) {
    return res.status(409).json({ error: 'Username già in uso' });
  }

  // Crea il nuovo oggetto utente
  const nuovoUtente = {
    id:        genId(),
    username:  username.trim(),
    avatar:    avatar || '🎧',
    bio:       bio    || '',
    createdAt: new Date().toISOString()
  };

  // Aggiunge il nuovo utente all'array nel database
  db.users.push(nuovoUtente);

  // Salva il database aggiornato nel file db.json
  writeDB(db);

  res.status(201).json({
    message: 'Registrazione avvenuta',
    user:    safeUser(nuovoUtente)
  });

});

app.post('/api/auth/login', function(req, res) {

  // Estrae username e password mandati dal browser
  const username = req.body.username;

  // Se username è vuoto → blocca con errore 400
  if (!username) {
    return res.status(400).json({ error: 'Username mancante' });
  }

  // Apre il database e cerca un utente con quell'username
  const db   = readDB();
  const user = db.users.find(function(u) {
    return u.username === username;
  });

  if (!user) {
    return res.status(401).json({ error: 'Utente non trovato' });
  }

  res.json({
    message: 'Login ok',
    user:    safeUser(user)
  });

});


// Restituisce tutte le playlist con le info dell'autore
app.get('/api/playlists', function(req, res) {

  // Apre il database
  const db = readDB();

  // Per ogni playlist, cerca l'utente che l'ha creata e lo aggiunge come "author"
  const playlistConAutore = db.playlists.map(function(pl) {

    // Cerca l'utente nel database usando l'id salvato nella playlist
    // Se non lo trova (utente cancellato), usa un oggetto vuoto {}
    const autore = db.users.find(function(u) {
      return u.id === pl.userId;
    }) || {};

    // Restituisce la playlist con il campo "author" aggiunto
    // safeUser() rimuove la password dall'oggetto autore
    return { ...pl, author: safeUser(autore) };
  });

  // Manda al browser la lista completa
  res.json(playlistConAutore);

});


// Restituisce una singola playlist cercata per ID
app.get('/api/playlists/:id', function(req, res) {

  // Apre il database
  const db = readDB();

  // Cerca la playlist con l'ID passato nell'URL (es. /api/playlists/abc123)
  const playlist = db.playlists.find(function(p) {
    return p.id === req.params.id;
  });

  // Se non esiste → errore 404 ("non trovata")
  if (!playlist) {
    return res.status(404).json({ error: 'Playlist non trovata' });
  }

  // Cerca l'autore della playlist nel database
  const autore = db.users.find(function(u) {
    return u.id === playlist.userId;
  }) || {};

  // Risponde con la playlist + i dati dell'autore (senza password)
  res.json({ ...playlist, author: safeUser(autore) });

});

// Crea una nuova playlist (richiede login)
app.post('/api/playlists', requireAuth, function(req, res) {

  // Estrae i dati mandati dal browser
  const name     = req.body.name;
  const subtitle = req.body.subtitle;
  const cover    = req.body.cover;

  // Il nome è obbligatorio → blocca con errore 400 se manca
  if (!name) {
    return res.status(400).json({ error: 'Il nome è obbligatorio' });
  }

  // Apre il database
  const db = readDB();

  // Crea il nuovo oggetto playlist
  const nuovaPlaylist = {
    id:        genId(),                       // ID casuale univoco
    userId:    req.currentUser.id,            // ID dell'utente loggato (messo da requireAuth)
    name:      name.trim(),                   // .trim() rimuove spazi inutili
    subtitle:  subtitle ? subtitle.trim() : '',  // se non c'è sottotitolo, stringa vuota
    cover:     cover || '🎵',                 // se non ha scelto una cover, usa 🎵
    songs:     [],                            // inizia con nessuna canzone
    createdAt: new Date().toISOString()       // data e ora di creazione
  };

  // Aggiunge la playlist al database e salva
  db.playlists.push(nuovaPlaylist);
  writeDB(db);

  // Risponde con successo (201 = "creato") e manda la playlist appena creata
  res.status(201).json(nuovaPlaylist);

});


// Modifica una playlist esistente (richiede login)
app.put('/api/playlists/:id', requireAuth, function(req, res) {

  // Apre il database
  const db = readDB();

  const indice = db.playlists.findIndex(function(p) {
    return p.id === req.params.id;
  });

  // Se non esiste → errore 404 ("non trovata")
  if (indice === -1) {
    return res.status(404).json({ error: 'Playlist non trovata' });
  }

  if (db.playlists[indice].userId !== req.currentUser.id) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }

  // Aggiorna la playlist mantenendo i vecchi dati e sovrascrivendo solo quelli nuovi
  // ...db.playlists[indice] = copia tutti i vecchi campi
  // ...req.body = sovrascrive solo i campi mandati dal browser
  db.playlists[indice] = { ...db.playlists[indice], ...req.body };

  // Salva il database aggiornato
  writeDB(db);

  // Risponde con la playlist aggiornata
  res.json(db.playlists[indice]);

});


// Elimina una playlist (richiede login)
app.delete('/api/playlists/:id', requireAuth, function(req, res) {

  // Apre il database
  const db = readDB();

  // Cerca la posizione della playlist nell'array
  const indice = db.playlists.findIndex(function(p) {
    return p.id === req.params.id;
  });

  // Se non esiste → errore 404 ("non trovata")
  if (indice === -1) {
    return res.status(404).json({ error: 'Playlist non trovata' });
  }

  // Controlla che la playlist appartenga all'utente loggato
  if (db.playlists[indice].userId !== req.currentUser.id) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }

  // splice(indice, 1) rimuove 1 elemento all'indice trovato
  db.playlists.splice(indice, 1);

  // Salva il database aggiornato
  writeDB(db);

  // Risponde con messaggio di conferma
  res.json({ message: 'Playlist eliminata' });

});

// Aggiunge una canzone a una playlist (richiede login)
app.post('/api/playlists/:id/songs', requireAuth, function(req, res) {

  // Estrae i dati della canzone mandati dal browser
  const title    = req.body.title;
  const artist   = req.body.artist;
  const duration = req.body.duration;

  // Titolo e artista sono obbligatori
  if (!title || !artist) {
    return res.status(400).json({ error: 'Titolo e artista sono obbligatori' });
  }

  // Apre il database
  const db = readDB();

  // Cerca la posizione della playlist nell'array
  const indice = db.playlists.findIndex(function(p) {
    return p.id === req.params.id;
  });

  // Se la playlist non esiste → errore 404
  if (indice === -1) {
    return res.status(404).json({ error: 'Playlist non trovata' });
  }

  // Controlla che la playlist appartenga all'utente loggato
  if (db.playlists[indice].userId !== req.currentUser.id) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }

  // Crea il nuovo oggetto canzone
  const nuovaCanzone = {
    id:       genId(),                          // ID casuale univoco
    title:    title.trim(),                     // titolo senza spazi inutili
    artist:   artist.trim(),                    // artista senza spazi inutili
    duration: duration ? duration.trim() : '0:00'  // durata, default 0:00
  };

  // Aggiunge la canzone all'array songs della playlist
  db.playlists[indice].songs.push(nuovaCanzone);

  // Salva il database aggiornato
  writeDB(db);

  // Risponde con la canzone appena aggiunta (201 = "creata")
  res.status(201).json(nuovaCanzone);

});


// Rimuove una canzone da una playlist (richiede login)
app.delete('/api/playlists/:id/songs/:songId', requireAuth, function(req, res) {

  // Apre il database
  const db = readDB();

  // Cerca la posizione della playlist nell'array
  const indice = db.playlists.findIndex(function(p) {
    return p.id === req.params.id;
  });

  // Se la playlist non esiste → errore 404
  if (indice === -1) {
    return res.status(404).json({ error: 'Playlist non trovata' });
  }

  // Controlla che la playlist appartenga all'utente loggato
  if (db.playlists[indice].userId !== req.currentUser.id) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }

  const numeroPrima = db.playlists[indice].songs.length;

  db.playlists[indice].songs = db.playlists[indice].songs.filter(function(s) {
    return s.id !== req.params.songId;
  });

  // Se il numero di canzoni non è cambiato, la canzone non esisteva
  if (db.playlists[indice].songs.length === numeroPrima) {
    return res.status(404).json({ error: 'Canzone non trovata' });
  }

  // Salva il database aggiornato
  writeDB(db);

  // Risponde con messaggio di conferma
  res.json({ message: 'Canzone rimossa' });

});

// Endpoint non trovato (404)
app.use('/api/*path', (req, res) => res.status(404).json({ error: 'Endpoint non trovato' }));

// Gestore errori generale
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Errore interno' }); });

app.listen(PORT, () => console.log(`🎵 TuneNest → http://localhost:${PORT}`));
