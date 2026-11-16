// E-mail transacional pelo Resend (API HTTP, sem dependência extra) — mesmo esquema do felpma.
//
// Variáveis de ambiente:
//   RESEND_API_KEY      chave criada em Resend → API Keys (começa com "re_")
//   EMAIL_FROM_ADDRESS  remetente de um domínio verificado no Resend (ex.: nao-responda@tectune.com.br)
//   EMAIL_FROM_NAME     nome na caixa de entrada (padrão: Tectune)
//   APP_URL             endereço público, usado nos links (padrão: https://tectune.com.br)
//
// Sem RESEND_API_KEY + EMAIL_FROM_ADDRESS:
//   - em desenvolvimento, nada quebra: o e-mail é "simulado" e o link aparece no terminal;
//   - em produção, a recuperação de senha some da tela de login e os convites só aparecem no app.
'use strict';

const PROD = process.env.NODE_ENV === 'production';
const configured = () => Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM_ADDRESS?.trim());
/** O envio funciona? (em dev o simulado conta como disponível) */
const available = () => configured() || !PROD;
const appUrl = () => (process.env.APP_URL || 'https://tectune.com.br').replace(/\/+$/, '');
const fromName = () => process.env.EMAIL_FROM_NAME?.trim() || 'Tectune';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Moldura simples e legível em qualquer cliente de e-mail. */
function layout({ title, lines, button, footer }) {
  const body = lines.map(l => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#292524">${l}</p>`).join('');
  const btn = button ? `<p style="margin:22px 0"><a href="${esc(button.href)}" style="display:inline-block;background:#1C1917;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;font-size:15px">${esc(button.label)}</a></p>
    <p style="margin:0 0 14px;font-size:12px;color:#78716C">Se o botão não abrir, copie este endereço: <br><a href="${esc(button.href)}" style="color:#78716C">${esc(button.href)}</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#F5F5F4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:28px 16px">
    <div style="font-weight:800;font-size:20px;letter-spacing:-.02em;color:#1C1917;margin-bottom:18px">Tectune</div>
    <div style="background:#fff;border-radius:12px;padding:26px 24px;border:1px solid #E7E5E4">
      <h1 style="margin:0 0 16px;font-size:19px;color:#1C1917">${esc(title)}</h1>${body}${btn}
    </div>
    <p style="font-size:12px;color:#A8A29E;margin:16px 4px">${footer || 'Você recebeu este e-mail porque alguém usou este endereço no Tectune. Se não foi você, pode ignorar.'}</p>
  </div></body></html>`;
}

/** Envia (ou simula). Lança erro em produção se o Resend falhar ou não estiver configurado. */
async function send({ to, subject, html, text }) {
  if (!configured()) {
    if (PROD) throw new Error('E-mail não configurado: defina RESEND_API_KEY e EMAIL_FROM_ADDRESS no .env');
    const link = (html.match(/href="(https?:[^"]+)"/) || [])[1] || '(sem link)';
    console.log(`[e-mail simulado] para=${to} assunto="${subject}" link=${link}`);
    return { simulated: true, link };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${fromName()} <${process.env.EMAIL_FROM_ADDRESS.trim()}>`, to: [to], subject, html, text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Resend respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

/* ---------- mensagens ---------- */

function passwordReset({ to, name, link }) {
  return send({
    to, subject: 'Redefinir sua senha do Tectune',
    html: layout({
      title: 'Redefinir senha',
      lines: [`Oi, ${esc(name)}!`, 'Recebemos um pedido para trocar a senha da sua conta. O link vale por <b>1 hora</b> e só pode ser usado uma vez.'],
      button: { href: link, label: 'Criar nova senha' },
      footer: 'Se você não pediu a troca, ignore este e-mail: sua senha continua a mesma.',
    }),
    text: `Oi, ${name}!\n\nPara criar uma nova senha no Tectune, abra (vale 1 hora):\n${link}\n\nSe você não pediu, ignore este e-mail.`,
  });
}

function confirmEmail({ to, name, link }) {
  return send({
    to, subject: 'Confirme seu e-mail no Tectune',
    html: layout({
      title: 'Confirme seu e-mail',
      lines: [`Oi, ${esc(name)}! Que bom ter você no Tectune.`, 'Falta só um passo: confirme que este e-mail é seu para ativar a conta. O link vale por <b>24 horas</b>.'],
      button: { href: link, label: 'Confirmar meu e-mail' },
      footer: 'Se você não criou uma conta no Tectune, ignore este e-mail: nenhuma conta será ativada.',
    }),
    text: `Oi, ${name}!\n\nConfirme seu e-mail para ativar a conta no Tectune (vale 24 horas):\n${link}\n\nSe não foi você, ignore este e-mail.`,
  });
}

function bandInvite({ to, band, by, hasAccount }) {
  const link = hasAccount ? appUrl() : `${appUrl()}/?cadastro=${encodeURIComponent(to)}`;
  const action = hasAccount ? 'Entre no Tectune para aceitar o convite.' : 'Crie sua conta com este e-mail e o convite já vai estar lá esperando.';
  return send({
    to, subject: `${by} convidou você para a banda ${band} no Tectune`,
    html: layout({
      title: `Convite para a banda ${band}`,
      lines: [`<b>${esc(by)}</b> convidou você para fazer parte da banda <b>${esc(band)}</b> no Tectune: cifras, setlists e show ao vivo com a banda inteira no mesmo tempo.`, action],
      button: { href: link, label: hasAccount ? 'Abrir o Tectune' : 'Criar minha conta' },
    }),
    text: `${by} convidou você para a banda ${band} no Tectune.\n${action}\n${link}`,
  });
}

module.exports = { configured, available, appUrl, send, passwordReset, confirmEmail, bandInvite };
