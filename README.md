# 🛡️ UDP Custom - Installer & Manager
### 👑 Version ⇢ 2.5-Lite (Premium Edition: UDP by Meddix Pro)

UDP (User Datagram Protocol) is a high-speed network communication protocol that operates on top of IP (Internet Protocol). Optimized for speed and low latency, it is the ultimate protocol for bypass tunneling, gaming, and secure, high-throughput connections.

---
<center><img src="https://raw.githubusercontent.com/maddix123/UDP-by-meddix-pro/main/bin/banner.jpg" alt="banner" width="450"/></center>

---

## ⚡ Premium Enhancements in this Version:

* **🛑 Instant Active Session Disconnections:** When a client's time is done, the server doesn't just lock the account—it **instantly force-terminates all active tunneling processes, sockets, and dropbear sessions** associated with that user (`pkill -9 -u`), kicking them off the server immediately!
* **⏱️ High-Precision Expiration Rates:** Support for specifying client durations in **Days (`d`)**, **Hours (`h`)**, and **Minutes (`m`)**!
  * Example: `30d` (30 Days), `12h` (12 Hours), `45m` (45 Minutes).
* **📊 Live Remaining Time Meters:** The status dashboard parses and displays exactly how much time is left in high-precision units (e.g. `25d`, `8h`, or `35m`) in real-time.

---

## 🚀 One-Line Installation

Copy and paste this **single command** into your Ubuntu server terminal to install, configure, and run the UDP-Custom service on your server:

```bash
sudo -s
```
```bash
wget "https://raw.githubusercontent.com/maddix123/UDP-by-meddix-pro/main/install.sh" -O install.sh && chmod +x install.sh && ./install.sh
```

---

## 🛠️ Configuration & Customization:
* **Port Exclusions:** Use the optional port exclusion feature if UDP ports between 1-65535 are already in use by other VPN tunnels (e.g. wireguard, openvpn udp, or dnstt).
* **Manual Setup:** Edit the configuration file path at `/root/udp/config.json`, change settings as desired, and reboot.
* **Format Exclusions:** Separate excluded ports with a comma (e.g. `53,5300,1194`).

---

## 👥 Telegram Support & Credits
* **Developer:** [maddix123](https://github.com/maddix123)
* **Team Credits:** [ePro_Dev_Team](https://t.me/ePro_Dev_Team/141), @rudi9999

---
> _Refined, secured, and crafted with ❤️ for the ultimate UDP tunneling experience!_
