# Azure Deployment Guide — Linker Pro

**Goal:** Deploy Linker Pro to Azure with one-click GitHub integration. No Docker, no functions, no Cloudflare.

---

## Prerequisites

- Azure for Students account (https://azure.microsoft.com/en-us/free/students/)
- Azure CLI installed: `winget install Microsoft.AzureCLI`
- GitHub repo with your Linker Pro code pushed to `main`

---

## Step 1: Login to Azure

```bash
az login
az account show  # Verify you see your Student Subscription
```

---

## Step 2: Create Resource Group

```bash
az group create \
  --name linker-pro-rg \
  --location eastus
```

---

## Step 3: Create PostgreSQL Flexible Server

```bash
# Create the server (B1ms = cheapest, 1 vCore, 2GB RAM, 32GB storage free)
az postgres flexible-server create \
  --resource-group linker-pro-rg \
  --name linker-pro-db \
  --location eastus \
  --tier Burstable \
  --sku-name Standard_B1ms \
  --storage-size 32 \
  --version 16 \
  --admin-user linkerpro \
  --admin-password "YourStrongPassword123!" \
  --yes

# Save your password somewhere safe!
```

**Wait 5-10 minutes for provisioning to complete.**

### Enable pgvector Extension

```bash
az postgres flexible-server parameter set \
  --resource-group linker-pro-rg \
  --server-name linker-pro-db \
  --name azure.extensions \
  --value "VECTOR,PGCRYPTO"
```

### Allow Azure Services to Connect

```bash
az postgres flexible-server firewall-rule create \
  --resource-group linker-pro-rg \
  --server-name linker-pro-db \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0
```

### Create the Database

```bash
az postgres flexible-server db create \
  --resource-group linker-pro-rg \
  --server-name linker-pro-db \
  --database-name linker_pro
```

### Get Your Connection String

```bash
az postgres flexible-server show-connection-string \
  --server-name linker-pro-db \
  --admin-user linkerpro
```

**Output will look like:**
```
postgresql://linkerpro:YourStrongPassword123!@linker-pro-db.postgres.database.azure.com:5432/linker_pro?sslmode=require
```

**Save this — you'll need it in Step 6.**

---

## Step 4: Create Azure Cache for Redis

```bash
# Create the cache (Basic C0 = 250MB, free tier)
az redis create \
  --resource-group linker-pro-rg \
  --name linker-pro-cache \
  --location eastus \
  --sku Basic \
  --vm-size c0

# Wait 5 minutes for provisioning...
```

### Get Redis Connection Details

```bash
# Get the host/port
az redis show \
  --resource-group linker-pro-rg \
  --name linker-pro-cache

# Get the access key
az redis list-keys \
  --resource-group linker-pro-rg \
  --name linker-pro-cache
```

**You'll see:**
- **Host**: `linker-pro-cache.redis.cache.windows.net`
- **Port**: `6380` (for TLS)
- **Access Key**: (copy the primary key)

---

## Step 5: Create App Service Plan

```bash
az appservice plan create \
  --resource-group linker-pro-rg \
  --name linker-pro-plan \
  --is-linux \
  --sku B1
```

---

## Step 6: Create Backend App Service

```bash
# Create the backend web app
az webapp create \
  --resource-group linker-pro-rg \
  --plan linker-pro-plan \
  --name linker-pro-backend \
  --runtime "NODE|20-lts"

# Enable Always On (required for BullMQ workers + WebSockets)
az webapp config set \
  --resource-group linker-pro-rg \
  --name linker-pro-backend \
  --always-on true

# Enable WebSockets
az webapp config set \
  --resource-group linker-pro-rg \
  --name linker-pro-backend \
  --web-sockets-enabled true
```

### Set Backend Environment Variables

Copy from `azure/env-vars.template`, fill in values, then run:

```bash
az webapp config appsettings set \
  --resource-group linker-pro-rg \
  --name linker-pro-backend \
  --settings \
    NODE_ENV=production \
    PORT=3000 \
    "DATABASE_URL=postgresql://linkerpro:YourStrongPassword123!@linker-pro-db.postgres.database.azure.com:5432/linker_pro?sslmode=require" \
    REDIS_HOST=linker-pro-cache.redis.cache.windows.net \
    REDIS_PORT=6380 \
    REDIS_PASSWORD=YOUR_REDIS_PRIMARY_KEY \
    REDIS_TLS=true \
    "JWT_SECRET=$(openssl rand -base64 32)" \
    "JWT_REFRESH_SECRET=$(openssl rand -base64 32)" \
    "ENCRYPTION_KEY=your-32-character-hex-key-string!!" \
    OPENAI_API_KEY=sk-your-openai-key \
    FRONTEND_URL=https://linker-pro-frontend.azurewebsites.net \
    WEBHOOK_BASE_URL=https://linker-pro-backend.azurewebsites.net/api/v1/webhooks \
    SHOPIFY_CLIENT_ID= \
    SHOPIFY_CLIENT_SECRET= \
    SALLA_CLIENT_ID= \
    SALLA_CLIENT_SECRET= \
    AMAZON_CLIENT_ID= \
    AMAZON_CLIENT_SECRET= \
    AMAZON_IAM_ARN= \
    ZID_CLIENT_ID= \
    ZID_CLIENT_SECRET= \
    "TIKTOK_APP_KEY=" \
    TIKTOK_APP_SECRET= \
    EBAY_CLIENT_ID= \
    EBAY_CLIENT_SECRET= \
    ETSY_API_KEY= \
    ETSY_SHARED_SECRET= \
    WALMART_CLIENT_ID= \
    WALMART_CLIENT_SECRET= \
    MERCADOLIBRE_CLIENT_ID= \
    MERCADOLIBRE_CLIENT_SECRET= \
    ALIEXPRESS_APP_KEY= \
    ALIEXPRESS_APP_SECRET=
```

---

## Step 7: Create Frontend App Service

```bash
az webapp create \
  --resource-group linker-pro-rg \
  --plan linker-pro-plan \
  --name linker-pro-frontend \
  --runtime "NODE|20-lts"

az webapp config appsettings set \
  --resource-group linker-pro-rg \
  --name linker-pro-frontend \
  --settings \
    NODE_ENV=production \
    PORT=3001 \
    "NEXT_PUBLIC_API_URL=https://linker-pro-backend.azurewebsites.net/api/v1"
```

---

## Step 8: Run Database Migrations

Before connecting GitHub, run migrations once:

```bash
cd backend

DATABASE_URL="postgresql://linkerpro:YourStrongPassword123!@linker-pro-db.postgres.database.azure.com:5432/linker_pro?sslmode=require" \
  npx prisma migrate deploy
```

---

## Step 9: Connect GitHub to Backend App Service

### In Azure Portal:

1. Go to **Backend App Service** → **Deployment Center**
2. Click **Source**: choose **GitHub**
3. **Authorize** (sign in with GitHub)
4. **Organization**: select yours
5. **Repository**: select your Linker Pro repo
6. **Branch**: select `main`
7. Click **Save**

Azure will automatically:
- Clone your repo
- Detect Node.js
- Run `npm install`
- Run `npx prisma generate`
- Run `npm run build`
- Start your NestJS server

---

## Step 10: Connect GitHub to Frontend App Service

Same process as Step 9, but for the **Frontend App Service**.

---

## Step 11: Verify Deployment

**Wait 2-5 minutes for first build to complete.**

### Check Backend

```bash
# Visit your backend API
curl https://linker-pro-backend.azurewebsites.net/api/v1/health

# Check Swagger docs
# https://linker-pro-backend.azurewebsites.net/docs
```

### Check Frontend

```bash
# Visit your frontend
# https://linker-pro-frontend.azurewebsites.net
```

### Verify WebSockets & CORS Work

- Frontend should load without CORS errors
- Open browser DevTools → Network → check `/socket.io` is WebSocket
- Real-time inventory alerts should appear instantly

---

## Cost Monitoring

```bash
# View current spending
az billing invoice list --subscription YOUR_SUBSCRIPTION_ID
```

**Expected:** ~$44-57/month (covered by $100/year student credits)

---

## Pushing Updates

From now on, just push to GitHub:

```bash
git add .
git commit -m "Your changes"
git push origin main
```

Azure automatically re-builds and re-deploys.

---

## Troubleshooting

### Build Fails

Check logs in Deployment Center → Logs

### Backend Can't Connect to Database

Verify:
- Connection string is correct (check firewall rule allows Azure services)
- Database exists (`linker_pro`)
- pgvector extension was enabled

### BullMQ Workers Not Running

Check:
- Redis connection string is correct
- `REDIS_TLS=true` is set
- `REDIS_PORT=6380` (not 6379)

### WebSockets Not Working

Check:
- `web-sockets-enabled true` is set on App Service
- Frontend correctly points to backend URL

---

## Costs Breakdown

| Service | Free Tier | Student Credit |
|---|---|---|
| App Service (Backend) | First 60 mins free | $13/mo |
| App Service (Frontend) | First 60 mins free | $13/mo |
| PostgreSQL (32GB) | First 12 months | $15/mo |
| Redis (250MB) | None | $16/mo |
| **Total Annual** | | ~$570/year (covered by $100 credits for ~2 months) |

After credits, you can:
- Reduce VM size or use free tier
- Use Spot instances for backup services
- Or upgrade your student plan

---

**Deployment complete!** 🚀
