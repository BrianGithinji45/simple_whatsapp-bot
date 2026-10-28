const express = require('express');
const app = express();
const fs = require('fs');
const P = require('pino');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
let latestQR = null;
let isConnected = false;
const msgStore = new Map();

// QR PAGE - This is what you see when you open Render URL
app.get('/', async (req, res) => {
    if (isConnected) {
        return res.send('<html><body style="background:#0f0f0f;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif"><div style="text-align:center"><h1>✅ Bot is ALWAYS ONLINE 24/7</h1><p>Typing: 3s delay, 15s duration | Anti-Delete ON | Self-ping 30s</p></div></body></html>');
    }
    if (!latestQR) {
        return res.send('<html><body style="background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh"><h2>Generating QR... Refresh in 5 seconds</h2><script>setTimeout(()=>location.reload(),5000)</script></body></html>');
    }
    const qrImage = await QRCode.toDataURL(latestQR);
    res.send(`
        <html><head><title>【entity-WhatsApp¦canonical_name=WhatsApp】 QR</title><meta http-equiv="refresh" content="45"></head>
        <body style="background:#111;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif">
            <h1>Scan QR with 【entity-WhatsApp¦canonical_name=WhatsApp】</h1>
            <p>Linked Devices > Link a Device</p>
            <img src="${qrImage}" style="width:320px;background:#fff;padding:20px;border-radius:20px" />
            <p style="margin-top:20px;color:#888">QR expires in 45s - Page auto-refreshes</p>
            <p style="color:#888">Same repo = New QR for each new web service</p>
        </body></html>
    `);
});

app.get('/ping', (req, res) => res.send('pong'));
app.listen(process.env.PORT || 10000, () => console.log('Server live'));

setInterval(() => {
    if (process.env.RENDER_EXTERNAL_URL) fetch(process.env.RENDER_EXTERNAL_URL).catch(()=>{});
    console.log('Self-ping 30s - Bot alive');
}, config.selfPingSeconds * 1000);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), markOnlineOnConnect: false });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) { latestQR = qr; console.log('New QR ready - open Render URL'); }
        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            isConnected = true;
            latestQR = null;
            console.log('✅ ALWAYS ONLINE 24/7');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        if (!msg.key.fromMe) msgStore.set(msg.key.id, msg);

        // ANTI-DELETE
        if (msg.message.protocolMessage?.type === 0) {
            const orig = msgStore.get(msg.message.protocolMessage.key.id);
            if (orig) {
                const txt = orig.message.conversation || orig.message.extendedTextMessage?.text || orig.message.imageMessage?.caption || "Media";
                await sock.sendMessage(sock.user.id, { text: `🚨 ANTI-DELETE\nFrom: ${orig.key.remoteJid}\nMsg: ${txt}` });
            }
        }

        // FAKE TYPING 3s delay, 15s duration
        if (!msg.key.fromMe && m.type === 'notify' && !msg.key.remoteJid.endsWith('@g.us')) {
            setTimeout(async () => {
                await sock.sendPresenceUpdate('composing', msg.key.remoteJid);
                setTimeout(async () => await sock.sendPresenceUpdate('paused', msg.key.remoteJid), config.typingDuration);
            }, config.typingDelay);
        }
    });
}
startBot();
