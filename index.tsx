import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

declare const jsQR: any;

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
    cameraError: 'Could not access the camera. Please check permissions.'
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
    cameraError: 'கேமராவை அணுக முடியவில்லை. அனுமதிகளைச் சரிபார்க்கவும்.'
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameId = useRef<number | null>(null);
  
  const t = translations[language];

  const handleLanguageChange = () => {
    setLanguage(prevLang => prevLang === 'en' ? 'ta' : 'en');
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    
    if (!code || !mobile) {
      setError(t.requiredError);
      return;
    }

    console.log('Registering customer:', { code, mobile, name });
    
    setCode('');
    setMobile('');
    setName('');
    setIsRegistered(true);

    setTimeout(() => {
        setIsRegistered(false);
    }, 3000);
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
                setCode(qrCode.data);
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
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t.codePlaceholder}
                  className="w-full pl-12 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300"
                  required
                  aria-label="Coupon Code"
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
            </div>
            
            <div className="mb-6 relative">
              <label htmlFor="mobile" className="block text-slate-600 font-semibold mb-2">{t.mobileLabel}</label>
               <div className="flex items-center">
                <i className="fa-solid fa-mobile-screen-button absolute left-4 text-slate-400"></i>
                <input
                  type="tel"
                  id="mobile"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder={t.mobilePlaceholder}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300"
                  required
                  aria-label="Mobile Number"
                />
              </div>
            </div>

            <div className="mb-8 relative">
              <label htmlFor="name" className="block text-slate-600 font-semibold mb-2">{t.nameLabel} <span className="text-slate-400 font-normal">{t.nameOptional}</span></label>
              <div className="flex items-center">
                <i className="fa-solid fa-user absolute left-4 text-slate-400"></i>
                <input
                  type="text"
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.namePlaceholder}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300"
                  aria-label="Customer Name"
                />
              </div>
            </div>
            
            <button
              type="submit"
              className="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-all duration-300 transform hover:scale-105 shadow-lg"
            >
              {t.registerButton}
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