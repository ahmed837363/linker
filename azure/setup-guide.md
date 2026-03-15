# Azure Setup Guide — Linker Pro

## Prerequisites
- Azure for Students account (activated at https://azure.microsoft.com/en-us/free/students/)
- Azure CLI installed (`winget install Microsoft.AzureCLI`)
- Docker Desktop installed
- GitHub repository created

---

## Step 1: Login to Azure CLI

```bash
az login
az account show  # Verify you see your student subscription
```

---

## Step 2: Create Resource Group

```bash
az group create --name linker-pro-rg --location eastus
```

---

## Step 3: Create PostgreSQL Flexible Server

```bash
# Create the server (B1ms = cheapest, 1 vCore, 2GB RAM, 32GB storage)
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

# Enable pgvector extension
az postgres flexible-server parameter set \
  --resource-group linker-pro-rg \
  --server-name linker-pro-db \
  --name azure.extensions \
  --value "VECTOR,PGCRYPTO"

# Allow Azure services to connect
az postgres flexible-server firewall-rule create \
  --resource-group linker-pro-rg \
  --name linker-pro-db \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0

# Create the database
az postgres flexible-server db create \
  --resource-group linker-pro-rg \
  --server-name linker-pro-db \
  --database-name linker_pro
```

**Connection string:**
```
postgresql://linkerpro:YourStrongPassword123!@linker-pro-db.postgres.database.azure.com:5432/linker_pro?sslmode=require
```

---

## Step 4: Create Redis Cache

```bash
az redis create \
  --resource-group linker-pro-rg \
  --name linker-pro-cache \
  --location eastus \
  --sku Basic \
  --vm-size C0

# Get the access key (takes ~15 min to provision)
az redis list-keys \
  --resource-group linker-pro-rg \
  --name linker-pro-cache
```

---

## Step 5: Create App Service Plan

```bash
# B1 plan for Linux containers
az appservice plan create \
  --resource-group linker-pro-rg \
  --name linker-pro-plan \
  --is-linux \
  --sku B1
```

---

## Step 6: Create Backend App Service

```bash
# Create the web app (Docker container)
az webapp create \
  --resource-group linker-pro-rg \
  --plan linker-pro-plan \
  --name linker-pro-backend \
  --deployment-container-image-name ghcr.io/YOUR_GITHUB_USER/linker-pro/backend:latest

# Enable Always On (required for WebSockets + BullMQ workers)
az webapp config set \
  --resource-group linker-pro-rg \
  --name linker-pro-backend \
  --always-on true

# Enable WebSockets
az webapp config set \
  --resource-group linker-pro-rg \
  --name linker-pro-backend \
  --web-sockets-enabled true

# Set environment variables
az webapp config appsettings set \
  --resource-group linker-pro-rg \
  --name linker-pro-backend \
  --settings \
    NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL="postgresql://linkerpro:YourStrongPassword123!@linker-pro-db.postgres.database.azure.com:5432/linker_pro?sslmode=require" \
    REDIS_HOST="linker-pro-cache.redis.cache.windows.net" \
    REDIS_PORT=6380 \
    REDIS_PASSWORD="YOUR_REDIS_ACCESS_KEY" \
    JWT_SECRET="generate-a-random-32-char-string" \
    JWT_REFRESH_SECRET="generate-another-random-string" \
    ENCRYPTION_KEY="generate-a-32-byte-key" \
    OPENAI_API_KEY="sk-your-key" \
    FRONTEND_URL="https://linker-pro-frontend.azurewebsites.net" \
    WEBHOOK_BASE_URL="https://linker-pro-backend.azurewebsites.net/api/v1/webhooks"
```

---

## Step 7: Create Frontend App Service

```bash
az webapp create \
  --resource-group linker-pro-rg \
  --plan linker-pro-plan \
  --name linker-pro-frontend \
  --deployment-container-image-name ghcr.io/YOUR_GITHUB_USER/linker-pro/frontend:latest

az webapp config appsettings set \
  --resource-group linker-pro-rg \
  --name linker-pro-frontend \
  --settings \
    NEXT_PUBLIC_API_URL="https://linker-pro-backend.azurewebsites.net/api/v1"
```

---

## Step 8: Set Up GitHub Actions Secrets

Go to your GitHub repo → Settings → Secrets and variables → Actions, then add:

| Secret Name | Value |
|---|---|
| `AZURE_CREDENTIALS` | Output of `az ad sp create-for-rbac --name linker-pro-deploy --role contributor --scopes /subscriptions/YOUR_SUB_ID/resourceGroups/linker-pro-rg --json-auth` |
| `AZURE_DATABASE_URL` | Your PostgreSQL connection string |

---

## Step 9: Run Initial Database Migration

```bash
cd backend
DATABASE_URL="postgresql://linkerpro:YourStrongPassword123!@linker-pro-db.postgres.database.azure.com:5432/linker_pro?sslmode=require" \
  npx prisma migrate deploy
```

---

## Step 10: Deploy

Push to main branch — GitHub Actions handles the rest:
```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

---

## URLs After Deployment

| Service | URL |
|---|---|
| Frontend | `https://linker-pro-frontend.azurewebsites.net` |
| Backend API | `https://linker-pro-backend.azurewebsites.net/api/v1` |
| Swagger Docs | `https://linker-pro-backend.azurewebsites.net/docs` |

---

## Custom Domain (Optional)

```bash
# Add your custom domain
az webapp config hostname add \
  --resource-group linker-pro-rg \
  --webapp-name linker-pro-frontend \
  --hostname app.linkerpro.com

# Enable free SSL
az webapp config ssl bind \
  --resource-group linker-pro-rg \
  --name linker-pro-frontend \
  --certificate-thumbprint THUMB \
  --ssl-type SNI
```

---

## Cost Monitoring

Check your spending at https://portal.azure.com/#view/Microsoft_Azure_CostManagement.

Expected: ~$44-57/month. Set a budget alert:
```bash
az consumption budget create \
  --amount 60 \
  --budget-name linker-pro-budget \
  --category cost \
  --time-grain monthly \
  --resource-group linker-pro-rg
```
