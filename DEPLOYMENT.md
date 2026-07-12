# Deployment Guide — Coneeko Platform

> **Status:** battle-tested through the first production deploy (v0.2.3).
> Every gotcha in here is one we actually hit — not theory.

## Topology

```
Browser ──► Vercel (Next.js frontend, https://console.coneeko.com)
               │  /api/v1/* rewrite (same-origin proxy, baked at build time)
               ▼
        Cloudflare (DNS; grey-cloud api record — see Part 4)
               ▼
            VPS (Ubuntu 24.04, 2 vCPU / 4 GB, "makalu")
               ├── Nginx  (TLS via Let's Encrypt, api.coneeko.com → 127.0.0.1:4000)
               └── Docker Compose
                     ├── antd-backend   (Docker Hub: nilopanda/antd-backend)
                     ├── postgres:16    (data in ./postgres_data on the host)
                     ├── redis:7        (BullMQ queues)
                     └── mosquitto      (MQTT for receipt printers, public port 51883)
```

The **frontend runs on Vercel**; only the **backend stack runs on the VPS**.
2 vCPU / 4 GB comfortably fits everything (backend ~300 MB, Postgres capped at
2 GB, Redis 512 MB, Mosquitto 256 MB). Add a 2 GB swap file (Part 11) for
headroom.

**Concrete values used in this guide** (substitute your own where relevant):

| Thing | Value |
|---|---|
| Frontend domain | `console.coneeko.com` (Vercel) |
| API domain | `api.coneeko.com` (VPS) |
| Docker Hub user | `nilopanda`, repo `antd-backend` |
| GitHub repo | `github.com/manishshres/antd-platform` (private) |
| MQTT user | `coneeko_printer` |
| Current version | `0.2.3` |

---

## Part 1 — Build & publish (on your Mac)

### 1.1 Commit and cut a version

```bash
git status                  # everything you want to ship must be committed
npm run release             # patch bump; or `minor` / `major`
git push && git push --tags
```

The version is served at `GET /api/v1/health/version` and shown in the frontend
footer — that's your deploy confirmation later. If `git push` fails with an
HTTP/2 400, this repo is pinned to HTTP/1.1 already (`git config http.version`);
it was a one-time fix.

### 1.2 Build & push the backend image to Docker Hub

One-time: `docker login` (Docker Hub user `nilopanda`, repo `antd-backend`).

You're on Apple Silicon; the VPS is x86 — so **always build for `linux/amd64`**
with buildx, from the **repo root** (the Dockerfile copies the whole monorepo):

```bash
export VERSION=$(node -p "require('./package.json').version")
docker buildx build --platform linux/amd64 \
  -f apps/backend/Dockerfile \
  -t nilopanda/antd-backend:$VERSION \
  -t nilopanda/antd-backend:latest \
  --push .
```

Confirm it landed and is amd64:

```bash
docker manifest inspect nilopanda/antd-backend:$VERSION | grep architecture
# → "architecture": "amd64"
```

> **Why this matters:** a plain `docker build` on your Mac produces an **arm64**
> image the VPS can't run. The old `v1.0.0` tag on Docker Hub is arm64 — ignore
> it. The Dockerfile now includes `RUN test -f apps/backend/dist/main.js`, so a
> mis-built image (wrong entry-point path) fails the *build* instead of
> crash-looping on the server — a bug that cost us hours on the first deploy.

The frontend is on Vercel (Part 5) — no frontend image needed.

---

## Part 2 — Provision the VPS

### 2.1 Create the instance

- **DigitalOcean**: Droplet → Ubuntu 24.04 LTS → Basic → 2 vCPU / 4 GB.
- **Vultr**: Cloud Compute → Ubuntu 24.04 → 2 vCPU / 4 GB.
- **AWS EC2** (later): `t3.medium`, Ubuntu 24.04 AMI, 30 GB gp3 EBS, Elastic IP;
  open ports via the Security Group (mirror the ufw rules below). Everything
  else in this guide is identical.

Regular SSD is fine — this workload (~20 orders/day) is nowhere near disk-bound.
Add your SSH key at creation and enable the provider's automated backups.

### 2.2 First login & hardening

```bash
ssh root@YOUR_VPS_IP

adduser deploy && usermod -aG sudo deploy
rsync -a ~/.ssh/ /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh

# key-only SSH, no root login
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
exit
ssh deploy@YOUR_VPS_IP        # from now on
```

### 2.3 Install Docker + Node.js 22

```bash
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version && docker compose version

# Node.js 22 — needed for migrations & provisioning (drizzle-kit isn't in the image)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version    # v22.x
```

### 2.4 Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp         # HTTP (Let's Encrypt + redirect)
sudo ufw allow 443/tcp        # HTTPS (API)
sudo ufw allow 51883/tcp      # MQTT for receipt printers (must be public)
sudo ufw enable
sudo ufw status
```

> ⚠️ Postgres (5432), Redis (6379), backend (4000) are bound to `127.0.0.1` in
> the compose file — never open them. Docker's port publishing inserts iptables
> rules that **bypass ufw**, so loopback binding (not the firewall) is what
> actually protects them.

---

## Part 3 — Deploy the backend stack

### 3.1 Clone the repo

```bash
git clone https://github.com/manishshres/antd-platform.git ~/app
cd ~/app/apps/backend
```

### 3.2 Configure `.env`

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

The values that must be right for a **self-hosted** deploy:

| Variable | Production value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `4000` | |
| `FRONTEND_URL` | `https://console.coneeko.com` | **CORS origin — must be the real frontend domain** |
| `DOCKER_REGISTRY` | `docker.io/nilopanda` | |
| `BACKEND_VERSION` | `0.2.3` | the tag you pushed |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | |
| `DATABASE_URL` | **leave unset** | compose builds it from `POSTGRES_*` |
| `DATABASE_SSL` | `false` | **critical — see the box below** |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | two different `openssl rand -hex 32` | |
| `SELF_REGISTRATION_ENABLED` | `false` | |
| `MQTT_BROKER_URL` | `mqtt://mosquitto:1883` | **service name, not localhost** |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | `coneeko_printer` / your MQTT pass | matches Part 3.2b + printers |
| `SMTP_*` | Resend creds | see Part 6 |
| Telnyx / Stripe / S3 / Gemini / Firecrawl | real production keys | |
| `SENTRY_DSN` | your Sentry DSN | recommended |

> ⚠️ **`DATABASE_SSL=false` — this caused the login-500 on the first deploy.**
> The backend infers Postgres TLS from the connection string. A self-hosted
> dockerized Postgres has **no** TLS, so SSL must be off. Without this, *every*
> DB query fails (login, provisioning, printer sweeps) while `psql` and the
> health check still work — a very confusing failure. Managed Postgres
> (Neon/RDS) is the opposite: use `?sslmode=require` in `DATABASE_URL` or
> `DATABASE_SSL=true`.

### 3.2b Create the MQTT password file

`mosquitto.passwd` is **gitignored** (it's a credential), so a fresh clone
doesn't have it. If compose mounts a missing file, Docker creates a *directory*
in its place and mosquitto crash-loops (`Restarting (13)`). Create it first:

```bash
cd ~/app/apps/backend
MQTT_PASS=$(openssl rand -hex 16); echo "SAVE THIS MQTT password: $MQTT_PASS"

docker run --rm -v "$PWD:/work" eclipse-mosquitto:2.1-alpine \
  sh -c "mosquitto_passwd -c -b /work/mosquitto.passwd coneeko_printer '$MQTT_PASS'"

# mosquitto 2.x refuses root-owned / world-readable password files
sudo chown 1883:1883 mosquitto.passwd
sudo chmod 600 mosquitto.passwd
```

Put the same `coneeko_printer` / `$MQTT_PASS` into `.env` (`MQTT_USERNAME` /
`MQTT_PASSWORD`) and into every physical printer's MQTT config. Printers on the
internet connect to `YOUR_VPS_IP:51883`.

> Gotchas we hit: `mosquitto_passwd -c` **refuses to overwrite** an existing
> file (`rm -f mosquitto.passwd` first if re-creating), and uid **1883** is the
> mosquitto user inside the Alpine image.

### 3.3 Start the stack

```bash
docker compose pull
docker compose up -d
docker compose ps        # postgres & redis → "healthy"; mosquitto → "Up" (not Restarting)
```

If mosquitto still restarts after a config/ownership change, force a fresh
container (a plain restart reuses the old, broken mount):

```bash
docker compose up -d --force-recreate mosquitto
docker logs antd-mosquitto --tail 10    # want "mosquitto version 2.x running"
```

`restart: unless-stopped` on every service + Docker starting on boot means the
whole stack survives reboots automatically — no extra config.

### 3.4 Run migrations

```bash
cd ~/app && npm ci --workspace apps/backend --include-workspace-root
cd apps/backend
DATABASE_URL="postgres://postgres:YOUR_POSTGRES_PASSWORD@127.0.0.1:5432/antd_db" \
  npm run db:migrate
```

> ⚠️ **Postgres password volume gotcha:** `POSTGRES_PASSWORD` only applies when
> `./postgres_data` is **first created**. If the volume already exists from an
> earlier attempt, the old password is still in effect. Either reset it —
> `docker exec -it antd-postgres psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'NEW';"`
> — or, if the DB is empty, wipe and re-init:
> `docker compose down && sudo rm -rf postgres_data && docker compose up -d`.

### 3.5 Seed plans + first admin

```bash
cd ~/app/apps/backend
DATABASE_URL="postgres://postgres:YOUR_POSTGRES_PASSWORD@127.0.0.1:5432/antd_db" \
ADMIN_EMAIL='you@coneeko.com' ADMIN_PASSWORD='a-strong-password' \
  npm run provision
```

Idempotent (safe to re-run). Creates a `platform_admin`. **Use the exact email
you'll log in with** — forgot-password silently no-ops for a non-existent
email. Clear `ADMIN_PASSWORD` from your shell history afterward
(`history -d <n>`).

### 3.6 Smoke-test on the box

```bash
curl -s http://127.0.0.1:4000/api/v1/health/version   # {"version":"0.2.3"}
curl -s http://127.0.0.1:4000/api/v1/health | head -c 300
docker logs antd-backend 2>&1 | grep -i mqtt | tail -3   # want a "connected" line, no error loop
```

---

## Part 4 — DNS, Cloudflare, Nginx, TLS

### 4.1 DNS records

| Host | Type | Value | Cloudflare proxy |
|---|---|---|---|
| `api.coneeko.com` | A | YOUR_VPS_IP | **DNS only (grey cloud)** — see box |
| `console.coneeko.com` | CNAME | `cname.vercel-dns.com` | DNS only (Vercel manages its own edge/TLS) |

`dig api.coneeko.com +short` should return the VPS IP.

> ⚠️ **Cloudflare redirect loop (`301` from `server: cloudflare`).** If the `api`
> record is orange-clouded with SSL mode *Flexible*, Cloudflare talks to your
> origin over HTTP:80, gets certbot's HTTP→HTTPS redirect, and loops forever.
> Fix: either set the record to **grey cloud (DNS only)** — simplest — or keep
> the proxy and set SSL/TLS mode to **Full (strict)**. Note the printer MQTT
> port 51883 is **not** carried by Cloudflare's proxy, so grey-cloud is the
> cleaner choice for `api`.

### 4.2 Nginx reverse proxy

```bash
sudo apt install -y nginx
sudo tee /etc/nginx/sites-available/api <<'EOF'
server {
    listen 80;
    server_name api.coneeko.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;      # socket.io realtime
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 75s;
    }
    client_max_body_size 25m;   # menu/document uploads
}
EOF
sudo ln -s /etc/nginx/sites-available/api /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 4.3 Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.coneeko.com --redirect -m you@coneeko.com --agree-tos
sudo certbot renew --dry-run     # auto-renew is a systemd timer
curl -s https://api.coneeko.com/api/v1/health/version   # {"version":"0.2.3"}
```

---

## Part 5 — Frontend on Vercel

1. Import `github.com/manishshres/antd-platform` → **Root Directory:
   `apps/frontend`**. Next.js auto-detected.
2. Environment variables (Production) — set exactly **one**:

   | Variable | Value |
   |---|---|
   | `BACKEND_INTERNAL_URL` | `https://api.coneeko.com` |

   **Do not create `NEXT_PUBLIC_API_URL`** — Vercel rejects empty values, and
   unset correctly falls back to same-origin `/api/v1`, which keeps the
   HttpOnly refresh cookie first-party. Setting it to a URL breaks auth. This
   var is consumed at **build time**, so changing it needs a redeploy.
3. Deploy. Then Settings → Domains → add `console.coneeko.com` (Vercel shows the
   CNAME target for 4.1).
4. Ensure the VPS `.env` has `FRONTEND_URL=https://console.coneeko.com`, then
   `docker compose up -d --force-recreate backend` on the VPS (containers read
   `.env` only at **creation** — a plain restart won't pick up a changed value).

> The build compiles the `@platform/shared-types` workspace package via a
> `prebuild` script before `next build`. If a Vercel build ever fails with
> *"Cannot find module '@platform/shared-types'"*, that script is missing —
> it's in `apps/frontend/package.json` as of v0.2.2.

---

## Part 6 — Email (Resend over SMTP)

The backend sends via nodemailer SMTP. For Resend, in the VPS `.env`:

```env
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend                     # literally the word "resend"
SMTP_PASS=re_xxxxxxxxxxxxxxxxx        # your Resend API key
SMTP_FROM=no-reply@coneeko.com       # domain MUST be verified in Resend
```

Apply with `docker compose up -d --force-recreate backend`.

Reset/verification links are built from `FRONTEND_URL`. A `localhost` link in an
email means the sending backend had no `FRONTEND_URL` (usually a **dev** backend
on someone's laptop sharing the same SMTP creds) — point local dev at a Mailtrap
sandbox so it can never send to real inboxes.

**If email never arrives**, check in order:
1. Does the target user exist? `docker exec antd-postgres psql -U postgres -d antd_db -c "SELECT email FROM users WHERE deleted_at IS NULL;"` (forgot-password no-ops for unknown emails).
2. Is the backend on ≥ 0.2.2? On older builds the DB SSL bug 500s before any email is attempted.
3. `docker logs antd-backend --since 2m 2>&1 | grep -iE "mail|smtp"` — you'll see `Email sent to …`, a `Failed to send …: <reason>`, or `SMTP_HOST not set` (env not loaded).
4. Resend dashboard → Logs shows accepted/rejected on their side. Unverified `SMTP_FROM` domain is the classic rejection.

---

## Part 7 — Verify end-to-end

```bash
curl -s https://api.coneeko.com/api/v1/health | jq          # status UP, version, services
docker compose ps                                            # all Up/healthy
docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' antd-backend   # unless-stopped
```

In a browser at `https://console.coneeko.com`: log in with the admin from 3.5 →
open POS → ring a test order → check Sales Reports → print a receipt (if a
printer's on 51883). Footer shows the version.

---

## Part 8 — Releasing updates

**Data is never touched by this flow** — only the backend container is replaced.
Postgres lives in `./postgres_data` on the host.

```bash
# Mac
npm run release            # patch/minor/major
git push && git push --tags
export VERSION=$(node -p "require('./package.json').version")
docker buildx build --platform linux/amd64 -f apps/backend/Dockerfile \
  -t nilopanda/antd-backend:$VERSION -t nilopanda/antd-backend:latest --push .

# VPS
cd ~/app && git pull
cd apps/backend
sed -i "s/^BACKEND_VERSION=.*/BACKEND_VERSION=$VERSION/" .env   # or edit by hand
docker compose pull backend
# only if the release added migrations:
DATABASE_URL="postgres://postgres:PASS@127.0.0.1:5432/antd_db" npm run db:migrate
docker compose up -d backend
curl -s https://api.coneeko.com/api/v1/health/version          # confirm
```

Vercel redeploys the frontend automatically on push to `master`.

**Rollback:** set `BACKEND_VERSION` to the previous tag → `docker compose up -d
backend`. Migrations are forward-only; write additive migrations so old code
can still run against a newer schema.

**Commands that DO destroy data — never in a normal update:** `docker compose
down -v`, `rm -rf postgres_data`. `docker compose up -d backend` recreates only
the backend and leaves postgres/redis/mosquitto running.

---

## Part 9 — Backups

Stateful data on the VPS = Postgres (`./postgres_data`) + `mosquitto.passwd`.

```bash
mkdir -p ~/backups
crontab -e
# nightly dump at 03:15, keep 14 days:
15 3 * * * docker exec antd-postgres pg_dump -U postgres antd_db | gzip > $HOME/backups/antd_db_$(date +\%F).sql.gz && find $HOME/backups -name '*.sql.gz' -mtime +14 -delete
```

Restore: `gunzip -c backup.sql.gz | docker exec -i antd-postgres psql -U postgres antd_db`.

Also: enable provider snapshots, and copy `~/backups` off-box periodically
(`rclone` to the same R2/S3 bucket the app uses). **Test a restore once before
you need it.**

---

## Part 10 — Monitoring & troubleshooting

```bash
docker compose logs -f backend                  # live pino JSON logs
docker compose logs --since 1h backend
docker stats --no-stream                        # per-container CPU/mem
df -h                                           # disk (images accumulate)
docker system prune -af --filter 'until=168h'   # weekly cleanup (cron it)
sudo tail -f /var/log/nginx/error.log
```

| Symptom | Cause / fix |
|---|---|
| **Login/any request 500, but health + psql work** | `DATABASE_SSL` not `false` — app forces TLS to a non-TLS Postgres. Set it, `up -d --force-recreate backend`. (First-deploy killer.) |
| **`301` loop, `server: cloudflare`** | Cloudflare Flexible SSL on a proxied `api` record — grey-cloud it or set Full (strict). |
| **mosquitto `Restarting (13)`** | `mosquitto.passwd` missing (Docker made a dir), or wrong owner. Recreate file (3.2b), `up -d --force-recreate mosquitto`. |
| **`Cannot find module '.../dist/main'`** | arm64 image, or pre-0.2.1 entry-point bug. Rebuild `--platform linux/amd64` on ≥ 0.2.1. |
| **Vercel: `Cannot find module '@platform/shared-types'`** | frontend `prebuild` missing — need ≥ 0.2.2. |
| **502 from Nginx** | backend down — `docker compose ps`, `logs backend`. |
| **Backend restart loop** | bad `.env` (missing `JWT_SECRET`, weak secret) — env validation logs the exact var. |
| **Email never arrives** | see Part 6 checklist. |
| **`MQTT Client error` every 5s** | `MQTT_BROKER_URL` points at `localhost` (inside the container that's itself) — use `mqtt://mosquitto:1883`; or wrong `MQTT_PASSWORD`. |
| **Session dies after 15 min** | `FRONTEND_URL` mismatch (CORS), or frontend built with a non-empty `NEXT_PUBLIC_API_URL`. |
| **`refund/…` 403** | manager PIN not set (`users.pos_pin_hash`). |
| **Disk full** | prune images; check `postgres_data` growth. |

External: point UptimeRobot/BetterStack (free) at
`https://api.coneeko.com/api/v1/health`; Sentry (via `SENTRY_DSN`) captures
backend exceptions.

---

## Part 11 — Production checklist

- [ ] Backend image built `--platform linux/amd64` and pushed with a version tag
- [ ] `DATABASE_SSL=false` for self-hosted Postgres
- [ ] `MQTT_BROKER_URL=mqtt://mosquitto:1883`; `mosquitto.passwd` owned by `1883`, mode 600
- [ ] `FRONTEND_URL=https://console.coneeko.com`; Vercel has only `BACKEND_INTERNAL_URL`
- [ ] `SELF_REGISTRATION_ENABLED=false`; admin created via `npm run provision` with your real login email
- [ ] Unique `JWT_SECRET` / `JWT_REFRESH_SECRET` / `POSTGRES_PASSWORD`; `.env` is `chmod 600`, never committed
- [ ] MQTT password rotated if it was ever pasted into chat/terminal history
- [ ] ufw: only 22/80/443/51883; `api` record grey-clouded (or Full-strict); `fail2ban` installed
- [ ] certbot dry-run passes; Resend `SMTP_FROM` domain verified
- [ ] Nightly `pg_dump` cron **and a tested restore**; provider snapshots on
- [ ] Uptime monitor on `/api/v1/health`; `SENTRY_DSN` set
- [ ] `sudo apt install unattended-upgrades`
- [ ] Swap file: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`, then add to `/etc/fstab`

When you outgrow one box: move Postgres to managed (DO Managed PG / RDS / Neon)
**first** — it's the piece that hurts most to lose — flipping `DATABASE_SSL`
back on. The rest scales by moving the compose file to a bigger instance.
