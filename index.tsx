import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

declare const jsQR: any;

// Configuration: paste your deployed Apps Script Web App URL and Google Sheet URL
// Example SHEET_URL: https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit#gid=0
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyBtYkmEKhr65swiesVKtQEZas_3gEDM3l6WEmR6cAF0uWqvACZWUIw1sJzWMpsUgbTiQ/exec';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1KhWbTmSkAP2Pxs0Yez4sVyZwlDxxPp323jp5Fq58iL4/edit?gid=0#gid=0';

// Registration tab headers we will write
const REGISTRATION_HEADERS = ['QR Code', 'Mobile', 'Name', 'Status', 'OfferType', 'RegisteredDate'] as const;

// Configure sheet tabs (GIDs)
// Offers tab columns: Type | Status | Start Date | End Date | Qr Codes
// Registrations tab columns: QR Code | Mobile | Name | Status | OfferType | RegisteredDate
const OFFERS_GID = 2099398649;
// NEW: Append-only registrations sheet gid (final write/uniqueness checks)
const REGISTRATIONS_GID = 1257095471;
// QR master list tab gid (for existence validation only)
const VALID_QR_LIST_GID = 0;

// Debug logging
const DEBUG = true;
function debugLog(...args: any[]) {
  if (DEBUG) console.log('[CouponApp]', ...args);
}

type SheetInfo = { sheetId: string | null; gid: number | null };

function extractSheetInfo(url: string): SheetInfo {
  try {
    if (!url) return { sheetId: null, gid: null };
    const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const gidMatch = url.match(/[?#&]gid=(\d+)/);
    const sheetId = idMatch ? idMatch[1] : null;
    const gid = gidMatch ? Number(gidMatch[1]) : null;
    return { sheetId, gid };
  } catch {
    return { sheetId: null, gid: null };
  }
}

// Load a Google Sheet tab via gviz JSON using <script> injection to avoid CORS
async function loadGvizSheet(sheetId: string, gid: number): Promise<any> {
  debugLog('loadGvizSheet:start', { sheetId, gid });
  return new Promise((resolve, reject) => {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json;headers=1&gid=${gid}`;
    const w: any = window as any;
    const root = (w.google = w.google || {});
    root.visualization = root.visualization || {};
    root.visualization.Query = root.visualization.Query || {};
    const prev = root.visualization.Query.setResponse;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out loading sheet'));
    }, 15000);
    function cleanup() {
      clearTimeout(timeout);
      if (prev) root.visualization.Query.setResponse = prev;
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }
    root.visualization.Query.setResponse = function(resp: any) {
      try {
        try {
          const cols = resp && resp.table && Array.isArray(resp.table.cols)
            ? resp.table.cols.map((c: any) => (c && c.label) || '')
            : [];
          const rowCount = resp && resp.table && Array.isArray(resp.table.rows)
            ? resp.table.rows.length
            : 0;
          debugLog('loadGvizSheet:response', { sheetId, gid, cols, rowCount });
        } catch {}
        resolve(resp);
      } finally {
        cleanup();
      }
    };
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error('Failed to load sheet'));
    };
    document.head.appendChild(script);
  });
}

function tableToObjects(resp: any): Array<Record<string, string>> {
  if (!resp || !resp.table) return [];
  let cols: string[] = (resp.table.cols || []).map((c: any) => String((c && c.label) || '').trim());
  let rows = resp.table.rows || [];

  // Fallback: if labels are blank, derive headers from the first row
  const allBlank = cols.length > 0 && cols.every(h => !h);
  if (allBlank && rows.length > 0) {
    const headerCells = rows[0].c || [];
    cols = headerCells.map((cell: any, idx: number) => {
      const raw = cell && (cell.v != null ? cell.v : cell.f);
      const header = (raw == null ? '' : String(raw)).trim();
      return header || `col${idx + 1}`;
    });
    rows = rows.slice(1);
    debugLog('tableToObjects:fallback_headers', { derivedHeaders: cols });
  }

  const out: Array<Record<string, string>> = [];
  for (const r of rows) {
    const cells = (r && r.c) || [];
    const obj: Record<string, string> = {};
    let empty = true;
    for (let i = 0; i < cols.length; i++) {
      const v = cells[i] && (cells[i].v != null ? cells[i].v : cells[i].f);
      const s = v == null ? '' : String(v);
      if (s.trim()) empty = false;
      obj[cols[i]] = s;
    }
    if (!empty) out.push(obj);
  }
  debugLog('tableToObjects:converted', { columns: cols, rows: out.length });
  return out;
}

function normalizeKeys<T extends Record<string, any>>(row: T): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(row || {})) {
    out[String(k || '').trim().toLowerCase()] = String(row[k] ?? '');
  }
  return out;
}

function parseDdMmYyyy(value: string): Date | null {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/]?(\d{2,4})$/);
  if (!m) return null;
  let d = Number(m[1]);
  let mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
  return isNaN(dt.getTime()) ? null : dt;
}

function isDateInRangeInclusive(now: Date, start: Date | null, end: Date | null): boolean {
  const t = now.getTime();
  const startMs = start ? start.getTime() : -Infinity;
  const endMs = end ? end.getTime() + 24 * 60 * 60 * 1000 - 1 : Infinity;
  return t >= startMs && t <= endMs;
}

function splitCodes(csvLike: string): string[] {
  // Split by comma (and tolerate stray newlines), trim whitespace
  return String(csvLike || '')
    .split(/[\n\r,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

async function resolveOfferForQr(sheetId: string, qrCode: string): Promise<{ ok: true; offerType: string } | { ok: false; error: string }>{
  try {
    const resp = await loadGvizSheet(sheetId, OFFERS_GID);
    const rows = tableToObjects(resp);
    const now = new Date();
    debugLog('resolveOfferForQr:start', { qrCode, offersCount: rows.length });
    for (const r of rows) {
      const R = normalizeKeys(r);
      const type = String(R['type'] || '').trim();
      const status = String(R['status'] || '').trim().toLowerCase();
      const start = parseDdMmYyyy(R['start date']);
      const end = parseDdMmYyyy(R['end date']);
      const codesField = R['qr codes'] || R['qrcodes'] || R['qr_code'] || R['qr'];
      const codes = new Set(splitCodes(codesField));
      const contains = codes.has(String(qrCode).trim());
      debugLog('resolveOfferForQr:row', { type, status, start, end, numCodes: codes.size, contains });
      if (!contains) continue;
      if (status !== 'active') return { ok: false, error: 'Offer not active for this QR code' };
      if (!isDateInRangeInclusive(now, start, end)) return { ok: false, error: 'Offer not valid on this date' };
      return { ok: true, offerType: type };
    }
    return { ok: false, error: 'QR code not eligible for any offer' };
  } catch (e) {
    debugLog('resolveOfferForQr:error', e);
    return { ok: false, error: 'Could not read offers' };
  }
}

async function isQrAlreadyAssigned(sheetId: string, qrCode: string): Promise<{ assigned: boolean; who?: string }>{
  try {
    const resp = await loadGvizSheet(sheetId, REGISTRATIONS_GID);
    const rows = tableToObjects(resp);
    const existingHeaders = rows.length > 0 ? Object.keys(rows[0]) : Array.from(REGISTRATION_HEADERS);
    const hQr = findHeaderName(existingHeaders, 'QR Code') || 'QR Code';
    const hMobile = findHeaderName(existingHeaders, 'Mobile') || 'Mobile';
    const hName = findHeaderName(existingHeaders, 'Name') || 'Name';
    debugLog('isQrAlreadyAssigned:start', { qrCode, registrationsCount: rows.length, hQr, hMobile, hName });
    for (const r of rows) {
      if (String(r[hQr] || '').trim() === String(qrCode).trim()) {
        const who = `${String(r[hName] || '').trim()} ${String(r[hMobile] || '').trim()}`.trim();
        return { assigned: true, who };
      }
    }
    return { assigned: false };
  } catch (e) {
    debugLog('isQrAlreadyAssigned:error', e);
    return { assigned: false };
  }
}

async function isMobileAlreadyAssigned(sheetId: string, mobile: string): Promise<{ assigned: boolean; who?: string }>{
  try {
    const resp = await loadGvizSheet(sheetId, REGISTRATIONS_GID);
    const rows = tableToObjects(resp);
    const existingHeaders = rows.length > 0 ? Object.keys(rows[0]) : Array.from(REGISTRATION_HEADERS);
    const hQr = findHeaderName(existingHeaders, 'QR Code') || 'QR Code';
    const hMobile = findHeaderName(existingHeaders, 'Mobile') || 'Mobile';
    const hName = findHeaderName(existingHeaders, 'Name') || 'Name';
    debugLog('isMobileAlreadyAssigned:start', { mobile, registrationsCount: rows.length, hQr, hMobile, hName });
    for (const r of rows) {
      if (String(r[hMobile] || '').trim() === String(mobile).trim()) {
        const who = `${String(r[hName] || '').trim()} ${String(r[hQr] || '').trim()}`.trim();
        return { assigned: true, who };
      }
    }
    return { assigned: false };
  } catch (e) {
    debugLog('isMobileAlreadyAssigned:error', e);
    return { assigned: false };
  }
}

async function isQrCodeValid(sheetId: string, qrCode: string): Promise<boolean> {
  try {
    const resp = await loadGvizSheet(sheetId, VALID_QR_LIST_GID);
    const rows = tableToObjects(resp);
    const existingHeaders = rows.length > 0 ? Object.keys(rows[0]) : Array.from(REGISTRATION_HEADERS);
    const hQr = findHeaderName(existingHeaders, 'QR Code') || 'QR Code';
    const set = new Set(rows.map(r => String(r[hQr] || '').trim()).filter(Boolean));
    const exists = set.has(String(qrCode).trim());
    debugLog('isQrCodeValid', { qrCode, exists, total: set.size, hQr, gid: VALID_QR_LIST_GID });
    return exists;
  } catch (e) {
    debugLog('isQrCodeValid:error', e);
    // If we cannot validate, fail closed to avoid accepting invalid codes
    return false;
  }
}

// Not used for writing anymore, but keeping helper if needed
async function getRegistrationHeaders(sheetId: string): Promise<string[]> {
  try {
    const resp = await loadGvizSheet(sheetId, REGISTRATIONS_GID);
    const objs = tableToObjects(resp);
    if (objs.length > 0) return Object.keys(objs[0]);
    return Array.from(REGISTRATION_HEADERS);
  } catch (e) {
    return Array.from(REGISTRATION_HEADERS);
  }
}

function findHeaderName(existingHeaders: string[], target: string): string | null {
  const norm = (s: string) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const t = norm(target);
  for (const h of existingHeaders) {
    if (norm(h) === t) return h; // exact ignoring spaces/case
  }
  // common variants
  const variants = [target, target.replace(/\s+/g, ''), target.replace(/\s+/g, '_')];
  for (const v of variants) {
    const vt = norm(v);
    for (const h of existingHeaders) {
      if (norm(h) === vt) return h;
    }
  }
  return null;
}

async function postToAppsScript(params: {
  scriptUrl: string;
  action: 'append' | 'replace' | 'assign' | 'delete';
  sheetId: string;
  gid: number | null;
  headers: readonly string[];
  rows: any[][];
  matchColumns?: string[];
  matchValues?: any[];
}): Promise<{ success: boolean; error?: string }>{
  const body: any = {
    action: params.action,
    sheetId: params.sheetId,
    gid: params.gid == null ? 0 : params.gid,
    headers: params.headers,
    data: params.rows,
  };
  if (params.matchColumns && params.matchValues) {
    body.matchColumns = params.matchColumns;
    body.matchValues = params.matchValues;
  }
  try {
    const isDev = !!((import.meta as any).env && (import.meta as any).env.DEV);
    const url = isDev ? '/apps-script' : params.scriptUrl;
    if (params.action !== 'delete' && (!params.headers || !params.headers.length || !params.rows || !params.rows.length)) {
      debugLog('postToAppsScript:invalid_payload', { headers: params.headers, rows: params.rows });
      return { success: false, error: 'Client: Missing headers or data' };
    }
    const init: RequestInit = isDev
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'POST', mode: 'no-cors', body: JSON.stringify(body) };
    const res = await fetch(url, init);
    if (isDev) {
      try {
        const json = await res.json();
        debugLog('postToAppsScript:dev_response', json);
        return { success: !!json && json.success === true, error: json && json.error };
      } catch {
        return { success: false, error: 'Invalid dev response' };
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: 'Network/CORS error while contacting Apps Script' };
  }
}

const translations = {
  en: {
    registerCustomer: 'Issue Coupon Code',
    scanOrEnter: 'Scan QR or enter code to begin.',
    codeLabel: 'Coupon Code',
    codePlaceholder: 'Enter or Scan Coupon Code',
    mobileLabel: 'Mobile Number',
    mobilePlaceholder: 'e.g., 555-123-4567',
    nameLabel: 'Name',
    nameOptional: '(Optional)',
    namePlaceholder: "Enter customer's name",
    registerButton: 'Register',
    requiredError: 'Coupon Code and Mobile Number are required.',
    successMessage: 'Customer registered successfully!',
    scanQRCode: 'Scan QR Code',
    cancel: 'Cancel',
    cameraError: 'Could not access the camera. Please check permissions.',
    configError: 'Please set Script URL and Sheet URL in the app.',
    invalidSheetUrl: 'Invalid Google Sheet URL. Paste the full link including gid.',
    submitError: 'Could not save to sheet. Please try again.'
  },
  ta: {
    registerCustomer: 'கூப்பன் குறியீட்டை வழங்கு',
    scanOrEnter: 'தொடங்க QR ஐ ஸ்கேன் செய்யவும் அல்லது குறியீட்டை உள்ளிடவும்.',
    codeLabel: 'கூப்பன் குறியீடு',
    codePlaceholder: 'கூப்பன் குறியீட்டை உள்ளிடவும் அல்லது ஸ்கேன் செய்யவும்',
    mobileLabel: 'மொபைல் எண்',
    mobilePlaceholder: 'எ.கா., 555-123-4567',
    nameLabel: 'பெயர்',
    nameOptional: '(விருப்பத்தேர்வு)',
    namePlaceholder: "வாடிக்கையாளர் பெயரை உள்ளிடவும்",
    registerButton: 'பதிவு செய்யுங்கள்',
    requiredError: 'கூப்பன் குறியீடு மற்றும் மொபைல் எண் தேவை.',
    successMessage: 'வாடிக்கையாளர் வெற்றிகரமாக பதிவு செய்யப்பட்டார்!',
    scanQRCode: 'QR குறியீட்டை ஸ்கேன் செய்யவும்',
    cancel: 'ரத்துசெய்',
    cameraError: 'கேமராவை அணுக முடியவில்லை. அனுமதிகளைச் சரிபார்க்கவும்.',
    configError: 'Script URL மற்றும் Sheet URL அமைக்கவும்.',
    invalidSheetUrl: 'செல்லுபடியாகாத Google Sheet URL. முழு இணைப்பை ஒட்டவும் (gid உடன்).',
    submitError: 'ஷீட்டில் சேமிக்க முடியவில்லை. மீண்டும் முயற்சிக்கவும்.'
  },
  duplicateQrError: {
    en: 'This QR code is already linked to a mobile number.',
    ta: 'இந்த QR குறியீடு ஏற்கனவே ஒரு மொபைல் எண்ணுடன் இணைக்கப்பட்டுள்ளது.'
  },
  duplicateMobileError: {
    en: 'This mobile number is already linked to another QR code.',
    ta: 'இந்த மொபைல் எண் ஏற்கனவே வேறு QR குறியீட்டுடன் இணைக்கப்பட்டுள்ளது.'
  },
  invalidQrError: {
    en: 'Invalid QR code. Please enter a valid QR code from the sheet.',
    ta: 'செல்லுபடியாகாத QR குறியீடு. ஷீட்டில் உள்ள சரியான QR குறியீட்டை உள்ளிடவும்.'
  }
};

const App = () => {
  const [code, setCode] = useState('');
  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [error, setError] = useState('');
  const [language, setLanguage] = useState<'en' | 'ta'>('en');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [codeError, setCodeError] = useState('');
  const [mobileError, setMobileError] = useState('');
  const [nameError, setNameError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameId = useRef<number | null>(null);
  
  const t = translations[language];

  const handleLanguageChange = () => {
    setLanguage(prevLang => prevLang === 'en' ? 'ta' : 'en');
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    
    if (!code || !mobile) {
      setError(t.requiredError);
      return;
    }

    // Client-side format checks
    if (!/^\d{6}$/.test(code)) {
      setError('QR code must be exactly 6 digits.');
      return;
    }
    if (!/^\d{10}$/.test(mobile)) {
      setError('Mobile number must be exactly 10 digits.');
      return;
    }
    if (name && !/^[A-Za-z\s]+$/.test(name)) {
      setError('Name must contain only letters and spaces.');
      return;
    }

    if (!SCRIPT_URL || !SHEET_URL) {
      setError(t.configError);
      return;
    }

    const { sheetId, gid } = extractSheetInfo(SHEET_URL);
    if (!sheetId) {
      setError(t.invalidSheetUrl);
      return;
    }

    setIsSubmitting(true);
    try {
      debugLog('submit:start', { qrCode: code, mobile, name, sheetId, offersGid: OFFERS_GID, registrationsGid: REGISTRATIONS_GID });
      // Validate QR code exists in the sheet
      const valid = await isQrCodeValid(sheetId, code);
      if (!valid) {
        setError(translations.invalidQrError[language]);
        debugLog('submit:blocked_invalid_qr', { qrCode: code });
        return;
      }

      // Minimal validations: only uniqueness in final sheet
      const dupQr = await isQrAlreadyAssigned(sheetId, code);
      if (dupQr.assigned) {
        setError(translations.duplicateQrError[language]);
        debugLog('submit:blocked_duplicate_qr', { qrCode: code, who: dupQr.who });
        return;
      }

      const dupMobile = await isMobileAlreadyAssigned(sheetId, mobile);
      if (dupMobile.assigned) {
        setError(translations.duplicateMobileError[language]);
        debugLog('submit:blocked_duplicate_mobile', { mobile, who: dupMobile.who });
        return;
      }

      // Prepare assignment update: delete existing QR row and append new assigned row
      const existingHeaders = await getRegistrationHeaders(sheetId);
      const hQr = findHeaderName(existingHeaders, 'QR Code') || 'QR Code';
      const hMobile = findHeaderName(existingHeaders, 'Mobile') || 'Mobile';
      const hName = findHeaderName(existingHeaders, 'Name') || 'Name';
      const hStatus = findHeaderName(existingHeaders, 'Status') || 'Status';
      const hRegDate = findHeaderName(existingHeaders, 'RegisteredDate') || 'RegisteredDate';

      const desired: Record<string, string> = {
        [hQr]: String(code),
        [hMobile]: String(mobile),
        [hName]: String(name),
        [hStatus]: 'Assigned',
        [hRegDate]: new Date().toISOString(),
      };
      // Keep only headers that exist in the sheet; Apps Script will extend headers if needed
      const headersToWrite = [hQr, hMobile, hName, hStatus, hRegDate].filter(Boolean);
      const rowToWrite = headersToWrite.map(h => desired[h]);
      debugLog('submit:append_only', { headersToWrite, rowToWrite });

      // Append the new assigned row (append-only sheet)
      const app = await postToAppsScript({
        scriptUrl: SCRIPT_URL,
        action: 'append',
        sheetId,
        gid: REGISTRATIONS_GID,
        headers: headersToWrite,
        rows: [rowToWrite],
      });
      if (!app.success) {
        setError(app.error || t.submitError);
        debugLog('submit:append_failed', app);
        return;
      }

      // Verify by re-reading registrations with short retries
      let verified = false;
      for (let attempt = 0; attempt < 5 && !verified; attempt++) {
        await new Promise(r => setTimeout(r, 500 + attempt * 500));
        const check = await isQrAlreadyAssigned(sheetId, code);
        if (check.assigned) verified = true;
        debugLog('submit:verify_attempt', { attempt, verified, check });
      }
      if (!verified) {
        setError('Registration might not have saved. Please refresh and check the sheet.');
        return;
      }

      setCode('');
      setMobile('');
      setName('');
      setIsRegistered(true);
      setTimeout(() => {
        setIsRegistered(false);
      }, 3000);
      debugLog('submit:success');
    } catch (err) {
      setError(t.submitError);
      debugLog('submit:error', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseScanner = () => {
    if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
    }
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
    }
    setIsScannerOpen(false);
  };

  const scanQRCode = () => {
    if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        
        if (context) {
            canvas.height = video.videoHeight;
            canvas.width = video.videoWidth;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "dontInvert",
            });

            if (qrCode) {
                const scanned = String(qrCode.data || '');
                const filtered = scanned.replace(/\D/g, '').slice(0, 6);
                setCode(filtered);
                setCodeError(filtered.length === 6 ? '' : 'QR code must be exactly 6 digits.');
                handleCloseScanner();
                return;
            }
        }
    }
    animationFrameId.current = requestAnimationFrame(scanQRCode);
  };

  useEffect(() => {
    if (isScannerOpen) {
        const startScanner = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.setAttribute("playsinline", "true");
                    videoRef.current.play();
                    animationFrameId.current = requestAnimationFrame(scanQRCode);
                }
            } catch (err) {
                console.error("Error accessing camera:", err);
                setError(t.cameraError);
                setIsScannerOpen(false);
            }
        };
        startScanner();
    }

    return () => {
        if (animationFrameId.current) {
            cancelAnimationFrame(animationFrameId.current);
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }
    };
  }, [isScannerOpen, t.cameraError]);

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-xl shadow-2xl p-8 mb-6 relative">
          <div className="absolute top-6 right-6">
            <button
              onClick={handleLanguageChange}
              className="font-semibold text-sm text-green-600 hover:text-green-800 hover:underline focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-green-500 rounded-md p-1"
              aria-label={`Switch to ${language === 'en' ? 'Tamil' : 'English'}`}
            >
              {language === 'en' ? 'Tamil' : 'English'}
            </button>
          </div>

          <h1 className="text-3xl font-bold text-center text-slate-800 mb-2">{t.registerCustomer}</h1>
          <p className="text-center text-slate-500 mb-8">{t.scanOrEnter}</p>
          
          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-6">
              <label htmlFor="code" className="block text-slate-600 font-semibold mb-2">{t.codeLabel}</label>
              <div className="flex items-center relative">
                 <i className="fa-solid fa-qrcode absolute left-4 text-slate-400 pointer-events-none"></i>
                <input
                  type="text"
                  id="code"
                  value={code}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const filtered = raw.replace(/\D/g, '').slice(0, 6);
                    setCode(filtered);
                    if (raw !== filtered) {
                      setCodeError('Only digits allowed (6 digits).');
                    } else if (filtered.length === 0) {
                      setCodeError('');
                    } else if (filtered.length !== 6) {
                      setCodeError('QR code must be exactly 6 digits.');
                    } else {
                      setCodeError('');
                    }
                    setError('');
                  }}
                  placeholder={t.codePlaceholder}
                  className="w-full pl-12 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300"
                  required
                  aria-label="Coupon Code"
                  aria-invalid={!!codeError}
                  inputMode="numeric"
                  maxLength={6}
                />
                 <button
                    type="button"
                    onClick={() => setIsScannerOpen(true)}
                    className="absolute right-3 p-2 text-slate-500 hover:text-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 rounded-full transition-colors"
                    aria-label={t.scanQRCode}
                  >
                    <i className="fa-solid fa-camera fa-lg"></i>
                  </button>
              </div>
              {codeError && <p className="text-red-500 text-sm mt-1">{codeError}</p>}
            </div>
            
            <div className="mb-6 relative">
              <label htmlFor="mobile" className="block text-slate-600 font-semibold mb-2">{t.mobileLabel}</label>
               <div className="flex items-center">
                <i className="fa-solid fa-mobile-screen-button absolute left-4 text-slate-400"></i>
                <input
                  type="tel"
                  id="mobile"
                  value={mobile}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const filtered = raw.replace(/\D/g, '').slice(0, 10);
                    setMobile(filtered);
                    if (raw !== filtered) {
                      setMobileError('Only digits allowed (10 digits).');
                    } else if (filtered.length === 0) {
                      setMobileError('');
                    } else if (filtered.length !== 10) {
                      setMobileError('Mobile number must be exactly 10 digits.');
                    } else {
                      setMobileError('');
                    }
                    setError('');
                  }}
                  placeholder={t.mobilePlaceholder}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300"
                  required
                  aria-label="Mobile Number"
                  aria-invalid={!!mobileError}
                  inputMode="numeric"
                  maxLength={10}
                />
              </div>
              {mobileError && <p className="text-red-500 text-sm mt-1">{mobileError}</p>}
            </div>

            <div className="mb-8 relative">
              <label htmlFor="name" className="block text-slate-600 font-semibold mb-2">{t.nameLabel} <span className="text-slate-400 font-normal">{t.nameOptional}</span></label>
              <div className="flex items-center">
                <i className="fa-solid fa-user absolute left-4 text-slate-400"></i>
                <input
                  type="text"
                  id="name"
                  value={name}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const filtered = raw.replace(/[^A-Za-z\s]/g, '');
                    setName(filtered);
                    if (raw !== filtered) {
                      setNameError('Only letters and spaces are allowed.');
                    } else {
                      setNameError('');
                    }
                    setError('');
                  }}
                  placeholder={t.namePlaceholder}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300"
                  aria-label="Customer Name"
                />
              </div>
              {nameError && <p className="text-red-500 text-sm mt-1">{nameError}</p>}
            </div>
            
            <button
              type="submit"
              className="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-all duration-300 transform hover:scale-105 shadow-lg"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving…' : t.registerButton}
            </button>
            
            {error && <p className="text-red-500 text-center mt-4">{error}</p>}
          </form>
        </div>
        
        {isRegistered && (
          <div className="bg-green-500 text-white text-center p-4 rounded-xl shadow-lg transition-opacity duration-500" role="alert">
            <p>{t.successMessage}</p>
          </div>
        )}
      </div>

      {isScannerOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
          <div className="bg-white rounded-lg shadow-xl p-4 w-full max-w-md relative">
             <h3 id="scanner-title" className="text-lg font-bold text-center text-slate-700 mb-2">{t.scanQRCode}</h3>
             <video ref={videoRef} className="w-full h-auto rounded-md border bg-black" playsInline></video>
             <canvas ref={canvasRef} className="hidden"></canvas>
             <button
               onClick={handleCloseScanner}
               className="mt-4 w-full bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
             >
               {t.cancel}
             </button>
          </div>
        </div>
      )}
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);