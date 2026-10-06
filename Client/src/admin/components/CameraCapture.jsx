import { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, Upload, X } from 'lucide-react';
import Modal from './ui/Modal';

function canUseLiveCamera() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** Live camera capture. Returns a JPEG File through onCapture; no gallery picking. */
export function CameraModal({ open, onClose, onCapture, title = 'Take a photo', facing = 'environment' }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fallbackRef = useRef(null);
  const [facingMode, setFacingMode] = useState(facing);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    if (!canUseLiveCamera()) {
      setError('Live camera is not available on this device.');
      return undefined;
    }
    let cancelled = false;
    setReady(false);
    setError('');
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setReady(true);
      })
      .catch(() => setError('Allow camera access to take the photo.'));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, facingMode]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' }));
        onClose();
      },
      'image/jpeg',
      0.85
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      <div className="space-y-3">
        {error ? (
          <div className="space-y-3">
            <p className="text-sm text-amber-700">{error}</p>
            <button type="button" className="btn-primary text-sm" onClick={() => fallbackRef.current?.click()}>
              <Camera className="w-4 h-4" /> Open camera
            </button>
            <input
              ref={fallbackRef}
              type="file"
              accept="image/*"
              capture={facing === 'user' ? 'user' : 'environment'}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) {
                  onCapture(file);
                  onClose();
                }
              }}
            />
          </div>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-xl bg-black aspect-[3/4] sm:aspect-video">
              <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
              {!ready ? (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                  Starting camera…
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}
              >
                <RefreshCw className="w-4 h-4" /> Flip
              </button>
              <button type="button" className="btn-primary text-sm" disabled={!ready} onClick={capture}>
                <Camera className="w-4 h-4" /> Capture
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Camera-only photo field (attendance, task completion). */
export function CameraPhotoField({ file, onChange, label = 'Photo', facing = 'environment', required = false }) {
  const [open, setOpen] = useState(false);
  const preview = useObjectUrl(file);
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-gray-700">
        {label} {required ? <span className="text-red-500">*</span> : null}
      </div>
      {preview ? (
        <div className="relative w-fit">
          <img src={preview} alt="" className="h-28 rounded-lg border object-cover" />
          <button
            type="button"
            className="absolute -top-2 -right-2 rounded-full bg-white p-1 shadow border"
            onClick={() => onChange(null)}
            aria-label="Remove photo"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : null}
      <button type="button" className="btn-secondary text-sm" onClick={() => setOpen(true)}>
        <Camera className="w-4 h-4" /> {file ? 'Retake photo' : 'Take photo'}
      </button>
      <CameraModal open={open} onClose={() => setOpen(false)} onCapture={onChange} facing={facing} />
    </div>
  );
}

/** Proof field: upload a file or take a photo. Supports several files when `multiple`. */
export function ProofPicker({ files, onChange, label = 'Proof', multiple = false, required = false, accept = 'image/*,application/pdf' }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const list = files ? (Array.isArray(files) ? files : [files]) : [];
  const add = (incoming) => {
    const next = multiple ? [...list, ...incoming] : incoming.slice(0, 1);
    onChange(multiple ? next : next[0] || null);
  };
  const remove = (idx) => {
    const next = list.filter((_, i) => i !== idx);
    onChange(multiple ? next : null);
  };
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-gray-700">
        {label} {required ? <span className="text-red-500">*</span> : null}
      </div>
      {list.length ? (
        <div className="flex flex-wrap gap-2">
          {list.map((f, idx) => (
            <FileChip key={`${f.name}-${idx}`} file={f} onRemove={() => remove(idx)} />
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-xs" onClick={() => inputRef.current?.click()}>
          <Upload className="w-3.5 h-3.5" /> Upload
        </button>
        <button type="button" className="btn-secondary text-xs" onClick={() => setOpen(true)}>
          <Camera className="w-3.5 h-3.5" /> Camera
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files || []);
          e.target.value = '';
          if (picked.length) add(picked);
        }}
      />
      <CameraModal open={open} onClose={() => setOpen(false)} onCapture={(f) => add([f])} />
    </div>
  );
}

function FileChip({ file, onRemove }) {
  const preview = useObjectUrl(file && String(file.type).startsWith('image/') ? file : null);
  return (
    <div className="relative">
      {preview ? (
        <img src={preview} alt="" className="h-16 w-16 rounded-lg border object-cover" />
      ) : (
        <div className="h-16 w-24 rounded-lg border bg-gray-50 px-2 py-1 text-[10px] text-gray-600 break-all overflow-hidden">
          {file.name}
        </div>
      )}
      <button
        type="button"
        className="absolute -top-2 -right-2 rounded-full bg-white p-0.5 shadow border"
        onClick={onRemove}
        aria-label="Remove file"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function useObjectUrl(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}
