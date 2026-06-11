const express = require('express');
const router = express.Router();
const { db } = require('../db/database');

router.patch('/reorder', (req, res) => {
  const { taskIds } = req.body;
  if (!Array.isArray(taskIds)) return res.status(400).json({ error: 'taskIds array required' });
  const update = db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?');
  const updateAll = db.transaction(ids => {
    ids.forEach((id, index) => update.run(index, id));
  });
  updateAll(taskIds);
  res.json({ ok: true });
});

module.exports = router;
