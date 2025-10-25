const { Telegraf, Markup, session } = require('telegraf');
const fs = require('fs-extra');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(',');

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN tidak ditemukan");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

const DB_PATH = './db.json';
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({ users: {}, stok: { mini: 5 }, transactions: {}, pendingTopups: {} }, null, 2));
}

function loadDB() { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
function genId() { return 'ID' + Date.now() + Math.floor(Math.random() * 900 + 100); }
function isAdmin(id) { return ADMIN_IDS.includes(String(id)); }

const menuUtama = () => Markup.keyboard([
  [{ text: '📦 Isi Kuota' }, { text: '👤 Profile' }],
  [{ text: '💳 Top-up Saldo' }, { text: '💰 Cek Saldo' }],
  [{ text: '📊 Cek Stok' }, { text: '🧾 History' }],
  [{ text: '📌 Cek Status Top-up' }]
]).resize();

const adminMenu = () => Markup.keyboard([
  [{ text: '💰 Set Saldo' }, { text: '➕ Tambah Saldo' }],
  [{ text: '📦 Tambah Stok' }, { text: '📂 View DB' }],
  [{ text: '📝 Pending Topup' }, { text: '🏠 Menu Utama' }]
]).resize();

bot.start(ctx => {
  const id = ctx.from.id;
  const db = loadDB();
  if (isAdmin(id)) return ctx.reply('Selamat datang Admin 👑', adminMenu());
  if (!db.users[id]) return ctx.reply('Selamat datang! Ketik /register untuk daftar.');
  const u = db.users[id];
  ctx.replyWithHTML(`Halo ${u.name} 👋\n💰 Saldo: Rp${u.saldo.toLocaleString()}`, menuUtama());
});

bot.command('register', ctx => {
  ctx.reply('Ketik nomor HP kamu (contoh: 0812xxxx)');
  ctx.session = { step: 'register_phone' };
});

// ======== FITUR USER ========

bot.hears('📦 Isi Kuota', ctx => {
  const db = loadDB();
  if (!db.users[ctx.from.id]) return ctx.reply('⚠️ Ketik /register dulu.');
  ctx.replyWithHTML(`<b>📦 Produk: Mini</b>\n💰 Harga: Rp53.000\nKetik nomor HP tujuan.`);
  ctx.session = { step: 'beli_mini' };
});

bot.hears('💳 Top-up Saldo', ctx => {
  if (!loadDB().users[ctx.from.id]) return ctx.reply('⚠️ Ketik /register dulu.');
  ctx.reply('Ketik nominal top-up minimal Rp10.000:');
  ctx.session = { step: 'topup_nominal' };
});

bot.hears('💰 Cek Saldo', ctx => {
  const u = loadDB().users[ctx.from.id];
  if (!u) return ctx.reply('⚠️ Ketik /register dulu.');
  ctx.reply(`💰 Saldo kamu: Rp${u.saldo.toLocaleString()}`);
});

bot.hears('📊 Cek Stok', ctx => {
  const db = loadDB();
  ctx.reply(`📦 Stok Mini: ${db.stok.mini}`);
});

bot.hears('👤 Profile', ctx => {
  const u = loadDB().users[ctx.from.id];
  if (!u) return ctx.reply('⚠️ Ketik /register dulu.');
  ctx.replyWithHTML(`👤 Profil Kamu\n🆔 ID: <code>${ctx.from.id}</code>\n📱 Nomor: ${u.phone}\n💰 Saldo: Rp${u.saldo.toLocaleString()}\n📜 Total Transaksi: ${u.history.length}`);
});

bot.hears('🧾 History', ctx => {
  const db = loadDB();
  const u = db.users[ctx.from.id];
  if (!u) return ctx.reply('⚠️ Ketik /register dulu.');
  if (!u.history.length) return ctx.reply('Belum ada transaksi.');
  let text = '<b>🧾 Riwayat Transaksi:</b>\n\n';
  for (const txId of u.history) {
    const t = db.transactions[txId];
    if (t) text += `📱 ${t.nomor} - ${t.produk}\n💰 Rp${t.harga.toLocaleString()}\n🕒 ${t.waktu}\n\n`;
  }
  ctx.replyWithHTML(text);
});

bot.hears("📌 Cek Status Top-up", ctx => {
  const db = loadDB();
  const id = ctx.from.id;
  if (!db.users[id]) return ctx.reply('⚠️ Ketik /register dulu.');
  const pending = db.pendingTopups;
  if (!pending || Object.keys(pending).length === 0) return ctx.reply('Belum ada top-up yang dikirim.');
  let text = '📌 Status Top-up kamu:\n\n';
  let found = false;
  for (const topId in pending) {
    const t = pending[topId];
    if (t.userId === id) {
      found = true;
      text += `• Nominal: Rp${t.amount.toLocaleString()}\n• Status: ${t.status}\n• ID Top-up: ${topId}\n\n`;
    }
  }
  if (!found) text = 'Belum ada top-up yang kamu kirim.';
  ctx.reply(text);
});

// ======== HANDLE TEXT INPUT ========

bot.on('text', async ctx => {
  const db = loadDB();
  const id = ctx.from.id;
  const msg = ctx.message.text.trim();

  if (!db.transactions) db.transactions = {};
  if (!db.pendingTopups) db.pendingTopups = {};

  // Registrasi
  if (ctx.session?.step === 'register_phone') {
    db.users[id] = { name: ctx.from.first_name, phone: msg, saldo: 0, history: [] };
    saveDB(db);
    ctx.session = null;
    ADMIN_IDS.forEach(aid => {
      bot.telegram.sendMessage(aid, `🆕 User baru terdaftar!\nName: ${ctx.from.first_name}\nID: ${id}\nNomor HP: ${msg}`);
    });
    return ctx.reply(`✅ Terdaftar! Nomor HP: ${msg}`, menuUtama());
  }

  // Beli Mini
  if (ctx.session?.step === 'beli_mini') {
    const nomor = msg;
    const harga = 53000;
    if (db.stok.mini <= 0) return ctx.reply('❌ Stok habis.');
    if (db.users[id].saldo < harga) return ctx.reply('❌ Saldo tidak cukup.');
    db.users[id].saldo -= harga;
    db.stok.mini -= 1;
    const txId = genId();
    db.transactions[txId] = { userId: id, produk: 'Mini', nomor, harga, waktu: new Date().toLocaleString(), status: 'done' };
    db.users[id].history.push(txId);
    saveDB(db);
    ctx.replyWithHTML(`✅ Pembelian Berhasil!\n📱 Nomor: <code>${nomor}</code>\n📦 Produk: Mini\n💰 Rp${harga.toLocaleString()}`);
    ctx.session = null;
  }

  // Topup nominal
  if (ctx.session?.step === 'topup_nominal') {
    const nominal = Number(msg.replace(/[^0-9]/g, ''));
    if (!nominal || nominal < 10000) return ctx.reply("⚠️ Minimal top-up Rp10.000.");
    const topId = genId();
    db.pendingTopups[topId] = { userId: id, amount: nominal, status: 'Menunggu bukti', file: null };
    saveDB(db);
    ctx.session = { step: 'topup_bukti', topId };
    return ctx.reply(`✅ Top-up Rp${nominal.toLocaleString()} tercatat.\nSekarang kirim bukti pembayaran (foto).`);
  }

  // ADMIN commands
  if (isAdmin(id)) {
    const args = msg.split(' ');
    if (msg === '🏠 Menu Utama') return ctx.reply('Kembali ke menu utama Admin.', adminMenu());
    if (msg === '📝 Pending Topup') {
      let text = '📌 Pending Topup:\n';
      for (const k in db.pendingTopups) {
        const t = db.pendingTopups[k];
        text += `ID: ${k}, User: ${t.userId}, Status: ${t.status}, Nominal: Rp${t.amount.toLocaleString()}\n`;
      }
      return ctx.reply(text || 'Tidak ada pending topup.');
    }
    if (args[0] === '/addsaldo' && args.length === 3) {
      const uid = args[1], jml = Number(args[2]);
      if (!db.users[uid]) return ctx.reply('User tidak ditemukan.');
      db.users[uid].saldo += jml;
      saveDB(db);
      bot.telegram.sendMessage(uid, `💰 Saldo kamu ditambah Rp${jml.toLocaleString()} oleh Admin.`);
      return ctx.reply('✅ Saldo berhasil ditambah.');
    }
    if (args[0] === '/setsaldo' && args.length === 3) {
      const uid = args[1], jml = Number(args[2]);
      if (!db.users[uid]) return ctx.reply('User tidak ditemukan.');
      db.users[uid].saldo = jml;
      saveDB(db);
      bot.telegram.sendMessage(uid, `💰 Saldo kamu diset ke Rp${jml.toLocaleString()} oleh Admin.`);
      return ctx.reply('✅ Saldo berhasil diset.');
    }
    if (args[0] === '/addstok' && args.length === 3) {
      const produk = args[1], jml = Number(args[2]);
      if (!db.stok[produk]) db.stok[produk] = 0;
      db.stok[produk] += jml;
      saveDB(db);
      return ctx.reply(`✅ Stok ${produk} ditambah ${jml}`);
    }
  }
});

// ======== HANDLE FOTO BUKTI ========

bot.on('photo', async ctx => {
  const db = loadDB();
  const id = ctx.from.id;
  if (ctx.session?.step === 'topup_bukti') {
    const topId = ctx.session.topId;
    const fileId = ctx.message.photo.pop().file_id;
    db.pendingTopups[topId].file = fileId;
    db.pendingTopups[topId].status = 'Menunggu Verifikasi';
    saveDB(db);
    ctx.reply('✅ Bukti diterima! Menunggu verifikasi admin.');
    ADMIN_IDS.forEach(aid => {
      bot.telegram.sendPhoto(aid, fileId, {
        caption: `🧾 Bukti top-up baru!\nDari User: ${id}\nNominal: Rp${db.pendingTopups[topId].amount.toLocaleString()}\nTopup ID: ${topId}`
      });
    });
    ctx.session = null;
  }
});

// ======== START BOT ========

bot.launch()
  .then(() => console.log('✅ Bot user + admin siap jualan!'))
  .catch(err => console.error('❌ Gagal start bot:', err));
