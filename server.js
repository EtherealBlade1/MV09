const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'photo') {
      cb(null, 'uploads/photos/');
    } else {
      cb(null, 'uploads/tracks/');
    }
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'photo' && !['.jpg', '.jpeg', '.png'].includes(ext)) {
      return cb(new Error('Только JPG, JPEG и PNG разрешены для фото'));
    }
    if (file.fieldname === 'file' && !['.mp3', '.mkv'].includes(ext)) {
      return cb(new Error('Только MP3 и MKV разрешены для треков'));
    }
    cb(null, true);
  },
});

const fs = require('fs');
if (!fs.existsSync('uploads/tracks')) fs.mkdirSync('uploads/tracks', { recursive: true });
if (!fs.existsSync('uploads/photos')) fs.mkdirSync('uploads/photos', { recursive: true });

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB подключен'));

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  photo: { type: String, default: null },
});
const User = mongoose.model('User', userSchema);

const trackSchema = new mongoose.Schema({
  title: { type: String, required: true },
  artist: { type: String, required: true },
  duration: { type: String, required: true },
  filePath: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
});
const Track = mongoose.model('Track', trackSchema);

const playlistSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  tracks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Track' }],
});
const Playlist = mongoose.model('Playlist', playlistSchema);

const topicSchema = new mongoose.Schema({
  title: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
});
const Topic = mongoose.model('Topic', topicSchema);

const trackCommentSchema = new mongoose.Schema({
  trackId: { type: mongoose.Schema.Types.ObjectId, ref: 'Track' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  text: String,
  rating: { type: Number, min: 1, max: 5 },
  createdAt: { type: Date, default: Date.now },
}, { indexes: [{ key: { trackId: 1, userId: 1 }, unique: true }] });
const TrackComment = mongoose.model('TrackComment', trackCommentSchema);

const topicCommentSchema = new mongoose.Schema({
  topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const TopicComment = mongoose.model('TopicComment', topicCommentSchema);

const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ message: 'Нет доступа' });
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Токен недействителен' });
    req.user = user;
    next();
  });
};

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const user = new User({ username, password: hashedPassword });
    await user.save();
    res.status(201).json({ id: user._id });
  } catch (err) {
    res.status(400).json({ message: 'Пользователь уже существует' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: 'Неверный логин или пароль' });
  }
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  res.json({ token, id: user._id, photo: user.photo });
});

app.get('/api/profile', authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ username: user.username, photo: user.photo });
});

app.post('/api/profile/photo', authenticateToken, upload.single('photo'), async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!req.file) return res.status(400).json({ message: 'Файл не загружен' });
  user.photo = req.file.path;
  await user.save();
  res.json({ photo: user.photo });
});

app.get('/api/history', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const tracks = await Track.find({ userId }).select('title createdAt');
  const trackComments = await TrackComment.find({ userId }).populate('trackId', 'title');
  const topics = await Topic.find({ userId }).select('title createdAt');
  const topicComments = await TopicComment.find({ userId }).populate('topicId', 'title');

  const history = [
    ...tracks.map((t) => ({ type: 'Загрузка трека', title: t.title, date: t.createdAt })),
    ...trackComments.map((c) => ({ type: 'Комментарий к треку', title: c.trackId.title, date: c.createdAt })),
    ...topics.map((t) => ({ type: 'Создание темы', title: t.title, date: t.createdAt })),
    ...topicComments.map((c) => ({ type: 'Комментарий к теме', title: c.topicId.title, date: c.createdAt })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json(history);
});

app.get('/api/tracks', async (req, res) => {
  const tracks = await Track.find();
  res.json(tracks);
});

app.post('/api/tracks/upload', authenticateToken, upload.single('file'), async (req, res) => {
  const { title, artist, duration } = req.body;
  if (!req.file || !title || !artist || !duration) {
    return res.status(400).json({ message: 'Все поля обязательны' });
  }
  const track = new Track({
    title,
    artist,
    duration,
    filePath: req.file.path,
    userId: req.user.id,
  });
  await track.save();
  res.status(201).json(track);
});

app.get('/api/tracks/comments/:trackId', async (req, res) => {
  const comments = await TrackComment.find({ trackId: req.params.trackId }).populate('userId', 'username photo');
  const ratings = comments.filter((c) => c.rating).map((c) => c.rating);
  const averageRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 'Нет оценок';
  res.json({ comments, averageRating });
});

app.post('/api/tracks/comments', authenticateToken, async (req, res) => {
  const { trackId, text, rating } = req.body;
  try {
    const existingComment = await TrackComment.findOne({ trackId, userId: req.user.id });
    if (existingComment) {
      existingComment.text = text || existingComment.text;
      existingComment.rating = rating || existingComment.rating;
      await existingComment.save();
      res.status(200).json(existingComment);
    } else {
      const comment = new TrackComment({
        trackId,
        userId: req.user.id,
        text,
        rating,
      });
      await comment.save();
      res.status(201).json(comment);
    }
  } catch (err) {
    res.status(400).json({ message: 'Ошибка при добавлении комментария' });
  }
});

app.get('/api/playlist', authenticateToken, async (req, res) => {
  const playlist = await Playlist.findOne({ userId: req.user.id }).populate('tracks');
  if (!playlist) return res.json({ tracks: [] });
  res.json(playlist);
});

app.post('/api/playlist', authenticateToken, async (req, res) => {
  const { trackId } = req.body;
  const userId = req.user.id;
  let playlist = await Playlist.findOne({ userId });
  if (!playlist) {
    playlist = new Playlist({ userId, tracks: [trackId] });
  } else {
    if (!playlist.tracks.includes(trackId)) {
      playlist.tracks.push(trackId);
    }
  }
  await playlist.save();
  res.status(201).json({ message: 'Трек добавлен в плейлист' });
});

app.get('/api/topics', async (req, res) => {
  const topics = await Topic.find().populate('userId', 'username');
  res.json(topics);
});

app.post('/api/topics', authenticateToken, async (req, res) => {
  const { title } = req.body;
  const topic = new Topic({ title, userId: req.user.id });
  await topic.save();
  res.status(201).json(topic);
});

app.delete('/api/topics/:id', authenticateToken, async (req, res) => {
  const topic = await Topic.findById(req.params.id);
  if (!topic) return res.status(404).json({ message: 'Тема не найдена' });
  if (topic.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'Нет прав для удаления' });
  }
  await Topic.deleteOne({ _id: req.params.id });
  await TopicComment.deleteMany({ topicId: req.params.id });
  res.json({ message: 'Тема удалена' });
});

app.get('/api/topics/comments/:topicId', async (req, res) => {
  const comments = await TopicComment.find({ topicId: req.params.topicId }).populate('userId', 'username photo');
  res.json(comments);
});

app.post('/api/topics/comments', authenticateToken, async (req, res) => {
  const { topicId, text } = req.body;
  const comment = new TopicComment({
    topicId,
    userId: req.user.id,
    text,
  });
  await comment.save();
  res.status(201).json(comment);
});

app.put('/api/topics/comments/:id', authenticateToken, async (req, res) => {
  const { text } = req.body;
  const comment = await TopicComment.findById(req.params.id);
  if (!comment) return res.status(404).json({ message: 'Комментарий не найден' });
  if (comment.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'Нет прав для редактирования' });
  }
  comment.text = text;
  await comment.save();
  res.json(comment);
});

app.delete('/api/topics/comments/:id', authenticateToken, async (req, res) => {
  const comment = await TopicComment.findById(req.params.id);
  if (!comment) return res.status(404).json({ message: 'Комментарий не найден' });
  if (comment.userId.toString() !== req.user.id) {
    return res.status(403).json({ message: 'Нет прав для удаления' });
  }
  await TopicComment.deleteOne({ _id: req.params.id });
  res.json({ message: 'Комментарий удалён' });
});

const initTracks = async () => {
  const count = await Track.countDocuments();
  if (count === 0) {
    await Track.insertMany([
      { title: 'Song 1', artist: 'Artist 1', duration: '3:45', filePath: 'uploads/tracks/test1.mp3', userId: null },
      { title: 'Song 2', artist: 'Artist 2', duration: '4:12', filePath: 'uploads/tracks/test2.mp3', userId: null },
    ]);
    console.log('Тестовые треки добавлены');
  }
};
initTracks();

app.listen(process.env.PORT, () => {
  console.log(`Сервер работает на порту ${process.env.PORT}`);
});