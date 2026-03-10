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

const read = () => JSON.parse(fs.readFileSync(DB))
const write = d => fs.writeFileSync(DB, JSON.stringify(d, null, 2))
const id = () => crypto.randomBytes(8).toString('hex')
const safeUser = u => ({ id: u.id, username: u.username, avatar: u.avatar, bio: u.bio })

const auth = (req, res, next) => {
  const uid = req.headers['x-user-id']
  if (!uid) return res.status(401).json({ error: 'Non autenticato' })

  const db = read()
  const user = db.users.find(u => u.id === uid)
  if (!user) return res.status(401).json({ error: 'Utente non trovato' })

  req.user = user
  next()
}

app.post('/api/auth/register', (req, res) => {
  const { username, avatar = '🎧', bio = '' } = req.body
  if (!username) return res.status(400).json({ error: 'Username obbligatorio' })

  const db = read()

  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Username già in uso' })

  const user = {
    id: id(),
    username: username.trim(),
    avatar,
    bio,
    createdAt: new Date().toISOString()
  }

  db.users.push(user)
  write(db)

  res.status(201).json({ user: safeUser(user) })
})

app.post('/api/auth/login', (req, res) => {
  const { username } = req.body
  if (!username) return res.status(400).json({ error: 'Username mancante' })

  const db = read()
  const user = db.users.find(u => u.username === username)

  if (!user) return res.status(401).json({ error: 'Utente non trovato' })

  res.json({ user: safeUser(user) })
})

app.get('/api/playlists', (req, res) => {
  const db = read()

  const result = db.playlists.map(p => ({
    ...p,
    author: safeUser(db.users.find(u => u.id === p.userId) || {})
  }))

  res.json(result)
})

app.get('/api/playlists/:id', (req, res) => {
  const db = read()
  const pl = db.playlists.find(p => p.id === req.params.id)

  if (!pl) return res.status(404).json({ error: 'Playlist non trovata' })

  const author = db.users.find(u => u.id === pl.userId)

  res.json({ ...pl, author: safeUser(author || {}) })
})

app.post('/api/playlists', auth, (req, res) => {
  const { name, subtitle = '', cover = '🎵' } = req.body
  if (!name) return res.status(400).json({ error: 'Nome obbligatorio' })

  const db = read()

  const pl = {
    id: id(),
    userId: req.user.id,
    name: name.trim(),
    subtitle: subtitle.trim(),
    cover,
    songs: [],
    createdAt: new Date().toISOString()
  }

  db.playlists.push(pl)
  write(db)

  res.status(201).json(pl)
})

app.put('/api/playlists/:id', auth, (req, res) => {
  const db = read()
  const pl = db.playlists.find(p => p.id === req.params.id)

  if (!pl) return res.status(404).json({ error: 'Playlist non trovata' })
  if (pl.userId !== req.user.id) return res.status(403).json({ error: 'Non autorizzato' })

  Object.assign(pl, req.body)
  write(db)

  res.json(pl)
})

app.delete('/api/playlists/:id', auth, (req, res) => {
  const db = read()
  const i = db.playlists.findIndex(p => p.id === req.params.id)

  if (i === -1) return res.status(404).json({ error: 'Playlist non trovata' })
  if (db.playlists[i].userId !== req.user.id)
    return res.status(403).json({ error: 'Non autorizzato' })

  db.playlists.splice(i, 1)
  write(db)

  res.json({ message: 'Playlist eliminata' })
})

app.post('/api/playlists/:id/songs', auth, (req, res) => {
  const { title, artist, duration = '0:00' } = req.body
  if (!title || !artist)
    return res.status(400).json({ error: 'Titolo e artista obbligatori' })

  const db = read()
  const pl = db.playlists.find(p => p.id === req.params.id)

  if (!pl) return res.status(404).json({ error: 'Playlist non trovata' })
  if (pl.userId !== req.user.id)
    return res.status(403).json({ error: 'Non autorizzato' })

  const song = { id: id(), title: title.trim(), artist: artist.trim(), duration }

  pl.songs.push(song)
  write(db)

  res.status(201).json(song)
})

app.delete('/api/playlists/:id/songs/:songId', auth, (req, res) => {
  const db = read()
  const pl = db.playlists.find(p => p.id === req.params.id)

  if (!pl) return res.status(404).json({ error: 'Playlist non trovata' })
  if (pl.userId !== req.user.id)
    return res.status(403).json({ error: 'Non autorizzato' })

  const before = pl.songs.length
  pl.songs = pl.songs.filter(s => s.id !== req.params.songId)

  if (before === pl.songs.length)
    return res.status(404).json({ error: 'Canzone non trovata' })

  write(db)

  res.json({ message: 'Canzone rimossa' })
})

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint non trovato' })
})

app.listen(PORT, () =>
  console.log(`TuneNest → http://localhost:${PORT}`)
)
