#!/usr/bin/env node
// Tarefas de administração (rodar no servidor):
//   docker compose -f docker-compose.prod.yml exec app node src/cli.js <comando>
//
//   reset-password <email> [senha]   troca a senha (gera uma se não informar) e desconecta os aparelhos
//   verify <email>                   confirma o e-mail de uma conta manualmente (se o e-mail não chegou)
//   users                            lista as contas
//   stats                            números gerais (contas, bandas, músicas, setlists)
'use strict';
const crypto = require('crypto');
const { pool } = require('./db');
const { hashPassword } = require('./auth');

async function main([cmd, ...args]) {
  if (cmd === 'reset-password') {
    const email = String(args[0] || '').trim().toLowerCase();
    if (!email) throw new Error('uso: reset-password <email> [senha]');
    const pw = args[1] || crypto.randomBytes(9).toString('base64url');
    if (pw.length < 6) throw new Error('a senha precisa ter pelo menos 6 caracteres');
    const { rows } = await pool.query('UPDATE users SET pass_hash = $2 WHERE lower(email) = $1 RETURNING id, name', [email, await hashPassword(pw)]);
    if (!rows.length) throw new Error(`nenhuma conta com o e-mail ${email}`);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);
    console.log(`Senha de ${rows[0].name} <${email}> trocada. Nova senha: ${pw}`);
  } else if (cmd === 'verify') {
    const email = String(args[0] || '').trim().toLowerCase();
    if (!email) throw new Error('uso: verify <email>');
    const { rows } = await pool.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE lower(email) = $1 RETURNING name', [email]);
    if (!rows.length) throw new Error(`nenhuma conta com o e-mail ${email}`);
    console.log(`E-mail de ${rows[0].name} <${email}> confirmado: a conta já pode entrar.`);
  } else if (cmd === 'users') {
    const { rows } = await pool.query(`SELECT u.email, u.name, to_char(u.created_at, 'YYYY-MM-DD') AS desde,
      (SELECT count(*) FROM band_members m WHERE m.user_id = u.id)::int AS bandas,
      CASE WHEN u.email_verified_at IS NULL THEN 'não' ELSE 'sim' END AS confirmado FROM users u ORDER BY u.created_at`);
    console.table(rows);
  } else if (cmd === 'stats') {
    const { rows } = await pool.query(`SELECT (SELECT count(*) FROM users)::int AS contas, (SELECT count(*) FROM bands)::int AS bandas,
      (SELECT count(*) FROM songs)::int AS musicas, (SELECT count(*) FROM setlists)::int AS setlists,
      (SELECT count(*) FROM sessions)::int AS sessoes`);
    console.table(rows);
  } else {
    console.log('comandos: reset-password <email> [senha] | verify <email> | users | stats');
  }
}

main(process.argv.slice(2))
  .catch(err => { console.error('Erro:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
