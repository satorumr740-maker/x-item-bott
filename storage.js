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
  state.users = readLocalJson(USERS_FILE, {});
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
    state.users = byId.users;
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
