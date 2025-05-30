const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const session = require('express-session');

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./mydb.sqlite');

const app = express();
const server = http.createServer(app);
app.use(bodyParser.json());

const { EventEmitter } = require('stream');
const emitter = new EventEmitter()
emitter.setMaxListeners(0)

const {
  dropQuestionTable,
  createQuestionTable,
  dropUserTable,
  createUserTable
} = require('./db-utils.js')

let approvedMessages = [];
let globalAllowed = false;

const URL = ''
const PORT = "3001"

const io = new Server(server, {
  cors: {
    origin: `${URL}:${PORT}`,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(express.static('../frontend/dist'))

app.use(cors({
  origin: `${URL}:${PORT}`,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}))

app.get("/", (_, res) => {
  return res.status(200).send("OK!");
})

app.get('/api/questions', (_, res) => {
  db.all('select * from question', [], (err, rows) => {
    if (err) { console.log(err) }
    res.json(rows)
  })
});

app.post('/api/answer/:id', (req, res) => {
  id = req.params.id
  db.all(`update question set answered = 1 where id = ${id}`, [], (err, _) => {
    if (err) { console.log(err) }
    else { res.status(200).send("Question marked as read.") }
  })
});

app.get('/api/users', (_, res) => {
  db.all('select username from user', [], (err, rows) => {
    if (err) { console.log(err) }
    res.json(rows)
  })
})

app.post('/api/user', (req, res) => {
  let username = req.body.username;
  let password = req.body.password;
  let display = req.body.display;
  
  db.all(`insert into user (username, password, display, role, points)
    values (?, ?, ?, "user", 0)`,
    [username, password, display], (err, _) => {
    if (err) { console.log(err) }
    else { res.status(200).send("Adding a user successful") }
  })
})

app.get('/api/points', (_, res) => {
  db.all(`select username, display, points from user`, [], (err, rows) => {
    if (err) { console.log(err) }
    res.json(rows)
  })
})

app.post('/api/points', (req, res) => {  
  let username = req.body.username;
  let points = parseInt(req.body.points);

  db.all(`update user set points = points + ? where username = ?`, [points, username], (err, _) => {
    if (err) { console.log(err) }
    else {return res.status(200).send("Points updated")}
  })
})

app.get('/api/dje-reset-game', async (_, res) => {
  console.log('Database reset triggered');
  try {
    await dropQuestionTable();
    await dropUserTable();
    await createQuestionTable();
    await createUserTable();
    res.status(200).json({ message: 'Database successfully reset' });
  } catch (error) {
    console.error('Error resetting database:', error);
    res.status(500).json({ error: 'Failed to reset database', details: error.message });
  }
});

app.get('/api/dje-reset-questions', async (_, res) => {
  console.log('Questions reset triggered');
  try {
    await dropQuestionTable();
    await createQuestionTable();
    res.status(200).json({ message: 'Questions successfully reset' });
  } catch (error) {
    console.error('Error resetting questions:', error);
    res.status(500).json({ error: 'Failed to reset questions', details: error.message });
  }
});

app.use(session({
  secret: 'djeparty',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.all(`select password, role from user where username = ?`, [username], (err, rows) => {
    if (err) { console.log(err); }
    else {
      if (rows[0]?.password === password) {
        req.session.user = {username, role: rows[0].role}
        res.json({ success: true, role: rows[0].role})
      } else {
        res.status(401).json({ success: false })
      }
    }
  })
});

app.get('/session', (req, res) => {
  if (req.session.user) {
    res.json(req.session.user);
  } else {
    res.status(401).json({ success: false });
  }
});

io.on('connection', (socket) => {
  socket.on('login_user', (username) => {
    socket.username = username;
    socket.emit('permission_status', globalAllowed);
  });

  socket.on('user_message', ({ username, msg, bet }) => {
    if (globalAllowed) {
      io.to('admin').emit('new_message', { username, msg, bet });
    }
  });

  socket.on('admin_join', () => {
    socket.join('admin');
    socket.emit('approved_messages', approvedMessages);
    socket.emit('global_allowed', globalAllowed);
  });

  socket.on('set_global_permission', (allowed) => {
    globalAllowed = allowed;
    io.emit('permission_status', globalAllowed);
    io.to('admin').emit('global_allowed', globalAllowed);
  });

  socket.on('display_join', () => {
    socket.join('display');
    approvedMessages.forEach((m) => socket.emit('display_message', m));
  });

  socket.on('admin_show_question', (question) => {
    io.to('display').emit('display_question', question);
  });

  socket.on('show_answer', (data) => {
    io.to('display').emit('show_answer', data);
  });

  socket.on('close_question', () => {
    io.to('display').emit('close_question');
  });

  socket.on('mark_as_read', (questionId) => {
    io.to('display').emit('mark_as_read', questionId);
  });

  socket.on('display_switch', (id) => {
    io.emit('display_switch', id);
  })

  socket.on('open_points', () => {
    io.to('display').emit('open_points');
  })

  socket.on('undo_open', () => {
    io.to('display').emit('undo_open')
  })
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on ${URL}:${PORT}`)
});
