# x-item-bot

Telegram bot ready to deploy on Render with MongoDB-backed storage.

## Local run

```bash
npm install
npm start
```

If `MONGODB_URI` is not set, the bot falls back to local JSON files for development.

## Free hosting setup

### 1. Create a free MongoDB Atlas database

1. Create a free Atlas project and cluster.
2. Create a database user with username and password.
3. In Network Access, allow your Render service to connect.
4. Copy the Node.js connection string and put it in `MONGODB_URI`.

### 2. Deploy on Render

1. Push this project to GitHub.
2. In Render, create a new `Web Service`.
3. Connect your GitHub repo.
4. Render will detect `render.yaml` automatically.
5. Add all variables from `.env.example` in Render environment settings.
6. Make sure `MONGODB_URI` and `MONGODB_DB_NAME` are set.
7. Deploy the service.

## Data migration

- On first startup with MongoDB enabled, the bot imports existing local `users.json`, `codes.json`, and `stock.json` data into MongoDB automatically.
- After that, MongoDB becomes the main storage for users, gift codes, and stock history.

## Important Render notes

- This bot uses Telegram polling, so it needs the web service to stay awake.
- Render free web services spin down after inactivity, so the bot can pause until the next request wakes it up.
- The app now exposes `/health` for Render health checks.
- Render free instances still have ephemeral local files, so MongoDB is required for real persistence.
