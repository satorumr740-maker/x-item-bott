require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const USERS_FILE = path.join(__dirname, "users.json");
const CODES_FILE = path.join(__dirname, "codes.json");
const STOCK_FILE = path.join(__dirname, "stock.json");

function defaultStock() {
  return {
    premium: [],
    mail: [],
    delivered: []
  };
}

function ensureLocalJsonFile(file, fallback) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, fallback, "utf8");
  }
}

function readLocalJson(file, fallback) {
  ensureLocalJsonFile(file, JSON.stringify(fallback, null, 2));
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`Failed to parse JSON file: ${file}`, error.message);
    return fallback;
  }
}

function writeLocalJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function normalizeStock(value) {
  const stock = value && typeof value === "object" ? value : {};
  if (!Array.isArray(stock.premium)) stock.premium = [];
  if (!Array.isArray(stock.mail)) stock.mail = [];
  if (!Array.isArray(stock.delivered)) stock.delivered = [];
  return stock;
}

function normalizeUsers(value) {
  const users = value && typeof value === "object" ? value : {};

  for (const key of Object.keys(users)) {
    const user = users[key] && typeof users[key] === "object" ? users[key] : {};

    user.id = String(user.id || key);
    user.name = user.name || "User";
    user.username = user.username || "";
    user.points = Number(user.points || 0);
    user.refers = Number(user.refers || 0);
    user.referredBy = user.referredBy ? String(user.referredBy) : null;
    user.refRewardGiven = Boolean(user.refRewardGiven);
    user.redeemed = Array.isArray(user.redeemed) ? user.redeemed : [];
    user.awaitingMailSubmission = Boolean(user.awaitingMailSubmission);
    user.awaitingProof = Boolean(user.awaitingProof);
    user.lastClaimType = user.lastClaimType || null;
    user.submittedMail = user.submittedMail || "";

    if (typeof user.joined !== "boolean") {
      user.joined = Boolean(user.refRewardGiven || user.points > 0 || user.refers > 0 || user.redeemed.length > 0);
    }

    users[key] = user;
  }

  return users;
}

const state = {
  users: {},
  codes: {},
  stock: defaultStock()
};

let mode = "local";
let client = null;
let collection = null;
let writeQueue = Promise.resolve();

function queueWrite(task) {
  writeQueue = writeQueue
    .then(task)
    .catch((error) => {
      console.error("Storage write failed:", error.message);
      throw error;
    });

  return writeQueue;
}

async function persistDocument(id, value) {
  if (mode === "mongo") {
    await collection.updateOne(
      { _id: id },
      {
        $set: {
          value,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
    return;
  }

  if (id === "users") {
    writeLocalJson(USERS_FILE, value);
    return;
  }

  if (id === "codes") {
    writeLocalJson(CODES_FILE, value);
    return;
  }

  if (id === "stock") {
    writeLocalJson(STOCK_FILE, normalizeStock(value));
  }
}

async function initStorage() {
  state.users = normalizeUsers(readLocalJson(USERS_FILE, {}));
  state.codes = readLocalJson(CODES_FILE, {});
  state.stock = normalizeStock(readLocalJson(STOCK_FILE, defaultStock()));

  const mongoUri = (process.env.MONGODB_URI || "").trim();
  const dbName = (process.env.MONGODB_DB_NAME || "x_item_bot").trim();

  if (!mongoUri) {
    console.log("Storage mode: local JSON");
    return {
      mode,
      migratedFromLocal: false
    };
  }

  client = new MongoClient(mongoUri);
  await client.connect();
  collection = client.db(dbName).collection("state");
  mode = "mongo";

  const docs = await collection
    .find({ _id: { $in: ["users", "codes", "stock"] } })
    .toArray();

  const byId = Object.fromEntries(docs.map((doc) => [doc._id, doc.value]));
  let migratedFromLocal = false;

  if (byId.users && typeof byId.users === "object") {
    state.users = normalizeUsers(byId.users);
  } else {
    await persistDocument("users", state.users);
    migratedFromLocal = migratedFromLocal || Object.keys(state.users).length > 0;
  }

  if (byId.codes && typeof byId.codes === "object") {
    state.codes = byId.codes;
  } else {
    await persistDocument("codes", state.codes);
    migratedFromLocal = migratedFromLocal || Object.keys(state.codes).length > 0;
  }

  if (byId.stock && typeof byId.stock === "object") {
    state.stock = normalizeStock(byId.stock);
  } else {
    await persistDocument("stock", state.stock);
    migratedFromLocal =
      migratedFromLocal ||
      state.stock.premium.length > 0 ||
      state.stock.mail.length > 0 ||
      state.stock.delivered.length > 0;
  }

  console.log(`Storage mode: MongoDB (${dbName})`);

  if (migratedFromLocal) {
    console.log("Local JSON data imported into MongoDB.");
  }

  return {
    mode,
    migratedFromLocal
  };
}

function getUsers() {
  return state.users;
}

function getCodes() {
  return state.codes;
}

function getStock() {
  return state.stock;
}

function saveUsers() {
  return queueWrite(() => persistDocument("users", state.users));
}

function saveCodes() {
  return queueWrite(() => persistDocument("codes", state.codes));
}

function saveStock(stock = state.stock) {
  state.stock = normalizeStock(stock);
  return queueWrite(() => persistDocument("stock", state.stock));
}

async function closeStorage() {
  try {
    await writeQueue.catch(() => {});
  } finally {
    if (client) {
      await client.close();
    }
  }
}

module.exports = {
  initStorage,
  getUsers,
  getCodes,
  getStock,
  saveUsers,
  saveCodes,
  saveStock,
  closeStorage
};
