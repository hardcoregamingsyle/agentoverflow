#!/usr/bin/env bash
# Creates the AgentOverflow GCP VM: e2-standard-4 SPOT, debian-12, 200GB
# pd-balanced, firewall for tcp:8080, startup script that installs docker +
# compose plugin + git + p7zip + aria2. Safe to re-run: existing resources
# are left alone. No secrets live here — those go in deploy/.env on the VM.
#
# Usage:  PROJECT=my-project ZONE=us-central1-a ./setup-gcp.sh
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
ZONE="${ZONE:-us-central1-a}"
NAME="${NAME:-agentoverflow}"
MACHINE_TYPE="e2-standard-4"
DISK_SIZE="200GB"
DISK_TYPE="pd-balanced"

if [[ -z "$PROJECT" ]]; then
  echo "No project set. Run: gcloud config set project <PROJECT_ID> (or pass PROJECT=...)" >&2
  exit 1
fi

echo "==> Project: $PROJECT  Zone: $ZONE  Instance: $NAME"

STARTUP_SCRIPT=$(cat <<'EOS'
#!/usr/bin/env bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git p7zip-full aria2
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
EOS
)

echo "==> Firewall rule ao-allow-web (tcp:80,443 -> tag ao-api)"
# Caddy terminates TLS on 443 (and serves the ACME challenge / HTTPS redirect
# on 80). The API container itself binds 127.0.0.1:8080 — never reachable from
# off-box — so the old world-open tcp:8080 rule is gone: nothing external
# should ever hit the API except through Caddy.
gcloud compute firewall-rules create ao-allow-web \
  --project="$PROJECT" \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:80,tcp:443 \
  --target-tags=ao-api \
  --description="AgentOverflow public API via Caddy TLS" \
  || echo "    (already exists, skipping)"

echo "==> Removing legacy world-open tcp:8080 rule if present"
gcloud compute firewall-rules delete ao-allow-8080 --project="$PROJECT" --quiet \
  || echo "    (not present, skipping)"

echo "==> Instance $NAME ($MACHINE_TYPE SPOT, $DISK_SIZE $DISK_TYPE, debian-12)"
gcloud compute instances create "$NAME" \
  --project="$PROJECT" \
  --zone="$ZONE" \
  --machine-type="$MACHINE_TYPE" \
  --provisioning-model=SPOT \
  --instance-termination-action=STOP \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size="$DISK_SIZE" \
  --boot-disk-type="$DISK_TYPE" \
  --tags=ao-api \
  --metadata=startup-script="$STARTUP_SCRIPT" \
  || echo "    (already exists, skipping)"

IP=$(gcloud compute instances describe "$NAME" --project="$PROJECT" --zone="$ZONE" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)' 2>/dev/null || true)

cat <<EOF

Done. External IP: ${IP:-<pending>}

Next steps:
  1. Wait ~2-3 min for the startup script, then SSH in:
       gcloud compute ssh $NAME --project=$PROJECT --zone=$ZONE
  2. Follow deploy/RUNBOOK.md from step 4 (clone repo, configure .env,
     docker compose up -d, run the ingestion pipeline).

After ingestion finishes, downsize to cut cost (~half):
  gcloud compute instances stop $NAME --project=$PROJECT --zone=$ZONE
  gcloud compute instances set-machine-type $NAME --project=$PROJECT --zone=$ZONE --machine-type=e2-standard-2
  gcloud compute instances start $NAME --project=$PROJECT --zone=$ZONE
EOF
