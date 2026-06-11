const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

router.post('/login', (req, res) => {
  const { password } = req.body;
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'password'").get();
  const currentPassword = setting ? setting.value : 'massiv2026';
  if (password === currentPassword) {
    const token = Buffer.from(currentPassword).toString('base64');
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

module.exports = router;
