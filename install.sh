#!/bin/bash
set -e

# Run as root
[[ "$(whoami)" != "root" ]] && {
    echo -e "\033[1;33m[\033[1;31mErro\033[1;33m] \033[1;37m- \033[1;33myou need to run as root\033[0m"
    exit 0
}

#=== setup ===
cd 

# 🔥 SAFE-GUARD: Backup existing user details before wiping the directories
echo "💾 Backing up existing user expiration & contact details..."
rm -rf /tmp/udp_expiration_backup
if [ -d "/etc/UDPCustom/expiration" ]; then
    mkdir -p /tmp/udp_expiration_backup
    cp -r /etc/UDPCustom/expiration/* /tmp/udp_expiration_backup/
    echo "✅ Backup completed successfully!"
fi

rm -rf /root/udp
mkdir -p /root/udp
rm -rf /etc/UDPCustom
mkdir -p /etc/UDPCustom
sudo touch /etc/UDPCustom/udp-custom
udp_dir='/etc/UDPCustom'
udp_file='/etc/UDPCustom/udp-custom'

sudo apt update -y
sudo apt upgrade -y
sudo apt install -y wget
sudo apt install -y curl
sudo apt install -y dos2unix
sudo apt install -y neofetch
sudo apt install -y git

# Install Node.js for our Web Portal
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# Install PM2 for background process execution
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
fi

# Open Port 200 on Firewall
echo "🛡️ Configuring Firewall (Opening Port 200 for Web Portal)..."
if command -v ufw &> /dev/null; then
    ufw allow 200/tcp || true
    ufw reload || true
    echo "✅ UFW allowed TCP Port 200"
elif command -v iptables &> /dev/null; then
    iptables -A INPUT -p tcp --dport 200 -j ACCEPT || true
    echo "✅ Iptables allowed TCP Port 200"
fi

source <(curl -sSL 'https://raw.githubusercontent.com/maddix123/UDP-by-meddix-pro/main/module/module')

time_reboot() {
  print_center -ama "${a92:-System/Server Reboot In} $1 ${a93:-Seconds}"
  REBOOT_TIMEOUT="$1"

  while [ $REBOOT_TIMEOUT -gt 0 ]; do
    print_center -ne "-$REBOOT_TIMEOUT-\r"
    sleep 1
    : $((REBOOT_TIMEOUT--))
  done
  rm /home/ubuntu/install.sh &>/dev/null
  rm /root/install.sh &>/dev/null
  echo -e "\033[01;31m\033[1;33m More Updates, Follow Us On \033[1;31m(\033[1;36mTelegram\033[1;31m): \033[1;37m@voltssh\033[0m"
  reboot
}

# Safely check OS compatibility without crashing under set -e
OS_NAME="Ubuntu"
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_NAME=$NAME
fi

clear
echo ""
print_center -ama "A Compatible OS/Environment Found: $OS_NAME"
print_center -ama " ⇢ Installation begins...! <"
sleep 3

# [change timezone to UTC +0]
echo ""
echo " ⇢ Change timezone to UTC +0"
echo " ⇢ for Africa/Accra [GH] GMT +00:00"
ln -fs /usr/share/zoneinfo/Africa/Accra /etc/localtime
sleep 3

# [+clean up+]
rm -rf $udp_file &>/dev/null
rm -rf /etc/UDPCustom/udp-custom &>/dev/null
rm -rf /etc/limiter.sh &>/dev/null
rm -rf /etc/UDPCustom/limiter.sh &>/dev/null
rm -rf /etc/UDPCustom/module &>/dev/null
rm -rf /usr/bin/udp &>/dev/null
rm -rf /etc/UDPCustom/udpgw.service &>/dev/null
rm -rf /etc/udpgw.service &>/dev/null
systemctl stop udpgw &>/dev/null
systemctl stop udp-custom &>/dev/null

# [+get files ⇣⇣⇣+]
source <(curl -sSL 'https://raw.githubusercontent.com/maddix123/UDP-by-meddix-pro/main/module/module') &>/dev/null
wget -O /etc/UDPCustom/module 'https://raw.githubusercontent.com/maddix123/UDP-by-meddix-pro/main/module/module' &>/dev/null
chmod +x /etc/UDPCustom/module

wget "https://raw.githubusercontent.com/maddix123/UDP-by-meddix-pro/main/bin/udp-custom-linux-amd64" -O /root/udp/udp-custom &>/dev/null
chmod +x /root/udp/udp-custom

wget -O /etc/limiter.sh 'https://raw.githubusercontent.com/maddix123/UDP-by-meddix-pro/main/module/limiter.sh'
cp /etc/limiter.sh /etc/UDPCustom
chmod +x /etc/limiter.sh
chmod +x /etc/UDPCustom

# [+udpgw+]
wget -O /etc/udpgw 'https://raw.githubusercontent.com/maddix123/UDP-by-meddix-pro/main/module/udpgw'
mv /etc/udpgw /bin
chmod +x /bin/udpgw

# [+service+]
wget -O /etc/udpgw.service 'https://raw.githubusercontent.com/maddix123/UDP-by-meddix-pro/main/config/udpgw.service'
wget -O /etc/udp-custom.service 'https://raw.githubusercontent.com/maddix123/UDP-by-meddix-pro/main/config/udp-custom.service'

mv /etc/udpgw.service /etc/systemd/system
mv /etc/udp-custom.service /etc/systemd/system

chmod 640 /etc/systemd/system/udpgw.service
chmod 640 /etc/systemd/system/udp-custom.service

systemctl daemon-reload &>/dev/null
systemctl enable udpgw &>/dev/null
systemctl start udpgw &>/dev/null
systemctl enable udp-custom &>/dev/null
systemctl start udp-custom &>/dev/null

# [+config+]
wget "https://raw.githubusercontent.com/maddix123/UDP-by-meddix-pro/main/config/config.json" -O /root/udp/config.json &>/dev/null
chmod +x /root/udp/config.json

# [+menu+]
wget -O /usr/bin/udp 'https://raw.githubusercontent.com/maddix123/UDP-by-meddix-pro/main/module/udp' 
chmod +x /usr/bin/udp

# [+Deploy Web Portal on Port 200+]
echo "📦 Deploying Web Portal on Port 200..."
rm -rf /etc/UDPCustom/web-portal
mkdir -p /etc/UDPCustom/web-portal
rm -rf /tmp/udp-by-meddix-pro
git clone https://github.com/maddix123/UDP-by-meddix-pro.git /tmp/udp-by-meddix-pro &>/dev/null
cp -r /tmp/udp-by-meddix-pro/web-portal/* /etc/UDPCustom/web-portal/

# 🔥 RESTORE: Safely restore their pre-filled client details from backup
if [ -d "/tmp/udp_expiration_backup" ]; then
    echo "♻️ Restoring your existing user expiration & contact details..."
    mkdir -p /etc/UDPCustom/expiration
    cp -r /tmp/udp_expiration_backup/* /etc/UDPCustom/expiration/
    rm -rf /tmp/udp_expiration_backup
    echo "✅ Restore completed successfully!"
fi

cd /etc/UDPCustom/web-portal
npm install --legacy-peer-deps &>/dev/null
pm2 delete udp-web-portal 2>/dev/null || true
pm2 start server.js --name udp-web-portal
pm2 save &>/dev/null

ufw disable &>/dev/null
sudo apt-get remove --purge ufw firewalld -y &>/dev/null
apt remove netfilter-persistent -y &>/dev/null
clear
echo ""
echo ""
print_center -ama "${a103:-setting up, please wait...}"
sleep 3
title "${a102:-Installation Successful}"
print_center -ama "To show CLI menu type: udp\n"
print_center -ama "Web Portal URL: http://your-ip:200\n"
msg -bar
time_reboot 5
