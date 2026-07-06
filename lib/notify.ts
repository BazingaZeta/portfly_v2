// Notifiche push out-of-band (Telegram). Volutamente best-effort e opzionali:
// senza TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID ogni chiamata è un no-op, così il
// resto del sistema non dipende mai dalla configurazione delle notifiche.
//
// Setup (una tantum): crea un bot con @BotFather, prendi il token; scrivi al
// bot e leggi la chat id da https://api.telegram.org/bot<TOKEN>/getUpdates.

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** Invia un messaggio Telegram (HTML). Ritorna false se non configurato o fallito. */
export async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
