'use client';

import { useEffect, useState } from 'react';
import { Copy, Download, Share2 } from 'lucide-react';
import QRCode from 'qrcode';

export default function PublicQr({ url, filename }: { url: string; filename: string }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, { width: 1024, margin: 4, errorCorrectionLevel: 'M' })
      .then(value => { if (active) setSrc(value); })
      .catch(() => { if (active) setError('Unable to generate QR code.'); });
    return () => { active = false; };
  }, [url]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch { setError('Unable to copy the link.'); }
  }

  async function share() {
    try {
      const blob = await (await fetch(src)).blob();
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Health & Safety QR code' });
      } else if (navigator.share) {
        await navigator.share({ title: 'Health & Safety', url });
      } else {
        await copyLink();
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) setError('Unable to share. You can download the PNG or copy the link.');
    }
  }

  return <div className="space-y-4 min-w-0">
    <div className="mx-auto aspect-square w-full max-w-[280px] bg-white flex items-center justify-center">
      {src ? <img src={src} alt="Public access QR code" width={1024} height={1024} className="w-full h-full object-contain" /> : <span className="text-sm text-slate-500" role="status">{error || 'Generating QR code...'}</span>}
    </div>
    <div className="flex flex-wrap justify-center gap-3 text-sm">
      {src && <><a href={src} download={filename} className="inline-flex items-center gap-1 text-blue-600"><Download size={15} /> Download PNG</a><button type="button" onClick={share} className="inline-flex items-center gap-1 text-blue-600"><Share2 size={15} /> Share</button></>}
      <button type="button" onClick={copyLink} className="inline-flex items-center gap-1 text-blue-600"><Copy size={15} /> {copied ? 'Link copied' : 'Copy link'}</button>
    </div>
    {error && src && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </div>;
}