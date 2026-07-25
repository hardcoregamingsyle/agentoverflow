#!/usr/bin/env bash
# Creates the AgentOverflow GCP VM and the disks the corpus actually lives on.
#
# The layout matters more than the machine. A boot disk defaults to
# auto-delete, so deleting the instance takes the corpus with it — that is
# exactly how the first corpus died. Here the data lives on its own disk with
# auto-delete off, the instance carries deletion protection, and the disk has
# a daily snapshot schedule. Three independent things have to go wrong before
# anything is actually lost.
#
#   /data     ao-data     pd-balanced, SSD, survives the instance. Docker's
#                         data-root, so the qdrant + postgres volumes (i.e.
#                         the corpus) sit here.
#   /scratch  ao-scratch  pd-standard, HDD, cheap and disposable. Dumps and
#                         shards only — every stage reads it sequentially, so
#                         spinning rust is fine and saves the SSD quota.
#
# Safe to re-run: existing resources are left alone. No secrets live here —
# those go in deploy/.env on the VM.
#
# Usage:  PROJECT=my-project ZONE=us-central1-a ./setup-gcp.sh
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
ZONE="${ZONE:-us-central1-a}"
REGION="${REGION:-${ZONE%-*}}"
NAME="${NAME:-agentoverflow}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-standard-4}"

BOOT_SIZE="${BOOT_SIZE:-30GB}"
DATA_SIZE="${DATA_SIZE:-150GB}"
SCRATCH_SIZE="${SCRATCH_SIZE:-300GB}"

# Spot is ~70% cheaper and preemption only stops the instance. PREEMPTIBLE_CPUS
# being 0 does NOT block it — Spot draws on standard CPU quota, verified by
# creating one on a project sitting at PREEMPTIBLE_CPUS=0.
#
# Off by default anyway, because nothing here auto-restarts a preempted VM: it
# stays stopped until someone runs `instances start`, and a multi-week embed
# that stalls for a day costs more than the spot discount saves. Set SPOT=1 if
# you have something watching the instance and restarting it.
SPOT="${SPOT:-0}"

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
apt-get install -y ca-certificates curl gnupg git p7zip-full aria2 python3-venv
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Format on first boot only, then mount by device-name — /dev/sdX ordering is
# not stable across reboots but the google-* symlinks are. nofail so a detached
# disk degrades the box instead of bricking the boot.
mount_disk() {
  local dev="/dev/disk/by-id/google-$1" mnt="$2" uuid
  mkdir -p "$mnt"
  blkid "$dev" >/dev/null 2>&1 || \
    mkfs.ext4 -m 0 -F -E lazy_itable_init=0,lazy_journal_init=0,discard "$dev"
  uuid="$(blkid -s UUID -o value "$dev")"
  grep -q "$uuid" /etc/fstab || \
    echo "UUID=$uuid $mnt ext4 discard,defaults,nofail 0 2" >> /etc/fstab
  mount "$mnt" || true
}
mount_disk ao-data /data
mount_disk ao-scratch /scratch
mkdir -p /data/docker /scratch/ao-ingest
chmod 777 /scratch/ao-ingest

# Point docker at the survivable disk before anything creates a volume,
# otherwise qdrant_data and pg_data land on the boot disk and die with it.
systemctl stop docker 2>/dev/null || true
mkdir -p /etc/docker
echo '{ "data-root": "/data/docker" }' > /etc/docker/daemon.json
systemctl enable --now docker
touch /var/log/ao-bootstrap-done
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

echo "==> Data disk ao-data ($DATA_SIZE pd-balanced) — the corpus lives here"
# pd-balanced draws on SSD_TOTAL_GB, which is only 250GB on a free trial and
# cannot be raised there. Boot + data has to fit inside it.
gcloud compute disks create ao-data \
  --project="$PROJECT" --zone="$ZONE" \
  --size="$DATA_SIZE" --type=pd-balanced \
  --description="AgentOverflow corpus (qdrant + postgres). Survives instance deletion." \
  || echo "    (already exists, skipping)"

echo "==> Scratch disk ao-scratch ($SCRATCH_SIZE pd-standard) — dumps and shards"
gcloud compute disks create ao-scratch \
  --project="$PROJECT" --zone="$ZONE" \
  --size="$SCRATCH_SIZE" --type=pd-standard \
  --description="AgentOverflow ingest scratch. Disposable once the corpus is built." \
  || echo "    (already exists, skipping)"

echo "==> Daily snapshot schedule ao-daily-snap (7 day retention)"
# keep-auto-snapshots means the snapshots outlive the disk too, so even
# "delete the disk as well" is recoverable.
gcloud compute resource-policies create snapshot-schedule ao-daily-snap \
  --project="$PROJECT" --region="$REGION" \
  --daily-schedule --start-time=09:00 \
  --max-retention-days=7 \
  --on-source-disk-delete=keep-auto-snapshots \
  --description="Daily AgentOverflow corpus snapshot" \
  || echo "    (already exists, skipping)"

gcloud compute disks add-resource-policies ao-data \
  --project="$PROJECT" --zone="$ZONE" --resource-policies=ao-daily-snap \
  || echo "    (already attached, skipping)"

echo "==> Instance $NAME ($MACHINE_TYPE, $BOOT_SIZE boot, debian-12, deletion-protected)"
# Via a file, not --metadata: the startup script has commas and newlines that
# gcloud's dict parser chokes on.
STARTUP_FILE="$(mktemp)"
trap 'rm -f "$STARTUP_FILE"' EXIT
printf '%s' "$STARTUP_SCRIPT" > "$STARTUP_FILE"

SPOT_FLAGS=()
if [[ "$SPOT" == "1" ]]; then
  SPOT_FLAGS=(--provisioning-model=SPOT --instance-termination-action=STOP)
fi

# auto-delete=no on both data disks is the whole point: deleting the instance
# detaches them instead of destroying them.
gcloud compute instances create "$NAME" \
  --project="$PROJECT" \
  --zone="$ZONE" \
  --machine-type="$MACHINE_TYPE" \
  "${SPOT_FLAGS[@]}" \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size="$BOOT_SIZE" \
  --boot-disk-type=pd-balanced \
  --disk=name=ao-data,device-name=ao-data,mode=rw,auto-delete=no \
  --disk=name=ao-scratch,device-name=ao-scratch,mode=rw,auto-delete=no \
  --tags=ao-api \
  --deletion-protection \
  --metadata-from-file=startup-script="$STARTUP_FILE" \
  || echo "    (already exists, skipping)"

IP=$(gcloud compute instances describe "$NAME" --project="$PROJECT" --zone="$ZONE" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)' 2>/dev/null || true)

cat <<EOF

Done. External IP: ${IP:-<pending>}

Next steps:
  1. Wait ~2-3 min for the startup script, then SSH in (as a named user —
     debian-12 refuses root):
       gcloud compute ssh aoops@$NAME --project=$PROJECT --zone=$ZONE
  2. Confirm the disks came up before anything else:
       df -h /data /scratch && sudo docker info | grep "Docker Root Dir"
     Docker Root Dir must be /data/docker. If it isn't, stop and fix it —
     every volume created before that point is on the wrong disk.
  3. Follow deploy/RUNBOOK.md from step 4 (clone repo, configure .env,
     docker compose up -d, run the ingestion pipeline).

Reserve the IP before pointing DNS at it, or a stop/start rotates it:
  gcloud compute addresses create ao-ip --project=$PROJECT --region=$REGION --addresses=${IP:-<ip>}

After ingestion finishes, downsize to cut cost (~half):
  gcloud compute instances stop $NAME --project=$PROJECT --zone=$ZONE
  gcloud compute instances set-machine-type $NAME --project=$PROJECT --zone=$ZONE --machine-type=e2-standard-2
  gcloud compute instances start $NAME --project=$PROJECT --zone=$ZONE
EOF
