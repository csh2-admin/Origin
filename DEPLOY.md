# Deploy Origin to DigitalOcean

## 1. Create a Droplet

1. Sign up at [digitalocean.com](https://www.digitalocean.com)
2. Create a new Droplet:
   - **Image**: Ubuntu 24.04
   - **Plan**: Basic, $6/mo (1 GB RAM, 25 GB disk)
   - **Region**: Pick the closest to your team (e.g. New York, San Francisco)
   - **Authentication**: Choose "Password" and set a root password
3. Note the Droplet's **IP address** once created

## 2. Connect to the Droplet

Open a terminal (PowerShell, Git Bash, or Command Prompt):

```bash
ssh root@<YOUR_DROPLET_IP>
```

## 3. Install Docker (run on the droplet)

```bash
curl -fsSL https://get.docker.com | sh
```

## 4. Clone and configure

```bash
cd /opt
git clone https://github.com/YOUR_USERNAME/Origin.git origin
cd origin
```

Create the environment file:

```bash
cat > backend/.env << 'EOF'
DB_HOST=j0uhgz9ri0.ext4btfaox.tsdb.cloud.timescale.com
DB_PORT=32576
DB_NAME=tsdb
DB_SSLMODE=require
ANTHROPIC_API_KEY=your-api-key-here
EOF
```

## 5. Build and run

```bash
docker compose up -d --build
```

The app is now running at `http://<YOUR_DROPLET_IP>:8000`

## 6. Update the app

SSH into the droplet and run:

```bash
cd /opt/origin
git pull
docker compose up -d --build
```

## Troubleshooting

Check logs:
```bash
docker compose logs -f
```

Restart:
```bash
docker compose restart
```
