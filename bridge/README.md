# HazelPOS Bridge

The HazelPOS server cannot reach printers on your shop's Wi-Fi, so it only queues tickets. The Bridge is a small program on one PC in the shop that fetches them and prints. It only makes outbound connections, so the router needs no setup.

## Set up
1. In HazelPOS: Settings → Printers → **Set up printer helper**. Copy the key (it is shown once).
2. On the shop PC, install Node 22 or newer and copy the `bridge/` and `server/printer.js` files (the whole HazelPOS folder works too).
3. Create `bridge/config.json`:
   ```json
   {"server":"https://your-hazelpos-address","key":"THE-KEY","receipt":"192.168.1.50:9100","kitchen":"192.168.1.51:9100"}
   ```
   A printer is `host:port` (network) or a device on this PC: `/dev/usb/lp0`, `COM3`, `\\.\USB001`. Test pages go to the receipt printer.
4. Test it: `node bridge/index.js --check`
5. Start it: `node bridge/index.js` (or `--config path/to/config.json`). Keep it running; start it with the PC.

If the Bridge is off, HazelPOS shows "Printer helper is offline" and keeps tickets for 30 minutes. Older kitchen tickets are not printed; use Reprint in Settings → Printers.
