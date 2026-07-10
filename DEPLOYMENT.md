# Deployment Guide — Coneeko Platform

Production topology used by this guide:

```
Browser ──► Vercel (Next.js frontend, https://app.coneeko.com)
               │  /api/v1/* rewrite (same-origin proxy)
               ▼
            VPS (Ubuntu 24.04, 2 vCPU / 4 GB)
               ├── Nginx (TLS, https://api.coneeko.com → 127.0.0.1:4000)
               └── Docker Compose
                     ├── antd-backend   (Docker Hub image)
                     ├── postgres:16    (data in ./postgres_data)
                     ├── redis:7        (queues)
                     └── mosquitto      (MQTT for receipt printers, port 51883)
```

The frontend runs on Vercel; only the backend stack runs on the VPS. The same
steps work on DigitalOcean, Vultr, or AWS EC2 — differences are called out
inline. 2 vCPU / 4 GB comfortably fits this stack (backend ~300 MB, Postgres
capped at 2 GB, Redis 512 MB, Mosquitto 256 MB).

---

## Part 1 — Build & publish (on your dev machine)

### 1.1 Commit and version

```bash
git status                  # everything you want to ship must be committed
npm run release minor       # bumps root+backend+frontend to one version, commits, tags
git push && git push --tags
```

The version shows up at runtime in `GET /api/v1/health/version` and in the
frontend footer — that's how you confirm a deploy later.

### 1.2 Build and push the backend image to Docker Hub

One-time: create a Docker Hub account + a repository named `antd-backend`,
then `docker login`.

From the **repo root** (the Dockerfile copies the whole monorepo):

```bash
export DOCKER_USER=nilopanda
export VERSION=$(node -p "require('./package.json').version")

docker build -f apps/backend/Dockerfile \
  -t $DOCKER_USER/antd-backend:$VERSION \
  -t $DOCKER_USER/antd-backend:latest .

docker push $DOCKER_USER/antd-backend:$VERSION
docker push $DOCKER_USER/antd-backend:latest
```

Always push the version tag as well as `latest` — rollbacks depend on it.

> Building on an Apple Silicon Mac for an x86 VPS? Build multi-arch:
> `docker buildx build --platform linux/amd64 -f apps/backend/Dockerfile -t $DOCKER_USER/antd-backend:$VERSION --push .`

The frontend is deployed to Vercel (Part 4), so no frontend image is needed.
(A working `apps/frontend/Dockerfile` exists if you ever self-host it; pass
`--build-arg BACKEND_INTERNAL_URL=...` because rewrites bake at build time.)

---

## Part 2 — Provision the VPS

### 2.1 Create the instance

**DigitalOcean**: Create → Droplet → Ubuntu 24.04 LTS → Basic → 2 vCPU / 4 GB.
**Vultr**: Deploy → Cloud Compute → Ubuntu 24.04 → 2 vCPU / 4 GB.
**AWS EC2** (later): `t3.medium`, Ubuntu 24.04 AMI, 30 GB gp3 EBS; open ports
via the Security Group instead of ufw (or use both).

In all cases: add your SSH key at creation time, enable automated
snapshots/backups if offered, and note the public IPv4.

### 2.2 First login & basic hardening

```bash
ssh root@YOUR_VPS_IP

# Create an unprivileged deploy user
adduser deploy && usermod -aG sudo deploy
rsync -a ~/.ssh/ /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh

# Disable root SSH + password auth
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# Log back in as deploy from now on
exit
ssh deploy@YOUR_VPS_IP
```

### 2.3 Install Docker + Compose

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker                 # or log out/in
docker --version && docker compose version
```

### 2.4 Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp         # HTTP (Let's Encrypt + redirect)
sudo ufw allow 443/tcp        # HTTPS (API)
sudo ufw allow 51883/tcp      # MQTT for receipt printers
sudo ufw enable
sudo ufw status
```

Postgres (5432), Redis (6379), and the backend (4000) are bound to
`127.0.0.1` in docker-compose — they are not reachable from the internet even
without ufw. **Do not** open them.

> ⚠️ Docker publishes ports by inserting its own iptables rules that bypass
> ufw — that's why the compose file binds internal services to loopback
> instead of relying on the firewall.

---

## Part 3 — Deploy the backend stack

### 3.1 Get the deployment files

```bash
git clone https://github.com/manishshres/antd-platform.git ~/app
cd ~/app/apps/backend
```

(Only `docker-compose.yml`, `mosquitto.conf`, `mosquitto.passwd`, `drizzle/`
and `.env` are needed on the server; cloning the repo is the simplest way to
get and update them.)

### 3.2 Configure `.env`

```bash
cp .env.example .env
nano .env
```

Set every value. The critical ones:

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `FRONTEND_URL` | `https://app.coneeko.com` (CORS origin) |
| `DOCKER_REGISTRY` | `docker.io/nilopanda` |
| `BACKEND_VERSION` | the version you pushed, e.g. `0.2.0` |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `DATABASE_URL` | leave unset — compose builds it from the POSTGRES_* vars |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | two different `openssl rand -hex 32` values |
| `SELF_REGISTRATION_ENABLED` | `false` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | your first admin (used once in 3.5, then remove) |
| Telnyx / Stripe / SMTP / S3 / Gemini / Firecrawl keys | real production keys |
| `SENTRY_DSN` | your Sentry project DSN (recommended) |

Then `chmod 600 .env`.

### 3.2b Create the MQTT password file

`mosquitto.passwd` is **gitignored** (it holds credentials), so a fresh clone
doesn't have it — and compose mounting a missing file makes Docker create a
directory in its place, which crash-loops mosquitto (`Restarting (13)`).
Create it before the first `up`:

```bash
docker run --rm -v "$PWD:/work" eclipse-mosquitto:2.1-alpine \
  sh -c "mosquitto_passwd -c -b /work/mosquitto.passwd coneeko_printer 'STRONG_MQTT_PASSWORD' && chmod 600 /work/mosquitto.passwd"
```

Use the same credentials in `.env` (`MQTT_USERNAME` / `MQTT_PASSWORD`) and in
every physical printer's MQTT config, and set
`MQTT_BROKER_URL=mqtt://mosquitto:1883` — the Docker service name, **not**
localhost. Printers on the internet connect to `YOUR_VPS_IP:51883`.

### 3.3 Pull images and start

```bash
docker compose pull
docker compose up -d
docker compose ps        # postgres/redis should report "healthy"
```

`restart: unless-stopped` is set on every service, and Docker itself starts on
boot (`systemctl is-enabled docker`), so the whole stack survives reboots —
no extra work needed for automatic restarts.

### 3.4 Run database migrations

The runtime image doesn't include drizzle-kit, so run migrations from the
checked-out repo against the loopback-published Postgres port.

**First install Node.js 22 on the VPS** (a fresh Ubuntu image has none):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version    # v22.x
```

Then install workspace deps and migrate:

```bash
cd ~/app && npm ci --workspace apps/backend --include-workspace-root
cd apps/backend
DATABASE_URL="postgres://postgres:YOUR_POSTGRES_PASSWORD@127.0.0.1:5432/antd_db" npm run db:migrate
```

> ⚠️ **Postgres password gotcha**: `POSTGRES_PASSWORD` is only applied when the
> data volume is **first initialized**. If `./postgres_data` already exists
> from an earlier attempt, the old password is still active. Either reset it
> in place:
>
> ```bash
> docker exec -it antd-postgres psql -U postgres -d antd_db \
>   -c "ALTER USER postgres WITH PASSWORD 'NEW_PASSWORD_FROM_ENV';"
> ```
>
> or, if the database is empty anyway, wipe and re-init:
> `docker compose down && sudo rm -rf postgres_data && docker compose up -d`.

### 3.5 Provision plans + first admin

```bash
DATABASE_URL="postgres://postgres:YOUR_POSTGRES_PASSWORD@127.0.0.1:5432/antd_db" \
ADMIN_EMAIL=mr.manishshrestha@gmail.com ADMIN_PASSWORD='a-strong-password' \
npm run provision
```

This seeds the billing plans and creates a `platform_admin` user (idempotent —
safe to re-run). Remove `ADMIN_PASSWORD` from your shell history/.env afterwards.

### 3.6 Smoke-test locally on the VPS

```bash
curl -s http://127.0.0.1:4000/api/v1/health/version   # {"version":"0.2.0"}
curl -s http://127.0.0.1:4000/api/v1/health | head -c 300
```

---

## Part 4 — DNS, Nginx, and SSL

### 4.1 DNS records (at your DNS provider)

| Record | Type | Value |
|---|---|---|
| `api.coneeko.com` | A | YOUR_VPS_IP |
| `app.coneeko.com` | CNAME | `cname.vercel-dns.com` (Vercel will tell you the exact target) |

Wait for propagation (`dig api.coneeko.com` should return the VPS IP).

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
        # WebSockets (socket.io realtime events)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 75s;
    }

    client_max_body_size 25m;   # document/menu uploads
}
EOF
sudo ln -s /etc/nginx/sites-available/api /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 4.3 Let's Encrypt TLS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.coneeko.com --redirect -m mr.manishshrestha@gmail.com --agree-tos
sudo certbot renew --dry-run     # auto-renewal is installed as a systemd timer
```

Verify: `curl -s https://api.coneeko.com/api/v1/health/version`.

---

## Part 5 — Frontend on Vercel

1. Import the GitHub repo in Vercel → **Root Directory: `apps/frontend`**,
   framework auto-detects Next.js.
2. Environment variables (Production):

   | Variable | Value | Why |
   |---|---|---|
   | `NEXT_PUBLIC_API_URL` | *(empty string)* | keeps all API calls same-origin so the HttpOnly refresh cookie works |
   | `BACKEND_INTERNAL_URL` | `https://api.coneeko.com` | target of the `/api/v1/*` rewrite proxy |

   Both are consumed at **build time** — changing them requires a redeploy.
3. Deploy, then add the custom domain `app.coneeko.com` under
   Settings → Domains (this is where Vercel gives you the CNAME for 4.1).
4. Set `FRONTEND_URL=https://app.coneeko.com` in the VPS `.env` (CORS) and
   `docker compose up -d` to apply — if you hadn't already in 3.2.

The browser only ever talks to `app.coneeko.com`; Vercel's rewrite proxies
`/api/v1/*` to the VPS. The refresh cookie stays first-party, so login,
silent refresh, and the route guard all work unchanged.

---

## Part 6 — Verify everything

```bash
# API up, correct version, all services healthy
curl -s https://api.coneeko.com/api/v1/health | jq

# Containers healthy and restarting policy set
docker compose ps
docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' antd-backend
```

Then in a browser: log in at `https://app.coneeko.com` with the admin from
3.5, open the POS, place a test order, check Sales Reports, and (if a printer
is configured on MQTT port 51883) print a receipt. Footer shows the version.

---

## Part 7 — Releasing updates

```bash
# On your dev machine
npm run release            # or `minor` / `major`
git push && git push --tags
docker build -f apps/backend/Dockerfile -t $DOCKER_USER/antd-backend:$NEW_VERSION -t $DOCKER_USER/antd-backend:latest .
docker push $DOCKER_USER/antd-backend:$NEW_VERSION && docker push $DOCKER_USER/antd-backend:latest

# On the VPS
cd ~/app && git pull                      # refresh compose file + migrations
cd apps/backend
sed -i 's/^BACKEND_VERSION=.*/BACKEND_VERSION=NEW_VERSION/' .env
docker compose pull backend
DATABASE_URL="postgres://postgres:PASS@127.0.0.1:5432/antd_db" npm run db:migrate   # if the release has new migrations
docker compose up -d backend              # recreates only the backend container
curl -s https://api.coneeko.com/api/v1/health/version   # confirm new version
```

**Rollback**: set `BACKEND_VERSION` back to the previous tag and
`docker compose up -d backend`. (Migrations are forward-only — write additive
migrations so old code can run against a newer schema.)

Vercel redeploys the frontend automatically on push to the production branch.

---

## Part 8 — Backups

The only stateful data on the VPS is Postgres (`./postgres_data`) and the
Mosquitto password file.

```bash
# Nightly logical dump, keep 14 days (run as the deploy user)
mkdir -p ~/backups
crontab -e
# add:
15 3 * * * docker exec antd-postgres pg_dump -U postgres antd_db | gzip > $HOME/backups/antd_db_$(date +\%F).sql.gz && find $HOME/backups -name '*.sql.gz' -mtime +14 -delete
```

Restore: `gunzip -c backup.sql.gz | docker exec -i antd-postgres psql -U postgres antd_db`.

Also enable the provider's whole-server snapshots (DigitalOcean Backups /
Vultr Auto Backup / EBS snapshots) — cheap insurance — and periodically copy
`~/backups` off the box (e.g. `rclone` to the same R2/S3 bucket the app
already uses). Test a restore once before you need it.

---

## Part 9 — Monitoring & troubleshooting

```bash
docker compose logs -f backend            # live app logs (pino JSON)
docker compose logs --since 1h backend    # recent history
docker stats --no-stream                  # memory/CPU per container
df -h                                     # disk (Docker images accumulate!)
docker system prune -af --filter 'until=168h'   # weekly image cleanup (cron it)
sudo tail -f /var/log/nginx/error.log
```

| Symptom | Likely cause / fix |
|---|---|
| `502 Bad Gateway` from Nginx | backend container down — `docker compose ps`, `docker compose logs backend` |
| Backend restarts in a loop | bad `.env` (most often `DATABASE_URL`/`JWT_SECRET` missing) — logs show the exact config error |
| Login works but session dies after 15 min | `FRONTEND_URL` mismatch (CORS) or frontend built with a non-empty `NEXT_PUBLIC_API_URL` |
| Printer never prints | port 51883 blocked, or `mosquitto.passwd` credentials don't match the printer config; `docker compose logs mosquitto` |
| `refund/…` returns 403 | manager PIN not set for the user (`users.pos_pin_hash`) |
| Disk fills up | old Docker images — run the prune above; check `postgres_data` growth |
| High memory | `docker stats`; Postgres is capped at 2 GB by compose — lower `shared_buffers` via `POSTGRES_INITDB_ARGS` if needed |

External uptime check: point UptimeRobot/BetterStack (free tier) at
`https://api.coneeko.com/api/v1/health` — it returns `DOWN` status text if
Postgres/Redis/MQTT are unhealthy, and Sentry (already wired via `SENTRY_DSN`)
captures backend exceptions.

---

## Part 10 — Production checklist & recommendations

- [ ] `SELF_REGISTRATION_ENABLED=false`; admin provisioned via `npm run provision`
- [ ] Unique `JWT_SECRET` / `JWT_REFRESH_SECRET` / `POSTGRES_PASSWORD` (never the dev defaults)
- [ ] `.env` is `chmod 600` and **never** committed
- [ ] ufw enabled: only 22/80/443/51883 open
- [ ] SSH: key-only, root login disabled; consider `fail2ban` (`sudo apt install fail2ban`)
- [ ] Certbot dry-run passes (auto-renew works)
- [ ] Nightly `pg_dump` cron in place **and a restore has been tested**
- [ ] Provider snapshots enabled
- [ ] Uptime monitor on `/api/v1/health`; Sentry DSN set
- [ ] Unattended security updates: `sudo apt install unattended-upgrades`
- [ ] Swap file on 4 GB instances helps survive spikes: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` (+ `/etc/fstab` entry)
- [ ] EC2 migration notes: use a Security Group mirroring the ufw rules, an Elastic IP so DNS doesn't change, gp3 EBS ≥ 30 GB; everything in Parts 3–9 is identical

When you outgrow one box: move Postgres to a managed database (DO Managed PG /
RDS / Neon) first — it's the piece that hurts most to lose — then the rest of
the stack scales by simply moving the compose file to a bigger instance.
