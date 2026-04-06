require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const http = require("http");
const {
  initStorage,
  getUsers,
  getCodes,
  getStock,
  saveUsers,
  saveCodes,
  saveStock,
  closeStorage
} = require("./storage");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
const PORT = Number(process.env.PORT || 10000);

// ========= IMAGES =========
const START_PHOTO = path.join(__dirname, "start.jpg");
const BALANCE_PHOTO = path.join(__dirname, "balance.jpg");
const REFER_PHOTO = path.join(__dirname, "refer.jpg");
const GIFT_PHOTO = path.join(__dirname, "gift.jpg");
const WITHDRAW_PHOTO = path.join(__dirname, "balance.jpg");
const BROADCAST_PHOTO = path.join(__dirname, "broadcast.jpg");
const LOGIN_TUTORIAL_VIDEO = path.join(__dirname, "netflix-login-tutorial.mp4");

let users = {};
let codes = {};

function stockCounts() {
  const stock = getStock();
  return {
    premium: Array.isArray(stock.premium) ? stock.premium.length : 0,
    mail: Array.isArray(stock.mail) ? stock.mail.length : 0,
    delivered: Array.isArray(stock.delivered) ? stock.delivered.length : 0
  };
}

// ========= CONFIG =========
const OWNER_USERNAME = (process.env.OWNER_USERNAME || "").trim().replace(/^@/, "").toLowerCase();
const CHECK_CHANNEL = (process.env.CHECK_CHANNEL || "").trim();
const LOG_CHANNEL = (process.env.LOG_CHANNEL || "").trim();
const PROOF_CHANNEL = (process.env.PROOF_CHANNEL || "").trim();

const CHANNEL_MAIN = "https://t.me/+Zjl-KUen6gtmNGJl";
const CHANNEL_1 = "https://t.me/+iB_Ev7sxfYRiYjZl";
const CHANNEL_2 = "https://t.me/backupheres";
const CHANNEL_3 = "https://t.me/+52hVAKUHLgdkNzY1";
const CHANNEL_4 = "https://t.me/+rWWdk-KXyp0xMjdl";

const REFER_POINTS = Number(process.env.REFER_POINTS || 1);
const WITHDRAW_PREMIUM_POINTS = Number(process.env.WITHDRAW_PREMIUM_POINTS || 3);
const WITHDRAW_MAIL_POINTS = Number(process.env.WITHDRAW_MAIL_POINTS || 50);

let botUsernameCache = "";

// ========= TEXT HELPERS =========
function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function code(value = "") {
  return `<code>${escapeHtml(value)}</code>`;
}

function bold(value = "") {
  return `<b>${escapeHtml(value)}</b>`;
}

function safeName(value = "User") {
  return escapeHtml(String(value || "User").toUpperCase());
}

function htmlOptions(extra = {}) {
  return {
    parse_mode: "HTML",
    ...extra
  };
}

async function getBotUsername() {
  if (botUsernameCache) return botUsernameCache;
  const me = await bot.getMe();
  botUsernameCache = me.username;
  return botUsernameCache;
}

function ownerMention() {
  return OWNER_USERNAME ? `@${OWNER_USERNAME}` : "Owner username not set";
}

// ========= HELPERS =========
function getUser(id, name = "User", username = "") {
  const key = String(id);
  let created = false;

  if (!users[key]) {
    created = true;
    users[key] = {
      id: key,
      name,
      username,
      points: 0,
      refers: 0,
      referredBy: null,
      refRewardGiven: false,
      joined: false,
      newUserNotified: false,
      redeemed: [],
      awaitingMailSubmission: false,
      awaitingProof: false,
      lastClaimType: null,
      submittedMail: ""
    };
    saveUsers().catch((error) => {
      console.error("Failed to save users:", error.message);
    });
  }

  return { user: users[key], created };
}

function updateUser(msg) {
  const id = String(msg.from.id);
  const name = msg.from.first_name || "User";
  const username = msg.from.username || "";

  const { user } = getUser(id, name, username);
  user.name = name;
  user.username = username;
  saveUsers().catch((error) => {
    console.error("Failed to save users:", error.message);
  });
  return user;
}

function totalUsers() {
  return Object.values(users).filter((user) => user && user.joined).length;
}

function isOwner(msg) {
  const username = (msg.from.username || "").trim().replace(/^@/, "").toLowerCase();
  return Boolean(username) && username === OWNER_USERNAME;
}

function logToChannel(text, extra = {}) {
  if (!LOG_CHANNEL) return;
  bot.sendMessage(LOG_CHANNEL, text, extra).catch(() => {});
}

async function checkJoin(userId) {
  if (!CHECK_CHANNEL) return true;
  try {
    const member = await bot.getChatMember(CHECK_CHANNEL, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (error) {
    console.error("Join check failed:", error.message);
    return false;
  }
}

function sendPhotoSafe(chatId, photoPath, caption, extra = {}) {
  try {
    if (fs.existsSync(photoPath) && fs.statSync(photoPath).size > 0) {
      return bot.sendPhoto(chatId, photoPath, htmlOptions({ caption, ...extra }));
    }
  } catch (error) {
    console.error(`Unable to send photo ${photoPath}:`, error.message);
  }

  return bot.sendMessage(chatId, caption, htmlOptions(extra));
}

function sendVideoSafe(chatId, videoPath, caption, extra = {}) {
  try {
    if (fs.existsSync(videoPath) && fs.statSync(videoPath).size > 0) {
      return bot.sendVideo(chatId, videoPath, htmlOptions({ caption, ...extra }));
    }
  } catch (error) {
    console.error(`Unable to send video ${videoPath}:`, error.message);
  }

  return bot.sendMessage(chatId, caption, htmlOptions(extra));
}

function mainMenu() {
  return {
    reply_markup: {
      keyboard: [
        ["💰 Balance", "👥 Refer"],
        ["🛒 Withdraw", "🆘 Support"],
        ["🤔 Proofs", "🎁 Gift Code"],
        ["📦 Stock", "👑 Admin Panel"]
      ],
      resize_keyboard: true
    }
  };
}

function referMenu() {
  return {
    reply_markup: {
      keyboard: [
        ["🥰 My Refer", "🌟 Top Lists"],
        ["⬅ Back"]
      ],
      resize_keyboard: true
    }
  };
}

function adminMenu() {
  return {
    reply_markup: {
      keyboard: [
        ["➕ Add Points", "🎁 Create Code"],
        ["📦 Add Stock", "📊 Stock View"],
        ["🗑 Remove Stock", "📤 Delivered History"],
        ["📘 How To Use", "📊 Stats"],
        ["⬅ Back"]
      ],
      resize_keyboard: true
    }
  };
}

function topListText() {
  const arr = Object.values(users)
    .sort((a, b) => (b.refers || 0) - (a.refers || 0))
    .slice(0, 10);

  if (!arr.length) {
    return "<b>TOP LISTS</b>\n\nNo top users yet.";
  }

  let text = "<b>TOP LISTS</b>\n\n";
  arr.forEach((user, index) => {
    text += `${index + 1}. ${escapeHtml(user.name)} - ${Number(user.refers || 0)} refers\n`;
  });
  return text;
}

// ========= STOCK HELPERS =========
function ensureStockShape() {
  const stock = getStock();
  if (!Array.isArray(stock.premium)) stock.premium = [];
  if (!Array.isArray(stock.mail)) stock.mail = [];
  if (!Array.isArray(stock.delivered)) stock.delivered = [];
  saveStock(stock).catch((error) => {
    console.error("Failed to persist stock shape:", error.message);
  });
  return stock;
}

function stockCount(type) {
  const stock = ensureStockShape();
  return Array.isArray(stock[type]) ? stock[type].length : 0;
}

function popStockItem(type, deliveredMeta = {}) {
  const stock = ensureStockShape();
  if (!stock[type] || !stock[type].length) return null;

  const item = stock[type].shift();
  const link = item.link || item.email || "";
  stock.delivered.push({
    type,
    link,
    delivered_at: new Date().toISOString(),
    ...deliveredMeta
  });

  saveStock(stock).catch((error) => {
    console.error("Failed to save stock:", error.message);
  });
  return item;
}

function stockItemLink(item = {}) {
  return String(item.link || item.email || "").trim();
}

function tutorialKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: "▶️ How To Login Netflix Through Link", callback_data: "how_login_tutorial" }]]
    }
  };
}

function proofKeyboard(includeTutorial = false) {
  const buttons = [];
  if (includeTutorial) {
    buttons.push([{ text: "▶️ How To Login Netflix Through Link", callback_data: "how_login_tutorial" }]);
  }
  buttons.push([{ text: "📸 Send Proof", callback_data: "send_proof" }]);

  return {
    reply_markup: {
      inline_keyboard: buttons
    }
  };
}

async function notifyNewUserIfNeeded(user, options = {}) {
  if (user.newUserNotified) return;
  const totalUsersCount = typeof options.totalUsersCount === "number" ? options.totalUsersCount : totalUsers();

  logToChannel(
    [
      "New User Notification",
      "",
      `User: ${user.name}${user.username ? `\n@${user.username}` : ""}`,
      `User ID: ${user.id}`,
      `Total Users: ${totalUsersCount}`
    ].join("\n")
  );

  user.newUserNotified = true;
  await saveUsers();
}

// ========= START =========
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const id = String(msg.from.id);
  const name = msg.from.first_name || "User";
  const username = msg.from.username || "";
  const refId = match && match[1] ? String(match[1]).trim() : null;

  const { user, created } = getUser(id, name, username);
  user.name = name;
  user.username = username;

  if (refId && refId !== id && users[refId] && !user.referredBy) {
    user.referredBy = refId;
  }

  await saveUsers();

  await sendPhotoSafe(
    id,
    START_PHOTO,
    `🫡 <b>WELCOME ${safeName(name)}</b>

━━━━━━━━━━━━━━━━━━
🌀 <b>JOIN ALL CHANNELS AND CLICK ON JOINED TO START OUR BOT</b> ✅
━━━━━━━━━━━━━━━━━━`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🌟 Main Channel", url: CHANNEL_MAIN || "https://t.me" },
            { text: "🔥 Join 1", url: CHANNEL_1 || "https://t.me" },
            { text: "🎯 Join 2", url: CHANNEL_2 || "https://t.me" }
          ],
          [
            { text: "🚀 Join 3", url: CHANNEL_3 || "https://t.me" },
            { text: "💎 Join 4", url: CHANNEL_4 || "https://t.me" }
          ],
          [{ text: "💎 [ JOINED ] ✨", callback_data: "joined_btn" }]
        ]
      }
    }
  );
});

// ========= CALLBACKS =========
bot.on("callback_query", async (query) => {
  const id = String(query.from.id);
  const name = query.from.first_name || "User";
  const username = query.from.username || "";

  const { user } = getUser(id, name, username);
  user.name = name;
  user.username = username;
  await saveUsers();

  if (query.data === "joined_btn") {
    const ok = await checkJoin(id);

    if (!ok) {
      await bot.answerCallbackQuery(query.id, {
        text: "Join required channel first",
        show_alert: true
      });
      return;
    }

    const wasJoined = Boolean(user.joined);

    if (user.referredBy && !user.refRewardGiven && users[user.referredBy]) {
      users[user.referredBy].points += REFER_POINTS;
      users[user.referredBy].refers += 1;
      user.refRewardGiven = true;
      await saveUsers();

      bot.sendMessage(
        user.referredBy,
        `🎉 New referral completed join!\n👤 ${escapeHtml(user.name)}\n💰 +${REFER_POINTS} point added`,
        htmlOptions()
      ).catch(() => {});
    }

    user.joined = true;
    await saveUsers();

    if (!wasJoined) {
      await notifyNewUserIfNeeded(user, { totalUsersCount: totalUsers() });
    }

    await bot.answerCallbackQuery(query.id, { text: "Joined checked ✅" });

    return sendPhotoSafe(
      id,
      START_PHOTO,
      `🎉 <b>HEY ${safeName(user.name)}</b>

━━━━━━━━━━━━━━━━━━
🎬 <b>WELCOME TO NETFLIX PREMIUM ACCOUNT BOT MAIN MENU</b> 💎

🛡️ <b>REFER YOUR FRIENDS TO GET NETFLIX PREMIUM ACCOUNT</b> ✅
━━━━━━━━━━━━━━━━━━

⚡ Best Netflix Bot in Whole Telegram`,
      mainMenu()
    );
  }

  if (query.data === "wd_cancel") {
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(id, "❌ Withdraw cancelled.", htmlOptions(mainMenu()));
  }

  if (query.data === "how_login_tutorial") {
    await bot.answerCallbackQuery(query.id, { text: "Tutorial sending..." });
    return sendVideoSafe(
      id,
      LOGIN_TUTORIAL_VIDEO,
      "▶️ <b>How To Login Netflix Through Link</b>\n\nIs video ko dekh kar apna Netflix login complete karo.",
      mainMenu()
    );
  }

  if (query.data === "send_proof") {
    user.awaitingProof = true;
    await saveUsers();
    await bot.answerCallbackQuery(query.id, { text: "Proof bhejo" });
    return bot.sendMessage(
      id,
      "📸 <b>Proofs must send after claiming.</b>\n\nAb apna screenshot, photo, ya video proof bhejo. Main usse proof channel me post kar dunga.",
      htmlOptions(mainMenu())
    );
  }

  if (query.data === "wd_premium") {
    await bot.answerCallbackQuery(query.id);

    if (user.points < WITHDRAW_PREMIUM_POINTS) {
      return bot.sendMessage(
        id,
        `✅ <b>Insufficient Points</b> 💎

🔴 You need <b>${WITHDRAW_PREMIUM_POINTS} points</b> to redeem this reward.
🎬 Earn more by inviting friends!`,
        htmlOptions(mainMenu())
      );
    }

    const item = popStockItem("premium", {
      user_id: user.id,
      user_name: user.name,
      username: user.username || ""
    });

    if (!item) {
      return bot.sendMessage(
        id,
        `❌ <b>Out of stock</b>

Premium items are currently unavailable.`,
        htmlOptions(mainMenu())
      );
    }

    user.points -= WITHDRAW_PREMIUM_POINTS;
    user.lastClaimType = "premium";
    user.awaitingProof = false;
    user.submittedMail = "";
    await saveUsers();

    const premiumLink = stockItemLink(item);

    logToChannel(
      [
        "Auto Delivery Done",
        "",
        `User: ${user.name}${user.username ? `\n@${user.username}` : ""}`,
        `User ID: ${user.id}`,
        "Item: Premium"
      ].join("\n")
    );

    return bot.sendMessage(
      id,
      `✅ <b>Delivery successful!</b>

🔗 <b>Netflix Link:</b>
${code(premiumLink)}

💎 Used: ${WITHDRAW_PREMIUM_POINTS} points

📌 Niche wale button se tutorial dekh lo.`,
      htmlOptions(proofKeyboard(true))
    );

  }

  if (query.data === "wd_mail") {
    await bot.answerCallbackQuery(query.id);

    if (user.points < WITHDRAW_MAIL_POINTS) {
      return bot.sendMessage(
        id,
        `✅ <b>Insufficient Points</b> 💎

🔴 You need <b>${WITHDRAW_MAIL_POINTS} points</b> to redeem this reward.
🎬 Earn more by inviting friends!`,
        htmlOptions(mainMenu())
      );
    }

    user.points -= WITHDRAW_MAIL_POINTS;
    user.awaitingMailSubmission = true;
    user.awaitingProof = false;
    user.lastClaimType = "mail";
    user.submittedMail = "";
    await saveUsers();

    return bot.sendMessage(
      id,
      `✅ <b>On Mail claim started.</b>

💎 Used: ${WITHDRAW_MAIL_POINTS} points
📩 Ab apna mail address bhejo.

📌 Proofs must send after claiming.`,
      htmlOptions(proofKeyboard(false))
    );

  }
});

// ========= MESSAGE HANDLER =========
bot.on("message", async (msg) => {
  const user = updateUser(msg);
  const text = typeof msg.text === "string" ? msg.text.trim() : "";

  if (user.awaitingProof) {
    const proofCaption = [
      "New Claim Proof",
      "",
      `User: ${user.name}${user.username ? `\n@${user.username}` : ""}`,
      `User ID: ${user.id}`,
      `Claim Type: ${user.lastClaimType || "N/A"}`,
      user.submittedMail ? `Submitted Mail: ${user.submittedMail}` : ""
    ]
      .filter(Boolean)
      .join("\n");

    try {
      if (msg.photo && msg.photo.length) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        if (PROOF_CHANNEL) await bot.sendPhoto(PROOF_CHANNEL, fileId, htmlOptions({ caption: proofCaption }));
      } else if (msg.video) {
        if (PROOF_CHANNEL) await bot.sendVideo(PROOF_CHANNEL, msg.video.file_id, htmlOptions({ caption: proofCaption }));
      } else if (msg.document) {
        if (PROOF_CHANNEL) await bot.sendDocument(PROOF_CHANNEL, msg.document.file_id, htmlOptions({ caption: proofCaption }));
      } else if (text) {
        if (PROOF_CHANNEL) await bot.sendMessage(PROOF_CHANNEL, `${proofCaption}\n\nProof Text:\n${escapeHtml(text)}`, htmlOptions());
      } else {
        return bot.sendMessage(msg.chat.id, "❌ Proof ke liye screenshot, photo, video, document, ya text bhejo.", htmlOptions(mainMenu()));
      }

      user.awaitingProof = false;
      await saveUsers();
      return bot.sendMessage(msg.chat.id, "✅ Proof received. Proof channel me post kar diya gaya hai.", htmlOptions(mainMenu()));
    } catch (error) {
      console.error("Failed to send proof:", error.message);
      return bot.sendMessage(msg.chat.id, "❌ Proof send nahi hua. Dobara try karo.", htmlOptions(mainMenu()));
    }
  }

  if (user.awaitingMailSubmission && text && !text.startsWith("/")) {
    user.awaitingMailSubmission = false;
    user.submittedMail = text;
    user.awaitingProof = true;
    await saveUsers();

    logToChannel(
      [
        "On Mail Claim Submitted",
        "",
        `User: ${user.name}${user.username ? `\n@${user.username}` : ""}`,
        `User ID: ${user.id}`,
        `Mail: ${text}`,
        `Used Points: ${WITHDRAW_MAIL_POINTS}`
      ].join("\n")
    );

    return bot.sendMessage(
      msg.chat.id,
      `✅ <b>Mail submitted successfully!</b>

📩 <b>Your Mail:</b> ${code(text)}
💎 Used: ${WITHDRAW_MAIL_POINTS} points

📌 Proofs must send after claiming.`,
      htmlOptions(proofKeyboard(false))
    );
  }

  if (!msg.text) return;
  if (msg.text.startsWith("/")) return;

  if (text === "💰 Balance") {
    return sendPhotoSafe(
      msg.chat.id,
      BALANCE_PHOTO,
      `🔔 <b>USER :</b> ${safeName(user.name)}
━━━━━━━━━━━━━━━━━━
💸 <b>YOUR BALANCE :</b> ${user.points}.00
🪪 <b>USER ID :</b> ${code(user.id)}
━━━━━━━━━━━━━━━━━━
📣 <b>REFER AND EARN MORE</b> 📣
━━━━━━━━━━━━━━━━━━`,
      mainMenu()
    );
  }

  if (text === "👥 Refer") {
    try {
      const botUsername = await getBotUsername();
      const refLink = `https://t.me/${botUsername}?start=${user.id}`;

      return sendPhotoSafe(
        msg.chat.id,
        REFER_PHOTO,
        `🛍 <b>TOTAL REFERS = ${user.refers} USER(S)</b>
━━━━━━━━━━━━━━━━━━
🌐 <b>YOUR INVITE LINK =</b>
${escapeHtml(refLink)}
━━━━━━━━━━━━━━━━━━
🚀 <b>REFER TO EARN ${REFER_POINTS} POINT PER INVITE</b> 🔔
━━━━━━━━━━━━━━━━━━`,
        referMenu()
      );
    } catch (error) {
      console.error("Failed to create referral link:", error.message);
      return bot.sendMessage(
        msg.chat.id,
        "❌ Referral link generate nahi hua. Bot username check karo aur phir try karo.",
        htmlOptions(referMenu())
      );
    }
  }

  if (text === "🥰 My Refer") {
    return bot.sendMessage(
      msg.chat.id,
      `🥰 <b>My Refer</b>\n\n👥 Total referrals: <b>${user.refers}</b>`,
      htmlOptions(referMenu())
    );
  }

  if (text === "🌟 Top Lists") {
    return bot.sendMessage(msg.chat.id, topListText(), htmlOptions(referMenu()));
  }

  if (text === "⬅ Back") {
    return sendPhotoSafe(
      msg.chat.id,
      START_PHOTO,
      `🎉 <b>HEY ${safeName(user.name)}</b>

━━━━━━━━━━━━━━━━━━
🎬 <b>WELCOME TO NETFLIX PREMIUM ACCOUNT BOT MAIN MENU</b> 💎

🛡️ <b>REFER YOUR FRIENDS TO GET NETFLIX PREMIUM ACCOUNT</b> ✅
━━━━━━━━━━━━━━━━━━

⚡ Best Netflix Bot in Whole Telegram`,
      mainMenu()
    );
  }

  if (text === "🛒 Withdraw") {
    return sendPhotoSafe(
      msg.chat.id,
      WITHDRAW_PHOTO,
      `📺 <b>EXCHANGE YOUR POINTS FOR NETFLIX ACCOUNTS</b>
━━━━━━━━━━━━━━━━━━
💰 <b>YOUR BALANCE:</b> ${user.points} POINTS
━━━━━━━━━━━━━━━━━━
📦 <b>AVAILABLE REDEEMS:</b>
✨ <b>NETFLIX PREMIUM</b> — ${WITHDRAW_PREMIUM_POINTS} POINTS
📧 <b>NETFLIX ON MAIL</b> — ${WITHDRAW_MAIL_POINTS} POINTS
━━━━━━━━━━━━━━━━━━`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: `✨ Netflix Premium (${WITHDRAW_PREMIUM_POINTS} pts)`, callback_data: "wd_premium" }],
            [{ text: `🎉 Netflix on Mail (${WITHDRAW_MAIL_POINTS} pts)`, callback_data: "wd_mail" }],
            [{ text: "❌ Cancel", callback_data: "wd_cancel" }]
          ]
        }
      }
    );
  }

  if (text === "🆘 Support") {
    return bot.sendMessage(
      msg.chat.id,
      `🆘 <b>SUPPORT</b>\n\nContact Owner 👉 ${escapeHtml(ownerMention())}`,
      htmlOptions(mainMenu())
    );
  }

  if (text === "🤔 Proofs") {
    return bot.sendMessage(
      msg.chat.id,
      `✨ Join :- ${escapeHtml(PROOF_CHANNEL || "Proof channel not set")} To Check Proofs 🐘`,
      htmlOptions(mainMenu())
    );
  }

  if (text === "🎁 Gift Code") {
    return sendPhotoSafe(
      msg.chat.id,
      GIFT_PHOTO,
      `✅ <b>USER:</b> ${escapeHtml(user.name)}!

🍿 <b>Welcome to Netflix Bot</b>

🎯 Redeem your code to get points!

Use:
${code("/redeem CODE123")}

⏱ Cooldown: 10 minutes

✅ <b>NOTE:</b> Each code can be redeemed only once.

🤝 <b>Fast, Simple & Reliable.</b>`,
      mainMenu()
    );
  }

  if (text === "📦 Stock") {
    const premiumCount = stockCount("premium");
    const mailCount = stockCount("mail");
    const deliveredCount = stockCount("delivered");

    return bot.sendMessage(
      msg.chat.id,
      `📦 <b>STOCK STATUS</b>

✨ Premium: <b>${premiumCount}</b>
📧 Mail: <b>${mailCount}</b>
📤 Delivered History: <b>${deliveredCount}</b>`,
      htmlOptions(mainMenu())
    );
  }

  if (text === "👑 Admin Panel") {
    if (!isOwner(msg)) {
      return bot.sendMessage(msg.chat.id, "❌ Access denied");
    }

    return bot.sendMessage(msg.chat.id, "👑 ADMIN PANEL", adminMenu());
  }

  if (text === "➕ Add Points") {
    if (!isOwner(msg)) return;
    return bot.sendMessage(
      msg.chat.id,
      `Send like:

${code("/addpoints userId amount")}

Example:
${code("/addpoints 123456789 50")}`,
      htmlOptions()
    );
  }

  if (text === "🎁 Create Code") {
    if (!isOwner(msg)) return;
    return bot.sendMessage(
      msg.chat.id,
      `Send like:

${code("/gencode CODE POINTS")}

Example:
${code("/gencode FREE50 50")}`,
      htmlOptions()
    );
  }

  if (text === "📦 Add Stock") {
    if (!isOwner(msg)) return;
    return bot.sendMessage(
      msg.chat.id,
      `Use these commands:

Single add:
${code("/addstock premium https://your-netflix-link")}
${code("/addstock mail https://your-netflix-link")}

Bulk add:
${code("/addstockbulk premium\nhttps://link1\nhttps://link2")}

Types allowed: premium, mail`,
      htmlOptions()
    );
  }

  if (text === "📊 Stock View") {
    if (!isOwner(msg)) return;

    const stock = ensureStockShape();
    const premiumPreview =
      stock.premium.slice(0, 5).map((x, i) => `${i + 1}. ${escapeHtml(stockItemLink(x))}`).join("\n") || "No premium stock";
    const mailPreview =
      stock.mail.slice(0, 5).map((x, i) => `${i + 1}. ${escapeHtml(stockItemLink(x))}`).join("\n") || "No mail stock";

    return bot.sendMessage(
      msg.chat.id,
      `📦 <b>STOCK VIEW</b>

✨ <b>Premium Count:</b> ${stock.premium.length}
${premiumPreview}

📧 <b>Mail Count:</b> ${stock.mail.length}
${mailPreview}

📤 <b>Delivered Count:</b> ${stock.delivered.length}`,
      htmlOptions()
    );
  }

  if (text === "🗑 Remove Stock") {
    if (!isOwner(msg)) return;
    return bot.sendMessage(
      msg.chat.id,
      `Use:

${code("/removestock premium 1")}
${code("/removestock mail 2")}

Index starts from 1.`,
      htmlOptions()
    );
  }

  if (text === "📤 Delivered History") {
    if (!isOwner(msg)) return;

    const stock = ensureStockShape();
    const last = stock.delivered.slice(-10).reverse();

    if (!last.length) {
      return bot.sendMessage(msg.chat.id, "No delivered history yet.");
    }

    let output = "<b>DELIVERED HISTORY (Last 10)</b>\n\n";
    last.forEach((item, index) => {
      output += `${index + 1}. [${escapeHtml(item.type)}] ${escapeHtml(stockItemLink(item))}\nUser ID: ${escapeHtml(item.user_id || "N/A")}\nDate: ${escapeHtml(item.delivered_at)}\n\n`;
    });

    return bot.sendMessage(msg.chat.id, output, htmlOptions());
  }

  if (text === "📘 How To Use") {
    if (!isOwner(msg)) return;

    return bot.sendMessage(
      msg.chat.id,
      `📘 <b>ADMIN PANEL GUIDE</b>

👑 <b>Admin Panel Buttons</b>
➕ <b>Add Points</b>
Shows format to add points to a user

🎁 <b>Create Code</b>
Shows format to create a redeem code

📦 <b>Add Stock</b>
Shows single and bulk stock add formats

📊 <b>Stock View</b>
Shows current premium, mail, and delivered stock

🗑 <b>Remove Stock</b>
Shows how to remove stock by index

📤 <b>Delivered History</b>
Shows last delivered items

📊 <b>Stats</b>
Shows total users and total codes

━━━━━━━━━━━━━━━━━━
⌨ <b>Admin Commands</b>

1. <b>Add points to user</b>
${code("/addpoints userId amount")}

2. <b>Create redeem code</b>
${code("/gencode CODE POINTS")}

3. <b>Single stock add</b>
${code("/addstock premium https://your-netflix-link")}
${code("/addstock mail https://your-netflix-link")}

4. <b>Bulk stock add</b>
${code("/addstockbulk premium\nhttps://link1\nhttps://link2")}

5. <b>View stock</b>
${code("/stockview")}

6. <b>Remove stock</b>
${code("/removestock premium 1")}
${code("/removestock mail 2")}

7. <b>Delivered history</b>
${code("/deliveredhistory")}

8. <b>Text broadcast</b>
${code("/broadcast Hello everyone")}

9. <b>Button broadcast</b>
${code("/bbutton Message | Button Name | Link")}

10. <b>Photo + button broadcast</b>
${code("/bphoto Caption | Button Name | Link")}

━━━━━━━━━━━━━━━━━━
📝 <b>Notes</b>
- premium / mail are stock types
- remove stock index starts from 1
- only owner can use admin commands
- refer reward is given only after join check passes`,
      htmlOptions()
    );
  }

  if (text === "📊 Stats") {
    if (!isOwner(msg)) return;
    return bot.sendMessage(
      msg.chat.id,
      `📊 BOT STATS

👤 Total Users: ${Object.keys(users).length}
🎁 Total Codes: ${Object.keys(codes).length}`
    );
  }
});

// ========= REDEEM =========
bot.onText(/\/redeem (.+)/, (msg, match) => {
  const user = updateUser(msg);
  const redeemCode = String(match[1]).trim().toUpperCase();

  if (!codes[redeemCode]) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid gift code.", mainMenu());
  }

  if (user.redeemed.includes(redeemCode)) {
    return bot.sendMessage(msg.chat.id, "❌ You already used this code.", mainMenu());
  }

  user.points += Number(codes[redeemCode]);
  user.redeemed.push(redeemCode);
  saveCodes().catch((error) => {
    console.error("Failed to save codes:", error.message);
  });
  saveUsers().catch((error) => {
    console.error("Failed to save users:", error.message);
  });

  logToChannel(
    [
      "Gift Code Redeemed",
      "",
      `User: ${user.name}${user.username ? `\n@${user.username}` : ""}`,
      `User ID: ${user.id}`,
      `Code: ${redeemCode}`,
      `Added: ${codes[redeemCode]} points`
    ].join("\n")
  );

  bot.sendMessage(
    msg.chat.id,
    `✅ Code redeemed successfully!\n💰 +${codes[redeemCode]} points added.`,
    mainMenu()
  );
});

// ========= ADMIN BASIC COMMANDS =========
bot.onText(/\/addpoints (\d+) (\d+)/, (msg, match) => {
  if (!isOwner(msg)) return;

  const targetId = String(match[1]);
  const points = Number(match[2]);

  if (!users[targetId]) {
    return bot.sendMessage(msg.chat.id, "❌ User not found.");
  }

  users[targetId].points += points;
  saveUsers().catch((error) => {
    console.error("Failed to save users:", error.message);
  });

  bot.sendMessage(msg.chat.id, `✅ Added ${points} points to ${targetId}`);
  bot.sendMessage(targetId, `🎉 Admin added ${points} points to your balance.`).catch(() => {});
});

bot.onText(/\/gencode (.+) (\d+)/, (msg, match) => {
  if (!isOwner(msg)) return;

  const giftCode = String(match[1]).trim().toUpperCase();
  const points = Number(match[2]);

  codes[giftCode] = points;
  saveCodes().catch((error) => {
    console.error("Failed to save codes:", error.message);
  });

  bot.sendMessage(
    msg.chat.id,
    `✅ Redeem code created

🎁 Code: ${giftCode}
💰 Points: ${points}`
  );
});

// ========= STOCK COMMANDS =========
bot.onText(/\/addstock (premium|mail) (.+)/, (msg, match) => {
  if (!isOwner(msg)) return;

  const type = match[1];
  const link = match[2].trim();

  const stock = ensureStockShape();
  if (!link) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid link.");
  }

  stock[type].push({ link });
  saveStock(stock).catch((error) => {
    console.error("Failed to save stock:", error.message);
  });

  bot.sendMessage(msg.chat.id, `✅ Stock added to ${type}`);
});

bot.onText(/\/addstockbulk (premium|mail)\n([\s\S]+)/, (msg, match) => {
  if (!isOwner(msg)) return;

  const type = match[1];
  const lines = match[2]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const stock = ensureStockShape();
  let added = 0;

  for (const line of lines) {
    const link = line.trim();

    if (!link) continue;

    stock[type].push({ link });
    added += 1;
  }

  saveStock(stock).catch((error) => {
    console.error("Failed to save stock:", error.message);
  });
  bot.sendMessage(msg.chat.id, `✅ Bulk stock added to ${type}: ${added}`);
});

bot.onText(/\/stockview/, (msg) => {
  if (!isOwner(msg)) return;

  const stock = ensureStockShape();
  const premiumPreview =
    stock.premium.slice(0, 10).map((x, i) => `${i + 1}. ${escapeHtml(stockItemLink(x))}`).join("\n") || "No premium stock";
  const mailPreview =
    stock.mail.slice(0, 10).map((x, i) => `${i + 1}. ${escapeHtml(stockItemLink(x))}`).join("\n") || "No mail stock";

  bot.sendMessage(
    msg.chat.id,
    `📦 <b>STOCK VIEW</b>

✨ <b>Premium Count:</b> ${stock.premium.length}
${premiumPreview}

📧 <b>Mail Count:</b> ${stock.mail.length}
${mailPreview}

📤 <b>Delivered Count:</b> ${stock.delivered.length}`,
    htmlOptions()
  );
});

bot.onText(/\/removestock (premium|mail) (\d+)/, (msg, match) => {
  if (!isOwner(msg)) return;

  const type = match[1];
  const index = Number(match[2]) - 1;
  const stock = ensureStockShape();

  if (!stock[type][index]) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid stock index.");
  }

  const removed = stock[type].splice(index, 1)[0];
  saveStock(stock).catch((error) => {
    console.error("Failed to save stock:", error.message);
  });

  bot.sendMessage(
    msg.chat.id,
    `✅ Removed from ${type}\n🔗 ${stockItemLink(removed)}`
  );
});

bot.onText(/\/deliveredhistory/, (msg) => {
  if (!isOwner(msg)) return;

  const stock = ensureStockShape();
  const last = stock.delivered.slice(-20).reverse();

  if (!last.length) {
    return bot.sendMessage(msg.chat.id, "No delivered history yet.");
  }

  let output = "<b>DELIVERED HISTORY (Last 20)</b>\n\n";
  last.forEach((item, index) => {
    output += `${index + 1}. [${escapeHtml(item.type)}] ${escapeHtml(stockItemLink(item))}\nUser ID: ${escapeHtml(item.user_id || "N/A")}\nDate: ${escapeHtml(item.delivered_at)}\n\n`;
  });

  bot.sendMessage(msg.chat.id, output, htmlOptions());
});

bot.onText(/\/adminhelp/, (msg) => {
  if (!isOwner(msg)) return;

  bot.sendMessage(
    msg.chat.id,
    `📘 <b>ADMIN HELP</b>

➕ Add Points
${code("/addpoints userId amount")}

🎁 Create Code
${code("/gencode CODE POINTS")}

📦 Add Stock
${code("/addstock premium https://your-netflix-link")}
${code("/addstock mail https://your-netflix-link")}

📦 Bulk Add Stock
${code("/addstockbulk premium\nhttps://link1\nhttps://link2")}

📊 Stock View
${code("/stockview")}

🗑 Remove Stock
${code("/removestock premium 1")}

📤 Delivered History
${code("/deliveredhistory")}

📢 Broadcast
${code("/broadcast Hello everyone")}

🔘 Button Broadcast
${code("/bbutton Message | Button | Link")}

📸 Photo Broadcast
${code("/bphoto Caption | Button | Link")}`,
    htmlOptions()
  );
});

// ========= BROADCAST =========
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (!isOwner(msg)) return;

  const text = match[1];
  const allUsers = Object.keys(users);
  let success = 0;
  let failed = 0;

  const statusMsg = await bot.sendMessage(
    msg.chat.id,
    `📢 Broadcast Started...

👥 Total Users: ${allUsers.length}
⏳ Processing...`
  );

  for (const id of allUsers) {
    try {
      await bot.sendMessage(id, text);
      success += 1;
    } catch {
      failed += 1;
    }
  }

  await bot.editMessageText(
    `📢 <b>Broadcast Completed</b>

👥 Total Users: ${allUsers.length}
✅ Success: ${success}
❌ Failed: ${failed}`,
    {
      chat_id: msg.chat.id,
      message_id: statusMsg.message_id,
      parse_mode: "HTML"
    }
  );
});

bot.onText(/\/bbutton (.+) \| (.+) \| (.+)/, async (msg, match) => {
  if (!isOwner(msg)) return;

  const text = match[1];
  const btnText = match[2];
  const btnLink = match[3];
  const allUsers = Object.keys(users);
  let success = 0;
  let failed = 0;

  const statusMsg = await bot.sendMessage(
    msg.chat.id,
    `📢 Button Broadcast Started...

👥 Total Users: ${allUsers.length}
⏳ Processing...`
  );

  for (const id of allUsers) {
    try {
      await bot.sendMessage(id, text, {
        reply_markup: {
          inline_keyboard: [[{ text: btnText, url: btnLink }]]
        }
      });
      success += 1;
    } catch {
      failed += 1;
    }
  }

  await bot.editMessageText(
    `📢 <b>Button Broadcast Done</b>

👥 Total Users: ${allUsers.length}
✅ Success: ${success}
❌ Failed: ${failed}`,
    {
      chat_id: msg.chat.id,
      message_id: statusMsg.message_id,
      parse_mode: "HTML"
    }
  );
});

bot.onText(/\/bphoto (.+) \| (.+) \| (.+)/, async (msg, match) => {
  if (!isOwner(msg)) return;

  const caption = match[1];
  const btnText = match[2];
  const btnLink = match[3];
  const allUsers = Object.keys(users);
  let success = 0;
  let failed = 0;

  const statusMsg = await bot.sendMessage(
    msg.chat.id,
    `📸 Photo Broadcast Started...

👥 Total Users: ${allUsers.length}
⏳ Processing...`
  );

  for (const id of allUsers) {
    try {
      if (fs.existsSync(BROADCAST_PHOTO) && fs.statSync(BROADCAST_PHOTO).size > 0) {
        await bot.sendPhoto(id, BROADCAST_PHOTO, {
          caption,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: btnText, url: btnLink }]]
          }
        });
      } else {
        await bot.sendMessage(id, caption, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: btnText, url: btnLink }]]
          }
        });
      }
      success += 1;
    } catch {
      failed += 1;
    }
  }

  await bot.editMessageText(
    `📸 <b>Photo Broadcast Done</b>

👥 Total Users: ${allUsers.length}
✅ Success: ${success}
❌ Failed: ${failed}`,
    {
      chat_id: msg.chat.id,
      message_id: statusMsg.message_id,
      parse_mode: "HTML"
    }
  );
});

console.log("Bot running...");

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    const counts = stockCounts();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "x-item-bot",
        users: totalUsers(),
        stock: counts
      })
    );
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("x-item-bot is running.");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Health server listening on port ${PORT}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down...`);
  server.close();

  try {
    await bot.stopPolling();
    await closeStorage();
  } catch (error) {
    console.error("Failed to stop polling cleanly:", error.message);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function startApp() {
  try {
    await initStorage();
    users = getUsers();
    codes = getCodes();
    await bot.startPolling();
    console.log("Telegram polling started.");
  } catch (error) {
    console.error("Failed to start app:", error.message);
    process.exit(1);
  }
}

startApp();

