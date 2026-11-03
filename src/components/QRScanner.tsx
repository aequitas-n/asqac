import { useEffect, useId, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
export default function QRScanner({ onScan }: { onScan: (value: string) => void }) {
  const id = `qr-${useId().replaceAll(':', '')}`;
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    const scanner = new Html5Qrcode(id);
    void scanner
      .start(
        { facingMode: 'environment' },
        { fps: 8, qrbox: { width: 220, height: 220 } },
        (text) => {
          if (!stopped) {
            stopped = true;
            onScan(text);
          }
        },
        () => {},
      )
      .then(() => {
        if (stopped && scanner.isScanning) void scanner.stop().catch(() => {});
      })
      .catch((e) => {
        if (!stopped)
          setError(`Camera unavailable: ${String(e)}. Select the capsule manually instead.`);
      });
    return () => {
      stopped = true;
      if (scanner.isScanning) void scanner.stop().catch(() => {});
    };
  }, [id, onScan]);
  return (
    <>
      <div id={id} className="qr-reader" />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <p className="muted small">
        Allow camera access, then scan a printed capsule label. Camera access requires HTTPS or
        localhost.
      </p>
    </>
  );
}
