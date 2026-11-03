import tls from 'node:tls';
import { readFile, writeFile } from 'node:fs/promises';
const endpoint = process.env.TELEMETRY_URL || process.env.VITE_TELEMETRY_URL;
if (!endpoint) throw new Error('Configure TELEMETRY_URL first.');
const hostname = new URL(endpoint).hostname;
const root = await new Promise((resolve, reject) => {
  const socket = tls.connect({
    host: hostname,
    port: 443,
    servername: hostname,
    rejectUnauthorized: true,
  });
  socket.setTimeout(15000, () => socket.destroy(new Error('TLS certificate lookup timed out.')));
  socket.once('error', reject);
  socket.once('secureConnect', () => {
    try {
      if (!socket.authorized) throw new Error('TLS chain was not verified.');
      let cert = socket.getPeerCertificate(true);
      const visited = new Set();
      while (
        cert.issuerCertificate &&
        cert.issuerCertificate.fingerprint256 !== cert.fingerprint256 &&
        !visited.has(cert.fingerprint256)
      ) {
        visited.add(cert.fingerprint256);
        cert = cert.issuerCertificate;
      }
      if (!cert.raw) throw new Error('Trusted root certificate unavailable.');
      const pem = `-----BEGIN CERTIFICATE-----\n${cert.raw
        .toString('base64')
        .match(/.{1,64}/g)
        .join('\n')}\n-----END CERTIFICATE-----`;
      resolve({ pem, subject: cert.subject.CN });
    } catch (e) {
      reject(e);
    } finally {
      socket.end();
    }
  });
});
const file = new URL('../firmware/asqac/secrets.h', import.meta.url);
const source = await readFile(file, 'utf8');
await writeFile(
  file,
  source.replace(
    /const char\* TLS_ROOT_CA = R"PEM\([\s\S]*?\)PEM";/,
    `const char* TLS_ROOT_CA = R"PEM(\n${root.pem}\n)PEM";`,
  ),
);
console.log(
  `Installed verified TLS root CA (${root.subject}) for ${hostname} in ignored firmware secrets.h.`,
);
