import { createSocket } from 'node:dgram';

/**
 * Our own address on the local network. No traffic goes anywhere: a UDP
 * socket is merely "connected" so the kernel picks the matching source
 * address; not a single packet leaves the machine.
 */
export function ownLanAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = createSocket('udp4');
    sock.once('error', () => {
      sock.close();
      resolve(null);
    });
    try {
      sock.connect(9, '192.0.2.1', () => {
        try {
          resolve(sock.address().address);
        } catch {
          resolve(null);
        } finally {
          sock.close();
        }
      });
    } catch {
      resolve(null);
    }
  });
}
