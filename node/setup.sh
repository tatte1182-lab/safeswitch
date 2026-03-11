#!/bin/bash
set -e

echo "=== SafeSwitch Node Setup ==="

# Install dependencies
apt-get update
apt-get install -y wireguard wireguard-tools docker.io docker-compose curl

# Enable IP forwarding
echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
sysctl -p

# Free port 53 for SafeSwitch DNS
systemctl stop systemd-resolved || true
systemctl disable systemd-resolved || true
rm -f /etc/resolv.conf
echo "nameserver 1.1.1.1" > /etc/resolv.conf

# Generate WireGuard keys if not present
if [ ! -f /etc/wireguard/privatekey ]; then
  echo "[wg] generating keypair..."
  mkdir -p /etc/wireguard
  wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey
  chmod 600 /etc/wireguard/privatekey
  echo "[wg] public key: $(cat /etc/wireguard/publickey)"
fi

PRIVATE_KEY=$(cat /etc/wireguard/privatekey)

# Write wg0.conf from template
cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = 10.10.0.1/24
ListenPort = 51820
PrivateKey = ${PRIVATE_KEY}

# Peers managed dynamically by node-agent
EOF

chmod 600 /etc/wireguard/wg0.conf

# Start WireGuard
systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0

echo "[wg] WireGuard interface up"
wg show wg0

# Start node-agent via docker-compose
echo "[docker] building and starting node-agent..."
docker-compose up -d --build

echo ""
echo "=== Setup complete ==="
echo "Node public key: $(cat /etc/wireguard/publickey)"
echo "Add this to your .env as the node's wireguard_public_key if needed."
echo ""
echo "Check logs with: docker-compose logs -f"
