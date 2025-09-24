const express = require('express');
const mysql = require('mysql2/promise');
const app = express();
const port = 80;

app.get('/', (req, res) => res.send('Hello from Container App'));

app.get('/logs', async (req, res) => {
  const { DB_HOST, DB_PORT = '3306', DB_NAME, DB_USER, DB_PASS } = process.env;
  try {
    const conn = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME
    });
    const [rows] = await conn.execute(
      'SELECT access_time, client_ip, request_url, http_result_code FROM apache_logs ORDER BY id DESC LIMIT 100'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).send(`DB error: ${err.message}`);
  }
});

app.listen(port, () => console.log(`App running on port ${port}`));
