const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const app = express()
const PORT = 3000

const DB = path.join(__dirname, 'data', 'db.json')
const PUBLIC = path.join(__dirname, 'public')

app.use(express.json())
app.use(express.static(PUBLIC))

const leggi = () => JSON.parse(fs.readFileSync(DB))
const scrivi = d => fs.writeFileSync(DB, JSON.stringify(d, null, 2))
const idCasuale = () => crypto.randomBytes(8).toString('hex')
const utenteProtetto = u => ({ id: u.id, nomeutente: u.nomeutente, avatar: u.avatar, bio: u.bio })

// autenticazione semplice basata su header 
const autenticazione = (req, res, next) => {
  const idUtente = req.headers['x-user-id']
  if (!idUtente) return res.status(401).json({ error: 'Non autenticato' })

  const db = leggi()
  const utente = db.utenti.find(u => u.id === idUtente)
  if (!utente) return res.status(401).json({ error: 'Utente non trovato' })

  req.utente = utente
  next()
}

// registrazione se l'username non esisteva
app.post('/api/auth/register', (req, res) => {
  const { nomeutente, avatar = '🎧', bio = '' } = req.body
  if (!nomeutente) return res.status(400).json({ error: 'Username obbligatorio' })

  const db = leggi()

  if (db.utenti.some(u => u.nomeutente.toLowerCase() === nomeutente.toLowerCase()))
    return res.status(409).json({ error: 'Username già in uso' })

  const utente = {
    id: idCasuale(),
    nomeutente: nomeutente.trim(),
    avatar,
    bio,
    dataCrazione: new Date().toISOString()
  }

  db.utenti.push(utente)
  scrivi(db)

  res.status(201).json({ utente: utenteProtetto(utente) })
})

// login se l'username esisteva
app.post('/api/auth/login', (req, res) => {
  const { nomeutente } = req.body
  if (!nomeutente) return res.status(400).json({ error: 'Username mancante' })

  const db = leggi()
  const utente = db.utenti.find(u => u.nomeutente === nomeutente)

  if (!utente) return res.status(401).json({ error: 'Utente non trovato' })

  res.json({ utente: utenteProtetto(utente) })
})

// caricamento playlist con info autore
app.get('/api/playlists', (req, res) => {
  const db = leggi()

  const risultato = db.playlist.map(p => ({
    ...p,
    autore: utenteProtetto(db.utenti.find(u => u.id === p.idUtente) || {})
  }))

  res.json(risultato)
})

// caricamento playlist singola con info autore
app.get('/api/playlists/:id', (req, res) => {
  const db = leggi()
  const pl = db.playlist.find(p => p.id === req.params.id)

  if (!pl) return res.status(404).json({ error: 'Playlist non trovata' })

  const autore = db.utenti.find(u => u.id === pl.idUtente)

  res.json({ ...pl, autore: utenteProtetto(autore || {}) })
})

// creazione playlist
app.post('/api/playlists', autenticazione, (req, res) => {
  const { nome, sottotitolo = '', copertina = '🎵' } = req.body
  if (!nome) return res.status(400).json({ error: 'Nome obbligatorio' })

  const db = leggi()

  const pl = {
    id: idCasuale(),
    idUtente: req.utente.id,
    nome: nome.trim(),
    sottotitolo: sottotitolo.trim(),
    copertina,
    canzoni: [],
    dataCrazione: new Date().toISOString()
  }

  db.playlist.push(pl)
  scrivi(db)

  res.status(201).json(pl)
})

// modifica playlist
app.put('/api/playlists/:id', autenticazione, (req, res) => {
  const db = leggi()
  const pl = db.playlist.find(p => p.id === req.params.id)

  if (!pl) return res.status(404).json({ error: 'Playlist non trovata' })
  if (pl.idUtente !== req.utente.id) return res.status(403).json({ error: 'Non autorizzato' })

  Object.assign(pl, req.body)
  scrivi(db)

  res.json(pl)
})

// eliminazione playlist
app.delete('/api/playlists/:id', autenticazione, (req, res) => {
  const db = leggi()
  const i = db.playlist.findIndex(p => p.id === req.params.id)

  if (i === -1) return res.status(404).json({ error: 'Playlist non trovata' })
  if (db.playlist[i].idUtente !== req.utente.id)
    return res.status(403).json({ error: 'Non autorizzato' })

  db.playlist.splice(i, 1)
  scrivi(db)

  res.json({ message: 'Playlist eliminata' })
})

// aggiunta canzone a playlist
app.post('/api/playlists/:id/songs', autenticazione, (req, res) => {
  const { titolo, artista, durata = '0:00' } = req.body
  if (!titolo || !artista)
    return res.status(400).json({ error: 'Titolo e artista obbligatori' })

  const db = leggi()
  const pl = db.playlist.find(p => p.id === req.params.id)

  if (!pl) return res.status(404).json({ error: 'Playlist non trovata' })
  if (pl.idUtente !== req.utente.id)
    return res.status(403).json({ error: 'Non autorizzato' })

  const canzone = { id: idCasuale(), titolo: titolo.trim(), artista: artista.trim(), durata }

  pl.canzoni.push(canzone)
  scrivi(db)

  res.status(201).json(canzone)
})

// rimozione canzone da playlist
app.delete('/api/playlists/:id/songs/:songId', autenticazione, (req, res) => {
  const db = leggi()
  const pl = db.playlist.find(p => p.id === req.params.id)

  if (!pl) return res.status(404).json({ error: 'Playlist non trovata' })
  if (pl.idUtente !== req.utente.id)
    return res.status(403).json({ error: 'Non autorizzato' })

  const prima = pl.canzoni.length
  pl.canzoni = pl.canzoni.filter(s => s.id !== req.params.songId)

  if (prima === pl.canzoni.length)
    return res.status(404).json({ error: 'Canzone non trovata' })

  scrivi(db)

  res.json({ message: 'Canzone rimossa' })
})

// gestione endpoint non trovati
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint non trovato' })
})

// avvio server
app.listen(PORT, () =>
  console.log(`TuneNest → http://localhost:${PORT}`)
)
