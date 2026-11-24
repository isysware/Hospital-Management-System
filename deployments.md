# PRODUCTION DEPLOYMENT & DATABASE RUNBOOK

**Project:** CH Sharif and Saeed Hospital Management System & Standalone Pharmacy ERP  
**Server User:** `isywouhn`  
**Node.js Version:** v20 (cPanel Nodevenv)  

This document preserves the exact production paths, build outputs, database sync commands, and troubleshooting procedures so deployments are seamless and never blocked by migration errors.

---

## 1. Production Server Environments & Paths

| Subsystem | Production Domain | Virtual Environment Activation & Directory |
|:---|:---|:---|
| **HMS Backend API** | `api.hms.isywarecloud.com` | `source /home/isywouhn/nodevenv/api.hms.isywarecloud.com/20/bin/activate && cd /home/isywouhn/api.hms.isywarecloud.com` |
| **Pharmacy Backend API** | `api.pharmacy.isywarecloud.com` | `source /home/isywouhn/nodevenv/api.pharmacy.isywarecloud.com/20/bin/activate && cd /home/isywouhn/api.pharmacy.isywarecloud.com` |
| **HMS Frontend (React SPA)** | `hms.isywarecloud.com` | `/home/isywouhn/hms.isywarecloud.com` (Extract `dist` files) |
| **Pharmacy Frontend (React SPA)** | `pharmacy.isywarecloud.com` | `/home/isywouhn/pharmacy.isywarecloud.com` (Extract `dist` files) |

---

## 2. Deployment ZIP Packages

All production-ready ZIP files are located in the project root under:
📁 **`deployment-zips/`**

| Package Name | Contents | Destination on Server |
|:---|:---|:---|
| **`hms-backend-prod.zip`** | `dist/`, `api/`, `prisma/`, `package.json`, `app.js` | `/home/isywouhn/api.hms.isywarecloud.com/` |
| **`pharmacy-backend-prod.zip`** | `dist/`, `api/`, `prisma/`, `package.json` | `/home/isywouhn/api.pharmacy.isywarecloud.com/` |
| **`hms-frontend-dist.zip`** | `dist/` contents + `.htaccess` | `/home/isywouhn/hms.isywarecloud.com/` |
| **`pharmacy-frontend-dist.zip`** | `dist/` contents + `.htaccess` | `/home/isywouhn/pharmacy.isywarecloud.com/` |

---

## 3. Standard Production Deployment Steps

### Step 1: Upload Files
1. In cPanel File Manager, upload the 4 ZIP files from `deployment-zips/` to their respective directories.
2. Extract each ZIP in place (overwrite existing build files).
3. Ensure `.htaccess` is present in frontend directories for SPA URL routing.

### Step 2: Database Sync (Terminal Commands)

#### A. Pharmacy Database Sync
Run in cPanel Terminal / SSH:
```bash
source /home/isywouhn/nodevenv/api.pharmacy.isywarecloud.com/20/bin/activate && cd /home/isywouhn/api.pharmacy.isywarecloud.com
npx prisma db push
```

#### B. Hospital (HMS) Database Sync
Run in cPanel Terminal / SSH:
```bash
source /home/isywouhn/nodevenv/api.hms.isywarecloud.com/20/bin/activate && cd /home/isywouhn/api.hms.isywarecloud.com
npx prisma db push
```

> **Why `npx prisma db push`?**  
> `db push` directly synchronizes PostgreSQL schema against `schema.prisma` without transaction locks, avoiding PostgreSQL errors `42701 (column already exists)` and `25001 (ALTER TYPE ... ADD cannot run in transaction)`. It is safe, non-destructive, and automatically creates missing columns, tables, and enums.

### Step 3: Restart Node.js Applications
After files and database are updated, restart both Node.js services:
- **Via cPanel UI:** Go to **Setup Node.js App** $\rightarrow$ Click the **Restart** icon on both apps (`api.hms...` and `api.pharmacy...`).
- **Via Terminal:**
  ```bash
  touch /home/isywouhn/api.hms.isywarecloud.com/tmp/restart.txt
  touch /home/isywouhn/api.pharmacy.isywarecloud.com/tmp/restart.txt
  ```

---

## 4. Troubleshooting Common Production Database Errors

### Issue A: Error P3018 — Migration Locked / Failed
**Symptoms:**  
`A migration failed to apply. New migrations cannot be applied before the error is recovered from.`  
`Migration name: <migration_name>`

**Cause:**  
A previous migration hit a PostgreSQL error (e.g. column already created manually or enum value addition inside a multi-statement transaction).

**Instant Fix (Terminal):**
Mark the failed migration(s) as resolved, then run `db push`:
```bash
# Example for Pharmacy API:
source /home/isywouhn/nodevenv/api.pharmacy.isywarecloud.com/20/bin/activate && cd /home/isywouhn/api.pharmacy.isywarecloud.com
npx prisma migrate resolve --applied <failed_migration_name>
npx prisma db push
```

*For today's specific resolution, the commands used were:*
```bash
npx prisma migrate resolve --applied 20261114120000_full_payment_reporting
npx prisma migrate resolve --applied 20261114180000_vendor_payment_accounts
npx prisma migrate resolve --applied 20261114181000_purchase_posting_identity
npx prisma migrate resolve --applied 20261116190000_installment_receipt_safeguards
npx prisma db push
```

---

### Issue B: Error 25001 — `ALTER TYPE ... ADD cannot be executed from a function or multi-command string`
**Cause:**  
PostgreSQL disallows adding new enum values inside a transaction block containing other statements.

**Prevention / Fix:**  
Do not use `prisma migrate deploy` for multi-statement enum changes on production. Instead, run:
```bash
npx prisma db push
```
Prisma's `db push` executes enum additions outside multi-command strings, bypassing this restriction entirely.

---

### Issue C: Frontend 404 on Page Refresh (SPA Routing)
**Symptoms:**  
Visiting `https://pharmacy.isywarecloud.com/pos` directly or refreshing the page returns `404 Not Found`.

**Cause:**  
Missing or overwritten `.htaccess` in the frontend directory.

**Fix:**  
Ensure `.htaccess` in the frontend root contains:
```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteCond %{REQUEST_FILENAME} !-l
  RewriteRule . /index.html [L]
</IfModule>
```
*(Both frontend ZIP files in `deployment-zips/` already have this `.htaccess` pre-packaged).*

---

## 5. How to Rebuild ZIPs Locally Before Next Push

If code changes are made in the future, run these commands locally before pushing:

1. **Build All 4 Apps:**
   ```powershell
   cd "Pharmacy Software\backend" ; npm run build ; cd "..\.."
   cd "Pharmacy Software\frontend" ; npm run build ; cd "..\.."
   cd "HMS Software\backend" ; npm run build ; cd "..\.."
   cd "HMS Software\frontend" ; npm run build ; cd "..\.."
   ```

2. **Repackage Deployment ZIPs:**
   Run the packaging script to generate clean production archives without `node_modules`:
   ```powershell
   node scripts/package_deployments.js
   ```

3. **Commit & Push:**
   ```bash
   git add deployment-zips/ deployments.md
   git commit -m "build: update deployment zips and runbook"
   git push origin main
   ```

