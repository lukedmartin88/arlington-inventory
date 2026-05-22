import React, { useState, useRef, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  deleteDoc, 
  query, 
  where 
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey:
  authDomain: "fire-safety-testing.firebaseapp.com",
  projectId: "fire-safety-testing",
  storageBucket: "fire-safety-testing.firebasestorage.app",
  messagingSenderId: "622006469176",
  appId: "1:622006469176:web:fa890d9b1ec95ba9869ccd",
  measurementId: "G-DZ935GWD3B"
};

// Initialise Firebase and Firestore
const app = initializeApp(firebaseConfig);
const firestoreDb = getFirestore(app);

// Keep your existing store constants
const STORE_PROPS = 'properties';
const STORE_REPORTS = 'reports';
// --- API Configuration ---
const getEnvKey = () => {
    try {
        const envKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (envKey) return envKey;
        const savedKey = localStorage.getItem('arlington_gemini_api_key');
        return savedKey || "";
    } catch (e) {
        return "";
    }
};

const callGeminiWithFallback = async (payload, activeApiKey) => {
    let lastError = null;
    const defaultModels = [
        'gemini-2.5-flash-preview-09-2025',
        'gemini-2.5-flash',
        'gemini-2.0-flash'
    ];

    for (const model of defaultModels) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeApiKey || ''}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || `HTTP ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            lastError = error;
            if (error.message.includes('API_KEY_INVALID')) throw new Error("Your API key is invalid.");
            continue;
        }
    }
    throw lastError;
};

// --- Stable Formatter Utilities ---
const getOrdinalSuffix = (day) => {
    if (day === 1 || day === 21 || day === 31) return 'st';
    if (day === 2 || day === 22) return 'nd';
    if (day === 3 || day === 23) return 'rd';
    return 'th';
};

const formatOrdinalDate = (dateString) => {
    if (!dateString) return '';
    const parts = dateString.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return dateString;
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (isNaN(date.getTime())) return dateString;
    const day = date.getDate();
    const month = date.toLocaleDateString('en-GB', { month: 'long' });
    const year = date.getFullYear();
    return `${day}${getOrdinalSuffix(day)} ${month} ${year}`;
};

const formatOrdinalDateTime = (dateTimeString) => {
    if (!dateTimeString) return '';
    const date = new Date(dateTimeString);
    if (isNaN(date.getTime())) return dateTimeString;
    const datePart = formatOrdinalDate(dateTimeString);
    const timePart = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${datePart} at ${timePart}`;
};

const formatType = (type) => {
    if (type === 'inventory') return 'Initial Condition';
    if (type === 'checkout') return 'Check-Out';
    if (type === 'maintenance') return 'Maintenance Schedule';
    if (type === 'fire_safety') return 'Fire Safety Check';
    return type;
};

const LOGO_URL = "https://i.ibb.co/N6Z7PwWc/Arlington-large-20251119-124957-0000.jpg";

let _idCounter = 0;
const newId = () => `id-${Date.now()}-${++_idCounter}`;

// --- Native Browser Database (IndexedDB) ---
const DB_NAME = 'ArlingtonDB';
const DB_VERSION = 1;
const STORE_PROPS = 'properties';
const STORE_REPORTS = 'reports';

const initDB = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (e) => reject(e.target.error);
    request.onsuccess = (e) => resolve(e.target.result);
    request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_PROPS)) {
            db.createObjectStore(STORE_PROPS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_REPORTS)) {
            const store = db.createObjectStore(STORE_REPORTS, { keyPath: 'id' });
            store.createIndex('propertyId', 'propertyId', { unique: false });
        }
    };
});

const dbGetAll = async (storeName) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const dbPut = async (storeName, item) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(item);
        tx.oncomplete = () => resolve(item);
        tx.onerror = () => reject(tx.error);
    });
};

const dbDelete = async (storeName, id) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

const dbGetReportsByProperty = async (propertyId) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_REPORTS, 'readonly');
        const store = tx.objectStore(STORE_REPORTS);
        const index = store.index('propertyId');
        const request = index.getAll(propertyId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const dbGetReport = async (id) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_REPORTS, 'readonly');
        const store = tx.objectStore(STORE_REPORTS);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

// --- Fire Safety Sub-Components ---
const AlarmSection = ({ title, config, setConfig, hasDuration = false }) => (
    <div className="bg-white p-4 rounded-xl border border-gray-200 mb-4 shadow-sm">
        <label className="flex items-center space-x-3 mb-4 cursor-pointer">
            <input type="checkbox" checked={config.tested} onChange={(e) => setConfig({ ...config, tested: e.target.checked })} className="w-5 h-5 text-[#2f314b] border-gray-300 rounded focus:ring-[#2f314b]" />
            <span className="font-bold text-gray-800 text-md">{title} Tested?</span>
        </label>
        {config.tested && (
            <div className="space-y-4 pt-4 border-t border-gray-100">
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Number Tested</label>
                    <input type="number" min="1" value={config.count} onChange={(e) => setConfig({ ...config, count: e.target.value })} className="w-full border border-gray-300 rounded-md p-2 text-sm focus:ring-[#2f314b]" />
                </div>
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Location(s)</label>
                    <input type="text" placeholder="e.g. Hallway, Kitchen" value={config.location} onChange={(e) => setConfig({ ...config, location: e.target.value })} className="w-full border border-gray-300 rounded-md p-2 text-sm focus:ring-[#2f314b]" />
                </div>
                {hasDuration && (
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Test Duration</label>
                        <select value={config.duration} onChange={(e) => setConfig({ ...config, duration: e.target.value })} className="w-full border border-gray-300 rounded-md p-2 text-sm focus:ring-[#2f314b] bg-white">
                            <option value="">Select duration...</option>
                            <option value="Functional Test (Brief)">Functional Test (Brief)</option>
                            <option value="1 Hour">1 Hour</option>
                            <option value="3 Hours">3 Hours</option>
                        </select>
                    </div>
                )}
            </div>
        )}
    </div>
);

const SignaturePad = ({ onSignatureEnd, initialData }) => {
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);

    useEffect(() => {
        if (initialData && canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            const img = new Image();
            img.onload = () => ctx.drawImage(img, 0, 0);
            img.src = initialData;
        }
    }, [initialData]);

    const startDrawing = (e) => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#000000';
        ctx.beginPath(); ctx.moveTo(clientX - rect.left, clientY - rect.top);
        setIsDrawing(true);
    };
    const draw = (e) => {
        if (!isDrawing) return;
        if (e.cancelable) e.preventDefault();
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        ctx.lineTo(clientX - rect.left, clientY - rect.top); ctx.stroke();
    };
    const stopDrawing = () => {
        if (isDrawing) {
            setIsDrawing(false);
            if (canvasRef.current && onSignatureEnd) onSignatureEnd(canvasRef.current.toDataURL());
        }
    };
    const clearPad = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (onSignatureEnd) onSignatureEnd('');
    };

    return (
        <div className="bg-white p-4 rounded-xl border border-gray-200 mb-6 shadow-sm">
            <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-bold text-gray-800">Inspector Signature</label>
                <button type="button" onClick={clearPad} className="text-xs text-red-600 font-bold hover:text-red-800 transition-colors">Clear Signature</button>
            </div>
            <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden bg-gray-50">
                <canvas ref={canvasRef} width={400} height={150} className="w-full h-[150px] touch-none cursor-crosshair bg-transparent"
                    onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseOut={stopDrawing}
                    onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing}
                />
            </div>
            <p className="text-[10px] text-gray-500 mt-2 text-center uppercase tracking-wide font-bold">Sign within the box</p>
        </div>
    );
};

const AlarmRow = ({ title, config }) => {
    if (!config.tested && !config.count && !config.location) return null;
    return (
        <tr className="border-b border-gray-200">
            <td className="p-2 font-bold">{title}</td>
            <td className={`p-2 text-center font-bold ${config.tested ? 'text-green-600' : 'text-red-600'}`}>
                {config.tested ? 'COMPLIANT (YES)' : 'NOT TESTED'}
            </td>
            <td className="p-2 text-center">{config.count || 'N/A'}</td>
            <td className="p-2">{config.location || 'N/A'}</td>
            <td className="p-2">{config.duration || 'N/A'}</td>
        </tr>
    );
};

export default function App() {
    // Top Level Navigation States
    const [currentView, setCurrentView] = useState('home'); // 'home', 'portfolio', 'wizard', 'view'
    
    // Database Cache States
    const [properties, setProperties] = useState([]);
    const [selectedPropertyId, setSelectedPropertyId] = useState(null);
    const [propertyReports, setPropertyReports] = useState([]);
    const [selectedReportId, setSelectedReportId] = useState(null);

    // Form Modals & Settings
    const [showAddProperty, setShowAddProperty] = useState(false);
    const [newPropertyAddress, setNewPropertyAddress] = useState('');
    const [showApiSettings, setShowApiSettings] = useState(false);
    const [activeApiKey, setActiveApiKey] = useState(getEnvKey());
    
    // Wizard States
    const [step, setStep] = useState(0);
    const [reportType, setReportType] = useState(null); 
    
    // Core Report Data Arrays (Single Room Scope)
    const [tenancyInfo, setTenancyInfo] = useState({
        roomIdentifier: '', tenantName: '', moveInDate: '', checkOutDate: '', dateOfInventory: '', clerkName: '', hasEnsuite: false, checkoutScope: 'room'
    });
    const [mainImages, setMainImages] = useState([]);   
    const [mainReport, setMainReport] = useState('');
    
    // Multi-Room Data Arrays (Maintenance & Full Property Checkout)
    const [maintenanceMeta, setMaintenanceMeta] = useState({ date: '', clerkName: '' });
    const [multiRoomData, setMultiRoomData] = useState([{ id: newId(), name: '', images: [], report: '' }]);

    // Fire Safety Data Arrays
    const [fireSafetyData, setFireSafetyData] = useState({
        smoke: { tested: false, count: '', location: '' }, co: { tested: false, count: '', location: '' }, heat: { tested: false, count: '', location: '' }, emergency: { tested: false, count: '', location: '', duration: '' },
        hasFaults: false, faults: '', actionPlan: '', isResolved: false, resolvedDate: '', resolvedBy: '', signature: ''
    });

    // Global processing states
    const [isAnalysingMain, setIsAnalysingMain] = useState(false);
    const [isPolishingMain, setIsPolishingMain] = useState(false);
    const [loadingState, setLoadingState] = useState({ active: false, progress: 0, text: '' });
    const [isProcessing, setIsProcessing] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [pdfFallbackMsg, setPdfFallbackMsg] = useState('');
    const [logoSrc, setLogoSrc] = useState(LOGO_URL);

    const progressIntervalRef = useRef(null);
    const currentProperty = properties.find(p => p.id === selectedPropertyId);

    // Derived flag for multi-room UI flow
    const isMultiRoom = reportType === 'maintenance' || (reportType === 'checkout' && tenancyInfo.checkoutScope === 'property');

    // Initialisation
    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const props = await dbGetAll(STORE_PROPS);
                setProperties(props);
            } catch (e) { console.error("Failed to load DB", e); }
        };
        loadInitialData();
        return () => { if (progressIntervalRef.current) clearInterval(progressIntervalRef.current); };
    }, []);

    useEffect(() => {
        if (!document.getElementById('html2pdf-script')) {
            const script = document.createElement("script");
            script.id = 'html2pdf-script';
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
            script.async = true;
            script.onerror = () => setPdfFallbackMsg("PDF library failed to load. Download will use native print.");
            document.body.appendChild(script);
        }
    }, []);

    useEffect(() => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                canvas.getContext("2d").drawImage(img, 0, 0);
                setLogoSrc(canvas.toDataURL("image/jpeg"));
            } catch (e) { console.warn("Logo canvas blocked by CORS; using URL fallback."); }
        };
        img.src = LOGO_URL;
    }, []);

    // --- Modal Handler ---
    const handleModalBackdropClick = (e) => {
        if (e.target === e.currentTarget) setShowApiSettings(false);
    };

    useEffect(() => {
        if (!showApiSettings) return;
        const handleKey = (e) => { if (e.key === 'Escape') setShowApiSettings(false); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [showApiSettings]);

    // --- High Level Navigation ---
    const handleSelectProperty = async (id) => {
        setSelectedPropertyId(id);
        const reports = await dbGetReportsByProperty(id);
        setPropertyReports(reports.sort((a,b) => new Date(b.reportDate) - new Date(a.reportDate)));
        setCurrentView('portfolio');
    };

    const handleAddNewProperty = async () => {
        if (!newPropertyAddress.trim()) return;
        const newProp = { id: newId(), address: newPropertyAddress.trim() };
        await dbPut(STORE_PROPS, newProp);
        const props = await dbGetAll(STORE_PROPS);
        setProperties(props);
        setShowAddProperty(false);
        setNewPropertyAddress('');
    };

    const handleDeleteProperty = async (e, id) => {
        e.stopPropagation();
        if (window.confirm("Are you sure you want to delete this property and all of its reports?")) {
             const reports = await dbGetReportsByProperty(id);
             for (const r of reports) await dbDelete(STORE_REPORTS, r.id);
             await dbDelete(STORE_PROPS, id);
             const props = await dbGetAll(STORE_PROPS);
             setProperties(props);
        }
    };

    const goHome = () => {
        handleResetWizard();
        setCurrentView('home');
        setSelectedPropertyId(null);
    };

    const goPortfolio = async () => {
        handleResetWizard();
        const reports = await dbGetReportsByProperty(selectedPropertyId);
        setPropertyReports(reports.sort((a,b) => new Date(b.reportDate) - new Date(a.reportDate)));
        setCurrentView('portfolio');
    };

    const handleStartNewReport = () => {
        handleResetWizard();
        setCurrentView('wizard');
        setStep(0);
    };

    const handleViewSavedReport = async (id) => {
        const report = await dbGetReport(id);
        setReportType(report.reportType);
        setTenancyInfo(report.data.tenancyInfo || {});
        setMainImages(report.data.mainImages || []);
        setMainReport(report.data.mainReport || '');
        setMaintenanceMeta(report.data.maintenanceMeta || { date: '', clerkName: '' });
        setMultiRoomData(report.data.multiRoomData || [{ id: newId(), name: '', images: [], report: '' }]);
        setFireSafetyData(report.data.fireSafetyData || {});
        
        setSelectedReportId(id);
        setStep(3);
        setCurrentView('view');
    };

    const handleSaveReportToPortfolio = async () => {
        setIsProcessing(true);
        let displayDate = new Date().toISOString();
        let inspectorName = '';

        if (reportType === 'inventory' || reportType === 'checkout' || reportType === 'fire_safety') {
            displayDate = tenancyInfo.dateOfInventory || displayDate;
            inspectorName = tenancyInfo.clerkName;
        } else if (reportType === 'maintenance') {
            displayDate = maintenanceMeta.date || displayDate;
            inspectorName = maintenanceMeta.clerkName;
        }

        const reportData = {
            id: newId(),
            propertyId: selectedPropertyId,
            reportType,
            reportDate: displayDate,
            inspectorName,
            createdAt: new Date().toISOString(),
            data: { tenancyInfo, mainImages, mainReport, maintenanceMeta, multiRoomData, fireSafetyData }
        };

        try {
            await dbPut(STORE_REPORTS, reportData);
            await goPortfolio();
        } catch (err) {
            console.error(err);
            setErrorMsg("Failed to save report to portfolio.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDeleteReport = async (id) => {
        if (window.confirm("Delete this report permanently?")) {
            await dbDelete(STORE_REPORTS, id);
            const reports = await dbGetReportsByProperty(selectedPropertyId);
            setPropertyReports(reports.sort((a,b) => new Date(b.reportDate) - new Date(a.reportDate)));
        }
    };

    const handleResetWizard = () => {
        setReportType(null);
        setMainReport('');
        setMainImages([]);
        setTenancyInfo({ roomIdentifier: '', tenantName: '', moveInDate: '', checkOutDate: '', dateOfInventory: '', clerkName: '', hasEnsuite: false, checkoutScope: 'room' });
        setMaintenanceMeta({ date: '', clerkName: '' });
        setMultiRoomData([{ id: newId(), name: '', images: [], report: '' }]);
        setFireSafetyData({ smoke: { tested: false, count: '', location: '' }, co: { tested: false, count: '', location: '' }, heat: { tested: false, count: '', location: '' }, emergency: { tested: false, count: '', location: '', duration: '' }, hasFaults: false, faults: '', actionPlan: '', isResolved: false, resolvedDate: '', resolvedBy: '', signature: '' });
        setErrorMsg('');
    };

    // --- Input Handlers ---
    const handleTenancyChange = (e) => {
        const { name, value, type, checked } = e.target;
        setTenancyInfo(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleMaintenanceMetaChange = (e) => {
        const { name, value } = e.target;
        setMaintenanceMeta(prev => ({ ...prev, [name]: value }));
    };

    const handleApiChange = (e) => {
        const newKey = e.target.value;
        setActiveApiKey(newKey);
        try { localStorage.setItem('arlington_gemini_api_key', newKey); } catch (e) {}
    };

    // --- Multi-Room Structure Handlers ---
    const addMultiRoom = () => setMultiRoomData(prev => [...prev, { id: newId(), name: '', images: [], report: '' }]);
    const removeMultiRoom = (rId) => setMultiRoomData(prev => prev.filter(r => r.id !== rId));
    const updateMultiRoomName = (rId, val) => setMultiRoomData(prev => prev.map(r => r.id === rId ? { ...r, name: val } : r));
    const handleMultiReportChange = (rId, text) => setMultiRoomData(prev => prev.map(r => r.id === rId ? { ...r, report: text } : r));

    // --- Image Processing ---
    const compressImage = (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onerror = () => resolve({ failed: true, name: file.name });
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onerror = () => resolve({ failed: true, name: file.name });
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve({ id: newId(), mimeType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.8).split(',')[1], room: '' });
                };
            };
        });
    };

    const handleImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        const results = await Promise.all(files.map(file => compressImage(file)));
        const failed = results.filter(r => r.failed);
        const successful = results.filter(r => !r.failed);
        if (failed.length > 0) setErrorMsg(`Skipped unreadable files: ${failed.map(f => f.name).join(', ')}`);
        else setErrorMsg('');
        setMainImages(prev => [...prev, ...successful]);
        e.target.value = '';
    };

    const handleRemoveImage = useCallback((idToRemove) => setMainImages(prev => prev.filter(img => img.id !== idToRemove)), []);
    const handleImageRoomChange = useCallback((id, newRoomName) => setMainImages(prev => prev.map(img => img.id === id ? { ...img, room: newRoomName } : img)), []);

    const handleMultiImageUpload = async (rId, e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        const results = await Promise.all(files.map(f => compressImage(f)));
        const successful = results.filter(r => !r.failed);
        setMultiRoomData(prev => prev.map(r => r.id === rId ? { ...r, images: [...r.images, ...successful] } : r));
        e.target.value = '';
    };
    const handleRemoveMultiImage = (rId, imgId) => {
        setMultiRoomData(prev => prev.map(r => r.id === rId ? { ...r, images: r.images.filter(i => i.id !== imgId) } : r));
    };

    // --- PDF Generation ---
    const handleDownloadPDFWrapper = () => {
        const sourceElement = document.getElementById('printable-report');
        if (!sourceElement || isProcessing) return;

        setIsProcessing(true);
        setErrorMsg('');
        setPdfFallbackMsg('');

        let isCompleted = false;
        let sandboxRef = null;

        const safetyUnlock = setTimeout(() => {
            if (!isCompleted) {
                isCompleted = true;
                setIsProcessing(false);
                setErrorMsg("PDF engine stalled. Falling back to native print.");
                if (sandboxRef && document.body.contains(sandboxRef)) document.body.removeChild(sandboxRef);
                window.print();
            }
        }, 15000);

        const run = async () => {
            try {
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                if (!window.html2pdf) {
                    isCompleted = true; clearTimeout(safetyUnlock);
                    setPdfFallbackMsg("PDF library not loaded, using native print instead."); window.print(); return;
                }

                sandboxRef = document.createElement('div');
                sandboxRef.style.position = 'fixed';
                sandboxRef.style.left = '-9999px';
                sandboxRef.style.top = '0';
                sandboxRef.style.width = '800px';

                const clone = sourceElement.cloneNode(true);
                clone.style.setProperty('--color-gray-900', '#111827');
                clone.style.setProperty('--color-gray-800', '#1f2937');
                clone.style.setProperty('--color-gray-700', '#374151');
                clone.style.setProperty('--color-gray-500', '#6b7280');
                clone.style.setProperty('--color-gray-200', '#e5e7eb');
                clone.style.setProperty('--color-white', '#ffffff');
                clone.style.color = '#111827';

                sandboxRef.appendChild(clone);
                document.body.appendChild(sandboxRef);

                let safeFilename = 'Report.pdf';
                const propStr = currentProperty?.address ? currentProperty.address.slice(0, 20).replace(/[/\\?%*:|"<>]/g, '_') : 'Property';

                if (reportType === 'maintenance') {
                    const mDate = maintenanceMeta.date || 'NoDate';
                    safeFilename = `Maintenance_${propStr}_${mDate}.pdf`;
                } else if (reportType === 'fire_safety') {
                    const mDate = tenancyInfo.dateOfInventory || 'NoDate';
                    safeFilename = `Fire_Safety_${propStr}_${mDate}.pdf`;
                } else {
                    const tName = tenancyInfo.tenantName?.trim() || 'Tenant';
                    const rNum = (reportType === 'checkout' && tenancyInfo.checkoutScope === 'property') ? 'Full_Property' : (tenancyInfo.roomIdentifier?.trim() || 'Room');
                    const mDate = reportType === 'checkout' ? (tenancyInfo.checkOutDate || 'NoDate') : (tenancyInfo.moveInDate || 'NoDate');
                    const filePrefix = reportType === 'checkout' ? 'Checkout' : 'Inventory';
                    safeFilename = `${filePrefix}_${tName}_${rNum}_${mDate}`.replace(/[/\\?%*:|"<>]/g, '_').trim() + '.pdf';
                }

                const opt = {
                    margin: 10,
                    filename: safeFilename,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { scale: 2, useCORS: true, letterRendering: true, logging: false, imageTimeout: 8000 },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                    pagebreak: { mode: ['css', 'legacy'], avoid: ['.break-inside-avoid', '.break-inside-avoid-page'] }
                };

                await window.html2pdf().set(opt).from(clone).save();

                if (!isCompleted) {
                    isCompleted = true; clearTimeout(safetyUnlock); setIsProcessing(false);
                    if (sandboxRef && document.body.contains(sandboxRef)) document.body.removeChild(sandboxRef);
                }
            } catch (err) {
                if (!isCompleted) {
                    isCompleted = true; clearTimeout(safetyUnlock); setIsProcessing(false);
                    console.error("PDF generation failed:", err); setErrorMsg("PDF generation failed. Falling back to native print.");
                    if (sandboxRef && document.body.contains(sandboxRef)) document.body.removeChild(sandboxRef);
                    window.print();
                }
            }
        };
        run();
    };

    // --- AI Analysis Functions ---
    const triggerProgress = (textPrefix) => {
        setLoadingState({ active: true, progress: 5, text: `${textPrefix}...` });
        progressIntervalRef.current = setInterval(() => {
            setLoadingState(prev => {
                if (!prev.active) return prev;
                let newProgress = Math.min(95, prev.progress + Math.random() * 8 + 2);
                let newText = `${textPrefix}...`;
                if (newProgress > 25) newText = 'Uploading securely...';
                if (newProgress > 50) newText = 'AI is inspecting the images...';
                if (newProgress > 80) newText = 'Formatting detailed report...';
                return { ...prev, progress: newProgress, text: newText };
            });
        }, 800);
    };

    const stopProgress = () => {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
        setLoadingState({ active: true, progress: 100, text: 'Complete!' });
        setTimeout(() => setLoadingState({ active: false, progress: 0, text: '' }), 1500);
    };

    const strictConditionInstruction = "Do NOT state that an item is 'present' or 'exists'. The presence of the item is already confirmed by the photograph. Jump straight to describing the condition, quantities, and cleanliness. Pay extremely close attention to detail: explicitly identify, count, and note multiples of items and explicitly describe any defects found. Be professional. Use UK English. Do not use em dashes.";

    const analyseStandardImages = async () => {
        if (!activeApiKey) return setErrorMsg("Missing API Key.");
        if (mainImages.length === 0) return setErrorMsg("Please provide at least one image.");
        setIsAnalysingMain(true);
        setErrorMsg('');
        triggerProgress('Preparing images');

        try {
            let formatConstraint = "";
            let promptText = "";
            const roomName = (tenancyInfo.roomIdentifier || 'tenant room').replace(/[<>"'`]/g, '').slice(0, 100);

            if (reportType === 'inventory') {
                let sectionCount = 3;
                formatConstraint = `
**1. General Overview**
• **Cleanliness:** [assessment]
• **Decor:** [assessment]
• **Flooring:** [assessment]

**2. Detailed Item Condition: ${roomName}**
• **[Item name]:** [Condition/Description] [Image X]
Condition: [Detailed Condition Only]
`;
                if (tenancyInfo.hasEnsuite) {
                    formatConstraint += `\n**${sectionCount}. Detailed Item Condition: En-suite Bathroom**\n• **[Item name]:** [Condition] [Image X]\nCondition: [Detailed Condition Only]\n`;
                }
                promptText = `Analyse the images of ${roomName} in an HMO. Output EXACTLY in this format using bolding for headings:\n${formatConstraint}\n${strictConditionInstruction}\nDO NOT suggest any improvements, recommendations, or repairs. ${tenancyInfo.hasEnsuite ? 'Thoroughly note the conditions of the en-suite bathroom.' : ''}`;
            } else if (reportType === 'checkout' && tenancyInfo.checkoutScope === 'room') {
                let sectionCount = 3;
                formatConstraint = `
**1. General Overview**
• **Cleanliness:** [assessment]
• **Decor:** [assessment]
• **Flooring:** [assessment]

**2. Detailed Item Condition: ${roomName}**
• **[Item name]:** [Condition/Description] [Image X]
Condition: [Detailed Condition Only]
`;
                if (tenancyInfo.hasEnsuite) {
                    formatConstraint += `\n**${sectionCount}. Detailed Item Condition: En-suite Bathroom**\n• **[Item name]:** [Condition] [Image X]\nCondition: [Detailed Condition Only]\n`;
                    sectionCount++;
                }
                formatConstraint += `\n**${sectionCount}. Deposit Deduction Recommendations**\n• **[Item/Issue]:** [Reasoning for deduction vs fair wear and tear]\n`;
                promptText = `Analyse the images of ${roomName} for a check-out report. Output EXACTLY in this format using bolding for headings:\n${formatConstraint}\n${strictConditionInstruction}\nConclude with objective recommendations for tenancy deposit deductions based on damage exceeding fair wear and tear. ${tenancyInfo.hasEnsuite ? 'Thoroughly note the conditions of the en-suite bathroom.' : ''}`;
            }

            const payloadParts = [{ text: promptText }];
            mainImages.forEach((img, index) => {
                const roomContext = img.room.trim() ? ` (Assigned Room: ${img.room.trim()})` : '';
                payloadParts.push({ text: `\n[Image ${index + 1}]${roomContext}:` });
                payloadParts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
            });

            const payload = { contents: [{ role: "user", parts: payloadParts }] };
            const data = await callGeminiWithFallback(payload, activeApiKey);
            setMainReport(data.candidates?.[0]?.content?.parts?.[0]?.text || "Analysis failed to return text.");
            stopProgress();
        } catch (error) {
            console.error(error);
            setErrorMsg(`Analysis failed: ${error.message}`);
            clearInterval(progressIntervalRef.current);
            setLoadingState({ active: false, progress: 0, text: '' });
        } finally {
            setIsAnalysingMain(false);
        }
    };

    const analyseMultiRoomImages = async () => {
        if (!activeApiKey) return setErrorMsg("Missing API Key.");
        setIsAnalysingMain(true);
        setErrorMsg('');
        
        let updatedRooms = JSON.parse(JSON.stringify(multiRoomData));
        const tasks = updatedRooms.filter(r => r.images.length > 0);

        if (tasks.length === 0) {
            setErrorMsg("No images uploaded across any rooms to analyse.");
            setIsAnalysingMain(false);
            return;
        }

        let completed = 0;
        for (const task of tasks) {
            setLoadingState({ active: true, progress: 10 + (completed / tasks.length) * 80, text: `Analysing ${task.name || 'Room'}...` });
            try {
                const imageParts = task.images.map((img, iIdx) => [
                    { text: `\n[Image ${iIdx + 1}]:` },
                    { inlineData: { mimeType: img.mimeType, data: img.data } }
                ]).flat();

                let promptText = "";
                if (reportType === 'maintenance') {
                    promptText = `Analyse these images showing maintenance issues in ${task.name} at ${currentProperty?.address}. 
Do NOT state that an item is 'present' or 'exists'. Describe the specific defects, damage, or required repairs clearly and objectively. 
Format your response using clear bullet points referring to [Image X]. Be professional. Use UK English. Do not use em dashes.`;
                } else if (reportType === 'checkout') {
                    const formatConstraint = `
**1. General Overview**
• **Cleanliness:** [assessment]
• **Decor:** [assessment]
• **Flooring:** [assessment]

**2. Detailed Item Condition**
• **[Item name]:** [Condition/Description] [Image X]
Condition: [Detailed Condition Only]

**3. Deposit Deduction Recommendations**
• **[Item/Issue]:** [Reasoning for deduction vs fair wear and tear]
`;
                    promptText = `Analyse these images showing the end of tenancy condition in the ${task.name} at ${currentProperty?.address}. Output EXACTLY in this format using bolding for headings:\n${formatConstraint}\n${strictConditionInstruction}\nConclude with objective recommendations for tenancy deposit deductions based on damage exceeding fair wear and tear.`;
                }

                const payload = { contents: [{ role: "user", parts: [{ text: promptText }, ...imageParts] }] };
                const data = await callGeminiWithFallback(payload, activeApiKey);
                
                const rIndex = updatedRooms.findIndex(r => r.id === task.id);
                if (rIndex !== -1) updatedRooms[rIndex].report = data.candidates?.[0]?.content?.parts?.[0]?.text || "No actionable defects found.";
            } catch (err) {
                console.error(err);
                const rIndex = updatedRooms.findIndex(r => r.id === task.id);
                if (rIndex !== -1) updatedRooms[rIndex].report = `Error during analysis: ${err.message}`;
            }
            completed++;
        }

        setMultiRoomData(updatedRooms);
        setLoadingState({ active: true, progress: 100, text: 'Complete!' });
        setTimeout(() => { setLoadingState({ active: false, progress: 0, text: '' }); setIsAnalysingMain(false); }, 1500);
    };

    const polishStandardText = async () => {
        if (!mainReport.trim() || !activeApiKey) return;
        setIsPolishingMain(true);
        try {
            const constraint = "Strictly reporting objective conditions only. Never state that an item is 'present' or 'exists' as the photo confirms existence. Use UK English only. No em dashes.";
            const promptText = reportType === 'inventory' 
                ? `Rewrite the following notes highly professionally. ${constraint} DO NOT suggest any improvements or repairs. \n\n${mainReport}`
                : `Rewrite the following notes highly professionally. ${constraint} Ensure objective recommendations for deposit deductions are preserved. \n\n${mainReport}`;
            
            const payload = { contents: [{ role: "user", parts: [{ text: promptText }] }] };
            const data = await callGeminiWithFallback(payload, activeApiKey);
            setMainReport(data.candidates?.[0]?.content?.parts?.[0]?.text || mainReport);
        } catch (error) {
            setErrorMsg(`Failed to polish text: ${error.message}`);
        } finally {
            setIsPolishingMain(false);
        }
    };

    const polishMultiRoomText = async () => {
        if (!activeApiKey) return setErrorMsg("Missing API Key.");
        setIsPolishingMain(true);
        setErrorMsg('');
        
        let updatedRooms = JSON.parse(JSON.stringify(multiRoomData));
        const tasks = updatedRooms.filter(r => r.report && r.report.trim() !== '');

        for (const task of tasks) {
            try {
                const constraint = "Strictly report the objective conditions. Do not state items are present or exist. Use UK English only. No em dashes.";
                const promptText = reportType === 'maintenance'
                    ? `Rewrite the following maintenance notes highly professionally. ${constraint} Ensure requested repairs are clear: \n\n${task.report}`
                    : `Rewrite the following check-out notes highly professionally. ${constraint} Ensure objective recommendations for deposit deductions are preserved: \n\n${task.report}`;

                const payload = { contents: [{ role: "user", parts: [{ text: promptText }] }] };
                const data = await callGeminiWithFallback(payload, activeApiKey);
                const rIndex = updatedRooms.findIndex(r => r.id === task.id);
                if (rIndex !== -1) updatedRooms[rIndex].report = data.candidates?.[0]?.content?.parts?.[0]?.text || task.report;
            } catch (err) { console.error(err); }
        }
        setMultiRoomData(updatedRooms);
        setIsPolishingMain(false);
    };

    const renderReportText = (text) => {
        if (!text) return null;
        return text.split('\n').map((line, i) => {
            const segments = [];
            let lastIndex = 0;
            const boldRegex = /\*\*(.*?)\*\*/g;
            let match;
            while ((match = boldRegex.exec(line)) !== null) {
                if (match.index > lastIndex) segments.push(<span key={`t-${lastIndex}`}>{line.slice(lastIndex, match.index)}</span>);
                segments.push(<strong key={`b-${match.index}`} className="font-semibold">{match[1]}</strong>);
                lastIndex = boldRegex.lastIndex;
            }
            if (lastIndex < line.length) segments.push(<span key={`t-${lastIndex}`}>{line.slice(lastIndex)}</span>);
            return (
                <p key={i} className={`text-[12px] text-gray-800 leading-[1.6] ${line.trim() === '' ? 'h-2' : 'mt-1.5'}`}>
                    {segments.length > 0 ? segments : line}
                </p>
            );
        });
    };

    // --- Core UI Logic Checks ---
    const canProceedToStep2 = isMultiRoom 
        ? multiRoomData.length > 0 && multiRoomData.every(r => r.name.trim() !== '') && (reportType === 'checkout' ? tenancyInfo.tenantName.trim() !== '' : true)
        : reportType === 'fire_safety' 
        ? true 
        : tenancyInfo.tenantName.trim() !== '' && tenancyInfo.roomIdentifier.trim() !== '';

    const canProceedToStep3 = isMultiRoom
        ? multiRoomData.some(r => r.report.trim() !== '' || r.images.length > 0)
        : reportType === 'fire_safety'
        ? true
        : mainReport.trim() !== '';

    const handleStepClick = (targetStep) => {
        if (targetStep <= step) { setStep(targetStep); return; }
        if (targetStep === 2 && canProceedToStep2) { setStep(2); return; }
        if (targetStep === 3 && canProceedToStep3) { setStep(3); return; }
    };

    return (
        <div className="min-h-screen bg-gray-100 text-gray-800 p-4 sm:p-8 print:p-0 print:bg-white font-sans">
            <style>
                {`
                @media print {
                    body * { visibility: hidden; }
                    #printable-report, #printable-report * { visibility: visible; }
                    #printable-report { position: absolute; left: 0; top: 0; width: 100%; padding: 0; margin: 0; box-shadow: none; }
                    .html2pdf__page-break { page-break-before: always; }
                    .break-inside-avoid-page { page-break-inside: avoid; break-inside: avoid; }
                }
                #printable-report {
                    --color-gray-900: #111827 !important; --color-gray-800: #1f2937 !important; --color-gray-700: #374151 !important;
                    --color-gray-500: #6b7280 !important; --color-gray-200: #e5e7eb !important; --color-white: #ffffff !important;
                }
                `}
            </style>

            <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden print:shadow-none">

                {/* Main Branding Header */}
                <div className="bg-[#2f314b] text-white p-4 sm:p-6 print:hidden flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 cursor-pointer" onClick={goHome}>
                        <img src={logoSrc} alt="Arlington Park Logo" crossOrigin="anonymous" className="h-10 sm:h-12 object-contain" />
                        <h1 className="text-xl sm:text-2xl font-bold">Arlington Park Reports</h1>
                    </div>
                </div>

                {/* ─── HOME VIEW (Properties Database) ─── */}
                {currentView === 'home' && (
                    <div className="flex flex-col items-center justify-center space-y-8 py-10 px-6 sm:py-16 bg-gray-50 min-h-[50vh]">
                        <div className="text-center">
                            <h2 className="text-2xl sm:text-3xl font-bold text-gray-800">HMO Properties Database</h2>
                            <p className="text-gray-500 mt-2 font-medium max-w-lg mx-auto">Select a building to manage its Room Lets, Check-Outs, Fire Safety, and Maintenance.</p>
                        </div>
                        
                        {showAddProperty ? (
                            <div className="w-full max-w-md bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                                <h3 className="font-bold text-lg mb-4 text-gray-800">Add New HMO Building</h3>
                                <textarea 
                                    value={newPropertyAddress} 
                                    onChange={e => setNewPropertyAddress(e.target.value)} 
                                    placeholder="e.g. 123 High Street, Norwich NR2 3AD" 
                                    className="w-full p-3 border border-gray-300 rounded focus:ring-[#2f314b] focus:border-[#2f314b] mb-4" 
                                    rows="3"
                                />
                                <div className="flex justify-end gap-3">
                                    <button onClick={() => setShowAddProperty(false)} className="px-4 py-2 font-bold text-gray-600 hover:bg-gray-100 rounded transition">Cancel</button>
                                    <button onClick={handleAddNewProperty} className="px-4 py-2 font-bold bg-[#2f314b] text-white rounded hover:bg-[#2f314b]/90 transition">Save Property</button>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-3xl">
                                {properties.map(prop => (
                                    <div key={prop.id} className="relative group">
                                        <button onClick={() => handleSelectProperty(prop.id)} className="w-full bg-white border-2 border-transparent p-6 rounded-xl hover:border-[#2f314b] shadow-sm flex items-center justify-between text-left transition">
                                            <span className="text-lg font-bold text-gray-800 group-hover:text-[#2f314b]">{prop.address}</span>
                                            <span className="text-[#2f314b] font-bold text-xl ml-4">→</span>
                                        </button>
                                        <button onClick={(e) => handleDeleteProperty(e, prop.id)} className="absolute top-2 right-2 text-xs font-bold text-red-500 opacity-0 group-hover:opacity-100 hover:text-red-700 transition px-2 py-1 bg-red-50 rounded">
                                            Delete
                                        </button>
                                    </div>
                                ))}
                                <button onClick={() => setShowAddProperty(true)} className="bg-white border-2 border-dashed border-[#2f314b]/30 p-6 rounded-xl hover:border-[#2f314b] hover:bg-[#2f314b]/5 flex flex-col items-center justify-center text-[#2f314b] transition gap-2 min-h-[100px]">
                                    <span className="text-3xl font-bold leading-none">+</span>
                                    <span className="font-bold">Add New HMO Building</span>
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ─── PORTFOLIO VIEW (Single Property) ─── */}
                {currentView === 'portfolio' && (
                    <div className="space-y-6 p-6 sm:p-8">
                        <button onClick={goHome} className="font-bold text-gray-500 hover:text-black mb-2 flex items-center">
                            ← Back to Database
                        </button>
                        
                        <div className="bg-[#2f314b] text-white p-6 sm:p-8 rounded-xl shadow-sm">
                            <h2 className="text-2xl sm:text-3xl font-bold leading-tight">{currentProperty?.address}</h2>
                            <p className="text-white/70 mt-2 font-medium tracking-wide uppercase text-sm">Property Portfolio</p>
                        </div>
                        
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-8 mb-4 gap-4">
                            <h3 className="text-xl font-bold text-gray-800 border-b-2 border-[#2f314b] pb-1">Saved Reports</h3>
                            <button onClick={handleStartNewReport} className="bg-[#2f314b] text-white px-6 py-3 rounded-lg font-bold shadow hover:bg-[#2f314b]/90 transition w-full sm:w-auto text-center">
                                + Create New Report
                            </button>
                        </div>

                        <div className="space-y-4">
                            {propertyReports.length === 0 ? (
                                <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-10 text-center">
                                    <p className="text-gray-500 font-medium">No reports generated for this property yet.</p>
                                </div>
                            ) : (
                                propertyReports.map(report => (
                                    <div key={report.id} className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:border-[#2f314b] transition">
                                        <div>
                                            <p className="font-bold text-gray-900 text-lg uppercase tracking-wide">
                                                {formatType(report.reportType)}
                                            </p>
                                            <p className="text-sm font-bold text-[#2f314b] mt-1 mb-1">
                                                {report.reportType === 'inventory' || (report.reportType === 'checkout' && report.data.tenancyInfo?.checkoutScope === 'room') 
                                                    ? `Room Let: ${report.data.tenancyInfo?.roomIdentifier || 'N/A'} (${report.data.tenancyInfo?.tenantName || 'N/A'})` 
                                                    : 'Entire Property Scope'}
                                            </p>
                                            <p className="text-sm text-gray-600 mt-1">
                                                <span className="font-semibold text-gray-500">{formatOrdinalDate(report.reportDate)}</span> 
                                                <span className="mx-2 hidden sm:inline">|</span> 
                                                <span className="block sm:inline mt-1 sm:mt-0">Inspector: {report.inspectorName || 'Not specified'}</span>
                                            </p>
                                        </div>
                                        <div className="flex gap-4 w-full sm:w-auto border-t sm:border-0 pt-3 sm:pt-0">
                                            <button onClick={() => handleViewSavedReport(report.id)} className="flex-1 sm:flex-none text-[#2f314b] bg-[#2f314b]/10 px-4 py-2 rounded font-bold hover:bg-[#2f314b]/20 transition text-center">
                                                View PDF
                                            </button>
                                            <button onClick={() => handleDeleteReport(report.id)} className="flex-1 sm:flex-none text-red-600 bg-red-50 px-4 py-2 rounded font-bold hover:bg-red-100 transition text-center">
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* ─── WIZARD OR VIEW REPORT ─── */}
                {(currentView === 'wizard' || currentView === 'view') && (
                    <>
                        {/* Progress Tabs for Wizard */}
                        {currentView === 'wizard' && step > 0 && (
                            <div className="flex border-b border-gray-200 print:hidden bg-gray-50">
                                {[1, 2, 3].map(s => (
                                    <button key={s} onClick={() => handleStepClick(s)} disabled={(s === 2 && !canProceedToStep2 && step < 2) || (s === 3 && !canProceedToStep3 && step < 3)} className={`flex-1 py-4 text-center font-bold transition text-sm sm:text-base ${step === s ? 'border-b-4 border-[#2f314b] text-[#2f314b] bg-white' : 'text-gray-500 hover:bg-gray-100'} disabled:opacity-30 disabled:cursor-not-allowed`}>
                                        {s === 1 ? '1. Details' : s === 2 ? '2. Analysis / Forms' : '3. Review'}
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="p-6 sm:p-8">

                            {/* --- STEP 0: Selection --- */}
                            {currentView === 'wizard' && step === 0 && (
                                <div className="flex flex-col items-center justify-center space-y-8 py-8 sm:py-12">
                                    <div className="w-full flex justify-between items-center mb-4">
                                        <button onClick={goPortfolio} className="text-sm font-bold text-gray-500 hover:text-black">← Cancel</button>
                                    </div>
                                    <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 text-center border-b-4 border-[#2f314b] pb-2">Select a Report Type</h2>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 w-full max-w-6xl">
                                        <button onClick={() => { setReportType('inventory'); setTenancyInfo(prev => ({...prev, checkoutScope: 'room'})); setStep(1); }} className="bg-white border border-gray-200 p-6 rounded-xl hover:border-[#2f314b] hover:shadow-md transition group flex flex-col items-center gap-3">
                                            <span className="text-lg font-bold text-[#2f314b] text-center uppercase tracking-wide">Initial Condition</span>
                                            <span className="text-xs text-center text-gray-500 font-medium">Standard inventory for room lets.</span>
                                        </button>
                                        <button onClick={() => { setReportType('checkout'); setStep(1); }} className="bg-white border border-gray-200 p-6 rounded-xl hover:border-[#2f314b] hover:shadow-md transition group flex flex-col items-center gap-3">
                                            <span className="text-lg font-bold text-[#2f314b] text-center uppercase tracking-wide">Check-Out Report</span>
                                            <span className="text-xs text-center text-gray-500 font-medium">End of tenancy inspection with deposit deductions.</span>
                                        </button>
                                        <button onClick={() => { setReportType('maintenance'); setStep(1); }} className="bg-white border border-gray-200 p-6 rounded-xl hover:border-[#2f314b] hover:shadow-md transition group flex flex-col items-center gap-3">
                                            <span className="text-lg font-bold text-[#2f314b] text-center uppercase tracking-wide">Maintenance</span>
                                            <span className="text-xs text-center text-gray-500 font-medium">Log issues across specific rooms for repair teams.</span>
                                        </button>
                                        <button onClick={() => { setReportType('fire_safety'); setStep(1); }} className="bg-white border border-gray-200 p-6 rounded-xl hover:border-[#2f314b] hover:shadow-md transition group flex flex-col items-center gap-3">
                                            <span className="text-lg font-bold text-[#2f314b] text-center uppercase tracking-wide">Fire Safety Check</span>
                                            <span className="text-xs text-center text-gray-500 font-medium">Record alarm testing and compliance checks.</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* --- STEP 1: Details --- */}
                            {currentView === 'wizard' && step === 1 && (
                                <div className="space-y-6">
                                    <div className="flex justify-between items-center mb-6">
                                        <h2 className="text-2xl font-bold text-gray-800 uppercase tracking-wide border-l-4 border-[#2f314b] pl-3">
                                            {reportType === 'inventory' && 'Inventory Details (Room Let)'}
                                            {reportType === 'checkout' && 'Check-Out Details'}
                                            {reportType === 'maintenance' && 'Maintenance Details (Entire Property)'}
                                            {reportType === 'fire_safety' && 'Fire Safety Details (Entire Property)'}
                                        </h2>
                                        <button onClick={() => setStep(0)} className="text-sm text-gray-500 hover:text-gray-800 font-bold underline">Change Type</button>
                                    </div>

                                    {/* Check-Out Scope Toggle */}
                                    {reportType === 'checkout' && (
                                        <div className="bg-gray-50 p-5 rounded-xl border border-gray-200 mb-6">
                                            <label className="block text-sm font-bold text-gray-800 mb-3 uppercase tracking-wider">Check-Out Scope</label>
                                            <div className="flex flex-col sm:flex-row gap-4 sm:gap-8">
                                                <label className="flex items-center cursor-pointer group">
                                                    <input type="radio" name="checkoutScope" value="room" checked={tenancyInfo.checkoutScope === 'room'} onChange={handleTenancyChange} className="w-5 h-5 text-[#2f314b] focus:ring-[#2f314b] border-gray-400" />
                                                    <span className="ml-3 text-sm font-bold text-gray-700 group-hover:text-black transition">Individual Room Let</span>
                                                </label>
                                                <label className="flex items-center cursor-pointer group">
                                                    <input type="radio" name="checkoutScope" value="property" checked={tenancyInfo.checkoutScope === 'property'} onChange={handleTenancyChange} className="w-5 h-5 text-[#2f314b] focus:ring-[#2f314b] border-gray-400" />
                                                    <span className="ml-3 text-sm font-bold text-gray-700 group-hover:text-black transition">Full Property (Room-by-Room Builder)</span>
                                                </label>
                                            </div>
                                        </div>
                                    )}

                                    {/* Standard Inventory / Single Room Checkout Form */}
                                    {(reportType === 'inventory' || (reportType === 'checkout' && tenancyInfo.checkoutScope === 'room')) && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                            <div className="space-y-6">
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-2">Property Address</label>
                                                    <textarea disabled value={currentProperty?.address || ''} className="w-full p-3 border border-gray-200 rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed font-medium" rows="2" />
                                                </div>

                                                {(reportType === 'inventory' || tenancyInfo.checkoutScope === 'room') && (
                                                    <div>
                                                        <label className="block text-sm font-bold text-gray-700 mb-2">Room Name <span className="text-red-500">*</span></label>
                                                        <input type="text" name="roomIdentifier" value={tenancyInfo.roomIdentifier} onChange={handleTenancyChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] focus:border-[#2f314b] font-medium" placeholder="e.g. Master Bedroom" />
                                                        <div className="flex items-center mt-3 ml-1">
                                                            <input type="checkbox" id="hasEnsuite" name="hasEnsuite" checked={tenancyInfo.hasEnsuite || false} onChange={handleTenancyChange} className="h-5 w-5 text-[#2f314b] focus:ring-[#2f314b] border-gray-300 rounded cursor-pointer" />
                                                            <label htmlFor="hasEnsuite" className="ml-3 block text-sm font-bold text-gray-700 cursor-pointer">Includes En-suite Bathroom</label>
                                                        </div>
                                                    </div>
                                                )}

                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-2">Tenant Name(s) <span className="text-red-500">*</span></label>
                                                    <input type="text" name="tenantName" value={tenancyInfo.tenantName} onChange={handleTenancyChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] focus:border-[#2f314b] font-medium" />
                                                </div>
                                            </div>
                                            <div className="space-y-6 bg-gray-50 p-6 rounded-xl border border-gray-100">
                                                {reportType === 'inventory' ? (
                                                    <div>
                                                        <label className="block text-sm font-bold text-gray-700 mb-2">Move-in Date</label>
                                                        <input type="date" name="moveInDate" value={tenancyInfo.moveInDate} onChange={handleTenancyChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] font-medium bg-white" />
                                                    </div>
                                                ) : (
                                                    <div>
                                                        <label className="block text-sm font-bold text-gray-700 mb-2">Check-out Date</label>
                                                        <input type="date" name="checkOutDate" value={tenancyInfo.checkOutDate} onChange={handleTenancyChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] font-medium bg-white" />
                                                    </div>
                                                )}
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-2">Inspection Date</label>
                                                    <input type="date" name="dateOfInventory" value={tenancyInfo.dateOfInventory} onChange={handleTenancyChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] font-medium bg-white" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-2">Inspected By (Agent Name)</label>
                                                    <input type="text" name="clerkName" value={tenancyInfo.clerkName} onChange={handleTenancyChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] font-medium bg-white" />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Full Property Checkout Form */}
                                    {reportType === 'checkout' && tenancyInfo.checkoutScope === 'property' && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                                            <div className="space-y-6">
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-2">Property Address</label>
                                                    <textarea disabled value={currentProperty?.address || ''} className="w-full p-3 border border-gray-200 rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed font-medium" rows="2" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-2">Tenant Name(s) <span className="text-red-500">*</span></label>
                                                    <input type="text" name="tenantName" value={tenancyInfo.tenantName} onChange={handleTenancyChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] focus:border-[#2f314b] font-medium" />
                                                </div>
                                            </div>
                                            <div className="space-y-6 bg-gray-50 p-6 rounded-xl border border-gray-100">
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-2">Check-out Date</label>
                                                    <input type="date" name="checkOutDate" value={tenancyInfo.checkOutDate} onChange={handleTenancyChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] font-medium bg-white" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-2">Inspection Date</label>
                                                    <input type="date" name="dateOfInventory" value={tenancyInfo.dateOfInventory} onChange={handleTenancyChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] font-medium bg-white" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-2">Inspected By (Agent Name)</label>
                                                    <input type="text" name="clerkName" value={tenancyInfo.clerkName} onChange={handleTenancyChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] font-medium bg-white" />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Maintenance Schedule Meta Form */}
                                    {reportType === 'maintenance' && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50 p-6 rounded-xl border border-gray-200 mb-8">
                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 mb-2">Inspection Date</label>
                                                <input type="date" name="date" value={maintenanceMeta.date} onChange={handleMaintenanceMetaChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] bg-white font-medium" />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 mb-2">Inspected By</label>
                                                <input type="text" name="clerkName" value={maintenanceMeta.clerkName} onChange={handleMaintenanceMetaChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] bg-white font-medium" />
                                            </div>
                                        </div>
                                    )}

                                    {/* Multi-Room Builder (For Maintenance AND Full Property Checkout) */}
                                    {isMultiRoom && (
                                        <div className="bg-white border-2 border-gray-200 rounded-xl p-6 sm:p-8 mt-6">
                                            <h3 className="text-lg font-bold text-gray-800 mb-4 border-b-2 border-gray-100 pb-2 uppercase tracking-wide">Rooms to Inspect</h3>
                                            <div className="space-y-4">
                                                {multiRoomData.map((room, idx) => (
                                                    <div key={room.id} className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200">
                                                        <span className="font-bold text-gray-400 w-6 text-center">{idx + 1}.</span>
                                                        <input type="text" value={room.name} onChange={(e) => updateMultiRoomName(room.id, e.target.value)} placeholder="e.g. Kitchen, Bedroom 1, En-suite Bathroom" className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] font-medium bg-white" />
                                                        <button onClick={() => removeMultiRoom(room.id)} className="text-red-500 hover:bg-red-100 hover:text-red-700 px-4 py-3 rounded-lg text-sm font-bold transition">Delete</button>
                                                    </div>
                                                ))}
                                                <button onClick={addMultiRoom} className="mt-4 text-sm text-[#2f314b] font-bold bg-[#2f314b]/10 px-5 py-3 rounded-lg hover:bg-[#2f314b]/20 transition inline-block">
                                                    + Add Another Room
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Fire Safety Initial Details */}
                                    {reportType === 'fire_safety' && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                            <div className="space-y-6">
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-2">Property Address</label>
                                                    <textarea disabled value={currentProperty?.address || ''} className="w-full p-3 border border-gray-200 rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed font-medium" rows="2"/>
                                                </div>
                                            </div>
                                            <div className="space-y-6 bg-gray-50 p-6 rounded-xl border border-gray-100">
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-2">Date of Test</label>
                                                    <input type="date" name="dateOfInventory" value={tenancyInfo.dateOfInventory} onChange={handleTenancyChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] bg-white font-medium" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-2">Inspected By</label>
                                                    <input type="text" name="clerkName" value={tenancyInfo.clerkName} onChange={handleTenancyChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] bg-white font-medium" />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="pt-6">
                                        <button onClick={() => setStep(2)} disabled={!canProceedToStep2} className="w-full sm:w-auto bg-[#2f314b] text-white px-10 py-4 rounded-xl font-bold shadow-md hover:bg-[#2f314b]/90 transition disabled:opacity-50 disabled:cursor-not-allowed text-lg">
                                            Continue to Next Step →
                                        </button>
                                        {!canProceedToStep2 && reportType === 'checkout' && tenancyInfo.checkoutScope === 'property' && <p className="text-sm font-bold text-red-500 mt-3">Tenant name and at least one named room are required to continue.</p>}
                                        {!canProceedToStep2 && !isMultiRoom && reportType !== 'fire_safety' && <p className="text-sm font-bold text-red-500 mt-3">Tenant name and Room Name are required to continue.</p>}
                                    </div>
                                </div>
                            )}

                            {/* --- STEP 2: Analysis / Forms --- */}
                            {currentView === 'wizard' && step === 2 && (
                                <div className="space-y-8">
                                    {errorMsg && <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm border-2 border-red-200 font-bold">{errorMsg}</div>}

                                    {/* Single Room Analysis UI (Inventory, Room Let Checkout) */}
                                    {!isMultiRoom && (reportType === 'inventory' || reportType === 'checkout') && (
                                        <div className="bg-white border-2 border-gray-100 p-6 sm:p-8 rounded-xl shadow-sm">
                                            <h3 className="text-xl font-bold text-gray-900 mb-6 border-b-2 border-gray-100 pb-2 uppercase tracking-wide">Photographic Analysis</h3>
                                            
                                            <div className="p-6 border-2 border-dashed border-[#2f314b]/30 rounded-xl bg-gray-50 mb-8 transition hover:bg-gray-100">
                                                <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="block w-full text-sm text-gray-500 file:mr-6 file:py-3 file:px-6 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-[#2f314b] file:text-white hover:file:bg-[#2f314b]/90 cursor-pointer" />
                                                {mainImages.length > 0 && <p className="text-sm text-green-600 mt-4 font-bold">{mainImages.length} image{mainImages.length !== 1 ? 's' : ''} securely loaded and compressed.</p>}
                                            </div>

                                            {mainImages.length > 0 && (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-8">
                                                    {mainImages.map((img, idx) => (
                                                        <div key={img.id} className="relative group rounded-xl overflow-hidden border-2 border-gray-200 flex flex-col bg-white">
                                                            <div className="relative">
                                                                <img src={`data:${img.mimeType};base64,${img.data}`} alt={`Upload ${idx + 1}`} className="w-full h-32 object-cover" />
                                                                <div className="absolute inset-0 bg-black/40 transition opacity-0 group-hover:opacity-100 flex items-center justify-center">
                                                                    <button onClick={() => handleRemoveImage(img.id)} className="bg-red-600 text-white text-xs rounded-lg px-4 py-2 font-bold hover:bg-red-700 shadow">Remove</button>
                                                                </div>
                                                            </div>
                                                            <div className="p-3 bg-gray-50 flex flex-col gap-2 border-t border-gray-200">
                                                                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Image {idx + 1}</p>
                                                                <input type="text" placeholder="Assign section..." value={img.room || ''} onChange={(e) => handleImageRoomChange(img.id, e.target.value)} className="w-full text-xs p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2f314b] font-medium" />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            <button onClick={analyseStandardImages} disabled={isAnalysingMain || mainImages.length === 0} className="w-full py-4 bg-[#2f314b] text-white rounded-xl font-bold shadow-md disabled:bg-gray-300 disabled:shadow-none transition text-lg">
                                                {isAnalysingMain ? 'Analysing images via AI...' : `Generate ${reportType === 'checkout' ? 'Check-Out' : 'Inventory'} Report`}
                                            </button>

                                            {loadingState.active && (
                                                <div className="mt-6 bg-[#2f314b]/5 p-5 rounded-xl border border-[#2f314b]/10">
                                                    <div className="flex justify-between text-sm text-[#2f314b] font-bold mb-3 uppercase tracking-wider">
                                                        <span>{loadingState.text}</span><span>{Math.round(loadingState.progress)}%</span>
                                                    </div>
                                                    <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                                                        <div className="bg-[#2f314b] h-3 rounded-full transition-all duration-300" style={{ width: `${loadingState.progress}%` }}></div>
                                                    </div>
                                                </div>
                                            )}

                                            {mainReport && (
                                                <div className="mt-8">
                                                    <div className="flex justify-between items-center mb-3">
                                                        <label className="text-base font-bold text-gray-800 uppercase tracking-wide">Review & Edit Generated Report:</label>
                                                        <button onClick={polishStandardText} disabled={isPolishingMain} className="text-xs bg-[#2f314b]/10 text-[#2f314b] px-4 py-2 rounded-lg font-bold hover:bg-[#2f314b]/20 transition shadow-sm">
                                                            {isPolishingMain ? 'Polishing...' : '✨ Polish Text Objectively'}
                                                        </button>
                                                    </div>
                                                    <textarea value={mainReport} onChange={(e) => setMainReport(e.target.value)} className="w-full p-5 border-2 border-gray-200 rounded-xl h-96 font-mono text-sm bg-gray-50 focus:ring-[#2f314b] focus:bg-white transition leading-relaxed" />
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Multi-Room Analysis UI (Maintenance, Full Property Checkout) */}
                                    {isMultiRoom && (
                                        <div className="space-y-6">
                                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-4 gap-4">
                                                <h3 className="text-xl font-bold text-gray-900 border-b-2 border-gray-200 pb-1">Room-by-Room AI Analysis</h3>
                                                <button onClick={analyseMultiRoomImages} disabled={isAnalysingMain} className="bg-[#2f314b] text-white px-8 py-3 rounded-xl font-bold shadow-md hover:bg-[#2f314b]/90 transition disabled:bg-gray-400 w-full sm:w-auto">
                                                    {isAnalysingMain ? 'Analysing...' : 'Generate All AI Reports'}
                                                </button>
                                            </div>

                                            {loadingState.active && (
                                                <div className="bg-[#2f314b]/5 p-5 rounded-xl border border-[#2f314b]/10 mb-6">
                                                    <div className="flex justify-between text-sm text-[#2f314b] font-bold mb-3 uppercase tracking-wider">
                                                        <span>{loadingState.text}</span><span>{Math.round(loadingState.progress)}%</span>
                                                    </div>
                                                    <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                                                        <div className="bg-[#2f314b] h-3 rounded-full transition-all duration-300" style={{ width: `${loadingState.progress}%` }}></div>
                                                    </div>
                                                </div>
                                            )}

                                            <div className="bg-white border-2 border-gray-100 p-6 rounded-xl shadow-sm space-y-8">
                                                {multiRoomData.map((room) => (
                                                    <div key={room.id} className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                                                        <h5 className="font-bold text-gray-800 mb-4 text-xl border-b-2 border-gray-200 pb-2">{room.name}</h5>
                                                        
                                                        <div className="p-4 border-2 border-dashed border-gray-300 rounded-xl bg-white mb-6 hover:bg-gray-50 transition">
                                                            <input type="file" multiple accept="image/*" onChange={(e) => handleMultiImageUpload(room.id, e)} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:font-bold file:bg-gray-200 file:text-gray-700 hover:file:bg-gray-300 cursor-pointer" />
                                                        </div>

                                                        {room.images.length > 0 && (
                                                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mb-6">
                                                                {room.images.map((img, idx) => (
                                                                    <div key={img.id} className="relative group rounded-lg overflow-hidden border border-gray-300 shadow-sm">
                                                                        <img src={`data:${img.mimeType};base64,${img.data}`} className="w-full h-20 object-cover" />
                                                                        <button onClick={() => handleRemoveMultiImage(room.id, img.id)} className="absolute inset-0 bg-red-600/90 text-white text-xs font-bold opacity-0 group-hover:opacity-100 transition flex items-center justify-center">Remove</button>
                                                                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] font-bold uppercase text-center py-0.5">Image {idx + 1}</div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}

                                                        <div className="mt-4">
                                                            <label className="text-sm font-bold text-gray-700 block mb-2 uppercase tracking-wide">
                                                                {reportType === 'maintenance' ? 'Identified Issues:' : 'Room Report:'}
                                                            </label>
                                                            <textarea value={room.report} onChange={(e) => handleMultiReportChange(room.id, e.target.value)} className="w-full p-4 border-2 border-gray-200 rounded-xl text-sm bg-white focus:ring-[#2f314b] font-mono leading-relaxed" rows="5" placeholder="Upload images and run AI analysis, or type notes manually..." />
                                                        </div>
                                                    </div>
                                                ))}

                                                <div className="flex justify-end pt-4 border-t-2 border-gray-100">
                                                    <button onClick={polishMultiRoomText} disabled={isPolishingMain} className="text-sm bg-[#2f314b]/10 text-[#2f314b] px-6 py-3 rounded-xl font-bold hover:bg-[#2f314b]/20 transition shadow-sm">
                                                        {isPolishingMain ? 'Polishing...' : '✨ Polish All Texts Objectively'}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Fire Safety Forms */}
                                    {reportType === 'fire_safety' && (
                                        <div className="bg-white border-2 border-gray-100 p-6 sm:p-8 rounded-xl shadow-sm">
                                            <h3 className="text-xl font-bold text-gray-900 mb-6 border-b-2 border-gray-100 pb-2 uppercase tracking-wide">Fire Safety Equipment Checks</h3>
                                            
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <AlarmSection title="Smoke Detectors" config={fireSafetyData.smoke} setConfig={(val) => setFireSafetyData(prev => ({ ...prev, smoke: val }))} />
                                                <AlarmSection title="CO Alarms" config={fireSafetyData.co} setConfig={(val) => setFireSafetyData(prev => ({ ...prev, co: val }))} />
                                                <AlarmSection title="Heat Detectors" config={fireSafetyData.heat} setConfig={(val) => setFireSafetyData(prev => ({ ...prev, heat: val }))} />
                                                <AlarmSection title="Emergency Lighting" config={fireSafetyData.emergency} setConfig={(val) => setFireSafetyData(prev => ({ ...prev, emergency: val }))} hasDuration={true} />
                                            </div>

                                            <div className="bg-gray-50 p-6 rounded-xl border border-gray-200 my-8 shadow-sm">
                                                <label className="block font-bold text-gray-900 mb-5 text-xl border-b-2 border-gray-200 pb-2">Were Faults Identified?</label>
                                                <div className="flex space-x-8 mb-6">
                                                    <label className="flex items-center space-x-3 cursor-pointer group">
                                                        <input type="radio" name="hasFaults" checked={fireSafetyData.hasFaults === true} onChange={() => setFireSafetyData(prev => ({ ...prev, hasFaults: true }))} className="w-6 h-6 text-red-600 border-gray-400 focus:ring-red-600 transition" />
                                                        <span className="font-bold text-gray-800 text-lg group-hover:text-red-600 transition">Yes</span>
                                                    </label>
                                                    <label className="flex items-center space-x-3 cursor-pointer group">
                                                        <input type="radio" name="hasFaults" checked={fireSafetyData.hasFaults === false} onChange={() => setFireSafetyData(prev => ({ ...prev, hasFaults: false }))} className="w-6 h-6 text-green-600 border-gray-400 focus:ring-green-600 transition" />
                                                        <span className="font-bold text-gray-800 text-lg group-hover:text-green-600 transition">No</span>
                                                    </label>
                                                </div>

                                                {fireSafetyData.hasFaults && (
                                                    <div className="space-y-6 pt-6 border-t-2 border-gray-200 animate-in fade-in">
                                                        <div>
                                                            <label className="block text-sm font-bold text-gray-800 mb-2 uppercase tracking-wide">Fault Details <span className="text-red-600">*</span></label>
                                                            <textarea rows="3" required placeholder="Detail the faults found during testing." value={fireSafetyData.faults} onChange={(e) => setFireSafetyData(prev => ({ ...prev, faults: e.target.value }))} className="w-full border-2 border-gray-300 rounded-xl p-4 text-sm font-medium focus:ring-[#2f314b]" />
                                                        </div>
                                                        <div>
                                                            <label className="block text-sm font-bold text-gray-800 mb-2 uppercase tracking-wide">Action Plan <span className="text-red-600">*</span></label>
                                                            <textarea rows="2" required placeholder="What is the plan to resolve these faults?" value={fireSafetyData.actionPlan} onChange={(e) => setFireSafetyData(prev => ({ ...prev, actionPlan: e.target.value }))} className="w-full border-2 border-gray-300 rounded-xl p-4 text-sm font-medium focus:ring-[#2f314b]" />
                                                        </div>
                                                        <div className="pt-6 border-t-2 border-gray-200">
                                                            <label className="flex items-center space-x-3 mb-5 cursor-pointer">
                                                                <input type="checkbox" checked={fireSafetyData.isResolved} onChange={(e) => setFireSafetyData(prev => ({ ...prev, isResolved: e.target.checked }))} className="w-6 h-6 text-green-600 border-gray-400 rounded focus:ring-green-600" />
                                                                <span className="font-bold text-gray-900 text-lg">Fault Resolved?</span>
                                                            </label>
                                                            {fireSafetyData.isResolved && (
                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white p-5 rounded-xl border border-gray-200 shadow-sm animate-in fade-in">
                                                                    <div>
                                                                        <label className="block text-sm font-bold text-gray-700 mb-2">Date and Time of Resolution <span className="text-red-600">*</span></label>
                                                                        <input type="datetime-local" required value={fireSafetyData.resolvedDate} onChange={(e) => setFireSafetyData(prev => ({ ...prev, resolvedDate: e.target.value }))} className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-[#2f314b] font-medium" />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-bold text-gray-700 mb-2">Resolved By <span className="text-red-600">*</span></label>
                                                                        <input type="text" required placeholder="Name of person who resolved it" value={fireSafetyData.resolvedBy} onChange={(e) => setFireSafetyData(prev => ({ ...prev, resolvedBy: e.target.value }))} className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-[#2f314b] font-medium" />
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <SignaturePad initialData={fireSafetyData.signature} onSignatureEnd={(sig) => setFireSafetyData(prev => ({ ...prev, signature: sig }))} />
                                        </div>
                                    )}

                                    <div className="flex justify-between items-center pt-6 border-t border-gray-200">
                                        <button onClick={() => setStep(1)} className="text-gray-600 px-8 py-3 font-bold hover:bg-gray-100 rounded-xl transition">← Back</button>
                                        <button onClick={() => setStep(3)} disabled={!canProceedToStep3} className="bg-[#2f314b] text-white px-10 py-4 rounded-xl font-bold shadow-md hover:bg-[#2f314b]/90 transition disabled:opacity-50 disabled:cursor-not-allowed text-lg">
                                            Proceed to Final Review →
                                        </button>
                                    </div>
                                    {!canProceedToStep3 && <p className="text-sm font-bold text-red-500 text-right mt-2">Ensure reports contain text or images before review.</p>}
                                </div>
                            )}

                        </div>
                    </>
                )}

                {/* ─── STEP 3: REVIEW / VIEW PDF PORTFOLIO REPORT ─── */}
                {(currentView === 'wizard' && step === 3) || currentView === 'view' ? (
                    <div className="p-6 sm:p-8 bg-gray-50 border-t border-gray-200">
                        {pdfFallbackMsg && (
                            <div className="p-4 bg-amber-50 text-amber-800 rounded-xl text-sm border-2 border-amber-200 print:hidden mb-6 font-bold">{pdfFallbackMsg}</div>
                        )}

                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print:hidden mb-8">
                            {currentView === 'wizard' ? (
                                <>
                                    <button onClick={() => setStep(2)} disabled={isProcessing} className="text-gray-600 px-6 py-3 font-bold hover:bg-gray-200 rounded-xl transition disabled:opacity-50">← Back to Editor</button>
                                    <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                                        <button onClick={handleSaveReportToPortfolio} disabled={isProcessing} className="bg-green-600 text-white px-6 py-3 rounded-xl font-bold shadow hover:bg-green-700 transition disabled:opacity-50 flex-1 sm:flex-none text-center">
                                            {isProcessing ? 'Saving...' : '💾 Save to Portfolio'}
                                        </button>
                                        <button onClick={handleDownloadPDFWrapper} disabled={isProcessing} className="bg-[#2f314b] text-white px-8 py-3 rounded-xl font-bold shadow hover:bg-[#2f314b]/90 transition disabled:opacity-50 flex-1 sm:flex-none text-center">
                                            {isProcessing ? 'Generating...' : 'Download PDF'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <button onClick={goPortfolio} disabled={isProcessing} className="text-gray-600 px-6 py-3 font-bold hover:bg-gray-200 rounded-xl transition disabled:opacity-50">← Back to Portfolio</button>
                                    <button onClick={handleDownloadPDFWrapper} disabled={isProcessing} className="bg-[#2f314b] text-white px-8 py-3 rounded-xl font-bold shadow hover:bg-[#2f314b]/90 transition disabled:opacity-50 w-full sm:w-auto text-center">
                                        {isProcessing ? 'Generating...' : 'Download PDF'}
                                    </button>
                                </>
                            )}
                        </div>

                        {/* PRINTABLE PDF AREA - All fonts completely pixel-locked for PDF */}
                        <div className="bg-white p-10 print:p-0 max-w-[210mm] mx-auto shadow-lg border border-gray-200 text-gray-900" id="printable-report" style={{ fontFamily: "Arial, sans-serif" }}>

                            {/* Single Room Inventory / Checkout PDF Layout */}
                            {!isMultiRoom && (reportType === 'inventory' || reportType === 'checkout') && (
                                <>
                                    <div className="mb-8 text-center flex flex-col items-center border-b-2 border-gray-100 pb-6">
                                        <img src={logoSrc} alt="Arlington Park" crossOrigin="anonymous" style={{ height: '72px' }} className="mb-4 object-contain" />
                                        <h2 className="text-[18px] font-black uppercase tracking-widest text-[#2f314b]">
                                            {reportType === 'checkout' ? 'Check-Out Report & Schedule of Condition' : 'Property Inventory & Schedule of Condition'}
                                        </h2>
                                    </div>

                                    <div className="grid grid-cols-1 gap-2 mb-8 text-[12px] bg-gray-50 p-4 rounded-lg border border-gray-200">
                                        <div className="flex"><span className="w-48 font-bold text-gray-600 uppercase tracking-wide">Property Address:</span><span className="font-bold">{tenancyInfo.roomIdentifier ? `${tenancyInfo.roomIdentifier}, ` : ''}{currentProperty?.address || ''}</span></div>
                                        <div className="flex"><span className="w-48 font-bold text-gray-600 uppercase tracking-wide">Tenant Name:</span> <span className="font-medium">{tenancyInfo.tenantName || ''}</span></div>
                                        <div className="flex"><span className="w-48 font-bold text-gray-600 uppercase tracking-wide">{reportType === 'checkout' ? 'Check-out Date:' : 'Move-in Date:'}</span> <span className="font-medium">{formatOrdinalDate(reportType === 'checkout' ? tenancyInfo.checkOutDate : tenancyInfo.moveInDate)}</span></div>
                                        <div className="flex"><span className="w-48 font-bold text-gray-600 uppercase tracking-wide">Inspection Date:</span> <span className="font-medium">{formatOrdinalDate(tenancyInfo.dateOfInventory)}</span></div>
                                        <div className="flex"><span className="w-48 font-bold text-gray-600 uppercase tracking-wide">Inspected By:</span> <span className="font-medium">{tenancyInfo.clerkName || ''}</span></div>
                                    </div>

                                    <div className="mb-10 text-[12px]">
                                        {renderReportText(mainReport)}
                                    </div>

                                    <div className="mt-8 break-inside-avoid bg-gray-50 p-6 rounded-lg border border-gray-200">
                                        <h3 className="text-[14px] font-black mb-4 uppercase tracking-wide border-b border-gray-300 pb-2">Declaration</h3>
                                        <p className="text-[12px] mb-8 font-medium">This report is a fair and accurate representation of the property at the time of inspection.</p>
                                        <div className="space-y-5 text-[12px]">
                                            <p><strong className="uppercase text-gray-600 mr-2">Signed (Agent):</strong> <span className="border-b border-black inline-block w-64 pb-1">{tenancyInfo.clerkName || ''}</span></p>
                                            <p><strong className="uppercase text-gray-600 mr-2">Date:</strong> <span className="border-b border-black inline-block w-64 pb-1">{formatOrdinalDate(tenancyInfo.dateOfInventory) || ''}</span></p>
                                        </div>
                                    </div>

                                    {mainImages.length > 0 && (
                                        <div className="html2pdf__page-break w-full mt-10 pt-8 border-t-4 border-gray-800" style={{ fontSize: 0 }}>
                                            <h3 className="text-[16px] font-black mb-6 uppercase tracking-widest text-center bg-gray-100 py-2 border border-gray-200" style={{ fontSize: '16px' }}>Photographic Evidence</h3>
                                            <div className="block w-full">
                                                {mainImages.map((img, idx) => (
                                                    <div key={img.id} className="break-inside-avoid inline-block align-top mb-6" style={{ width: '31%', marginRight: idx % 3 === 2 ? '0' : '3.5%', fontSize: '12px' }}>
                                                        <div className="bg-gray-100 p-1 border border-gray-300 border-b-0 rounded-t-lg">
                                                            <p className="text-[10px] font-bold text-gray-700 uppercase tracking-wider text-center">
                                                                Image {idx + 1}
                                                            </p>
                                                            {img.room && <p className="text-[10px] text-gray-500 font-bold text-center truncate px-1" title={img.room}>{img.room}</p>}
                                                        </div>
                                                        <img src={`data:${img.mimeType};base64,${img.data}`} className="w-full h-40 object-cover rounded-b-lg shadow-sm border border-gray-300 border-t-0" />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Multi-Room PDF Layout (Maintenance OR Full Property Checkout) */}
                            {isMultiRoom && (
                                <>
                                    <div className="mb-8 text-center flex flex-col items-center border-b-2 border-gray-100 pb-6">
                                        <img src={logoSrc} alt="Arlington Park" crossOrigin="anonymous" style={{ height: '72px' }} className="mb-4 object-contain" />
                                        <h2 className="text-[18px] font-black uppercase tracking-widest text-[#2f314b]">
                                            {reportType === 'maintenance' ? 'Property Maintenance Schedule' : 'Check-Out Report & Schedule of Condition'}
                                        </h2>
                                        {reportType === 'checkout' && <p className="text-gray-500 font-bold text-[11px] uppercase tracking-widest mt-1">Full Property Scope</p>}
                                    </div>

                                    <div className="grid grid-cols-1 gap-2 mb-10 text-[12px] bg-gray-50 p-4 rounded-lg border border-gray-200">
                                        <div className="flex"><span className="w-48 font-bold text-gray-600 uppercase tracking-wide">Property Address:</span> <span className="font-bold">{currentProperty?.address}</span></div>
                                        {reportType === 'checkout' && (
                                            <>
                                                <div className="flex"><span className="w-48 font-bold text-gray-600 uppercase tracking-wide">Tenant Name:</span> <span className="font-medium">{tenancyInfo.tenantName || ''}</span></div>
                                                <div className="flex"><span className="w-48 font-bold text-gray-600 uppercase tracking-wide">Check-out Date:</span> <span className="font-medium">{formatOrdinalDate(tenancyInfo.checkOutDate)}</span></div>
                                            </>
                                        )}
                                        <div className="flex"><span className="w-48 font-bold text-gray-600 uppercase tracking-wide">Inspection Date:</span> <span className="font-medium">{formatOrdinalDate(reportType === 'checkout' ? tenancyInfo.dateOfInventory : maintenanceMeta.date)}</span></div>
                                        <div className="flex"><span className="w-48 font-bold text-gray-600 uppercase tracking-wide">Inspected By:</span> <span className="font-medium">{reportType === 'checkout' ? tenancyInfo.clerkName : maintenanceMeta.clerkName || ''}</span></div>
                                    </div>

                                    <div className="border-l-4 border-[#2f314b] pl-6 space-y-10">
                                        {multiRoomData.map((room) => (
                                            <div key={room.id} className="break-inside-avoid border border-gray-200 rounded-lg p-5 bg-white shadow-sm">
                                                <h4 className="text-[16px] font-black mb-4 uppercase tracking-wide text-[#2f314b] border-b border-gray-100 pb-2">{room.name}</h4>
                                                
                                                {room.report && (
                                                    <div className="mb-6 text-[12px] bg-gray-50 p-4 rounded border border-gray-100">
                                                        {renderReportText(room.report)}
                                                    </div>
                                                )}

                                                {room.images.length > 0 && (
                                                    <div className="block w-full mt-4" style={{ fontSize: 0 }}>
                                                        <h5 className="text-[12px] font-bold uppercase tracking-wide text-gray-500 mb-3">Evidence</h5>
                                                        {room.images.map((img, iIdx) => (
                                                            <div key={img.id} className="break-inside-avoid inline-block align-top mb-4" style={{ width: '31%', marginRight: iIdx % 3 === 2 ? '0' : '3.5%', fontSize: '12px' }}>
                                                                <p className="text-[10px] font-bold mb-1 text-gray-500 uppercase tracking-wider text-center bg-gray-100 py-1 rounded-t border border-gray-300 border-b-0">Image {iIdx + 1}</p>
                                                                <img src={`data:${img.mimeType};base64,${img.data}`} className="w-full h-32 object-cover rounded-b shadow-sm border border-gray-300" />
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {reportType === 'checkout' && (
                                        <div className="mt-8 break-inside-avoid bg-gray-50 p-6 rounded-lg border border-gray-200">
                                            <h3 className="text-[14px] font-black mb-4 uppercase tracking-wide border-b border-gray-300 pb-2">Declaration</h3>
                                            <p className="text-[12px] mb-8 font-medium">This report is a fair and accurate representation of the property at the time of inspection.</p>
                                            <div className="space-y-5 text-[12px]">
                                                <p><strong className="uppercase text-gray-600 mr-2">Signed (Agent):</strong> <span className="border-b border-black inline-block w-64 pb-1">{tenancyInfo.clerkName || ''}</span></p>
                                                <p><strong className="uppercase text-gray-600 mr-2">Date:</strong> <span className="border-b border-black inline-block w-64 pb-1">{formatOrdinalDate(tenancyInfo.dateOfInventory) || ''}</span></p>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Fire Safety PDF Layout */}
                            {reportType === 'fire_safety' && (
                                <>
                                    <div className="mb-6 text-center flex flex-col items-center border-b-2 border-red-600 pb-6">
                                        <img src={logoSrc} alt="Arlington Park Logo" crossOrigin="anonymous" style={{ height: '60px' }} className="mb-3 object-contain" />
                                        <h2 className="text-[20px] font-black uppercase tracking-widest text-[#2f314b]">Fire Safety Inspection</h2>
                                        <p className="text-gray-500 font-bold text-[11px] uppercase tracking-widest mt-1">Official Record of Testing</p>
                                    </div>

                                    <div className="flex gap-4 mb-8 text-[12px]">
                                        <div className="flex-1 border border-gray-300 p-5 rounded-lg bg-gray-50 shadow-sm">
                                            <h3 className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-3 border-b border-gray-200 pb-1">Property Details</h3>
                                            <p className="font-bold text-[14px] leading-relaxed">{currentProperty?.address}</p>
                                        </div>
                                        <div className="flex-1 border border-gray-300 p-5 rounded-lg bg-gray-50 shadow-sm">
                                            <h3 className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-3 border-b border-gray-200 pb-1">Inspection Details</h3>
                                            <p className="mb-2"><strong className="text-gray-700 uppercase text-[10px]">Date of Test:</strong> <span className="ml-2 font-medium">{formatOrdinalDate(tenancyInfo.dateOfInventory)}</span></p>
                                            <p><strong className="text-gray-700 uppercase text-[10px]">Inspector:</strong> <span className="ml-2 font-medium">{tenancyInfo.clerkName || 'Not specified'}</span></p>
                                        </div>
                                    </div>

                                    <h3 className="text-[13px] font-black uppercase tracking-widest border-b-2 border-black pb-1 mb-4 text-[#2f314b]">Equipment Testing Log</h3>
                                    <table className="w-full mb-10 text-[12px] text-left border-collapse border border-gray-300 shadow-sm">
                                        <thead className="bg-[#2f314b] text-white">
                                            <tr>
                                                <th className="p-3 font-bold uppercase tracking-wider text-[10px] w-1/4">Equipment Type</th>
                                                <th className="p-3 font-bold uppercase tracking-wider text-[10px] text-center w-1/6">Status</th>
                                                <th className="p-3 font-bold uppercase tracking-wider text-[10px] text-center w-1/6">Quantity</th>
                                                <th className="p-3 font-bold uppercase tracking-wider text-[10px] w-1/4">Location</th>
                                                <th className="p-3 font-bold uppercase tracking-wider text-[10px] w-1/6">Duration</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <AlarmRow title="Smoke Detectors" config={fireSafetyData.smoke} />
                                            <AlarmRow title="CO Alarms" config={fireSafetyData.co} />
                                            <AlarmRow title="Heat Detectors" config={fireSafetyData.heat} />
                                            <AlarmRow title="Emergency Lighting" config={fireSafetyData.emergency} />
                                        </tbody>
                                    </table>

                                    <h3 className="text-[13px] font-black uppercase tracking-widest border-b-2 border-black pb-1 mb-4 text-[#2f314b]">Faults & Remedial Action</h3>
                                    <div className={`p-6 mb-10 rounded-lg text-[12px] border-2 shadow-sm ${fireSafetyData.hasFaults ? 'border-red-500 bg-red-50' : 'border-green-500 bg-green-50'}`}>
                                        {fireSafetyData.hasFaults ? (
                                            <div className="flex gap-6">
                                                <div className="flex-1 border-r-2 border-red-200 pr-6">
                                                    <p className="font-black text-red-600 uppercase tracking-widest text-[11px] mb-2 border-b border-red-200 pb-1">Identified Faults</p>
                                                    <p className="mb-6 font-medium leading-relaxed">{fireSafetyData.faults}</p>
                                                    
                                                    <p className="font-black text-red-600 uppercase tracking-widest text-[11px] mb-2 border-b border-red-200 pb-1">Action Plan</p>
                                                    <p className="font-medium leading-relaxed">{fireSafetyData.actionPlan || 'Not specified'}</p>
                                                </div>
                                                <div className="flex-1 pl-2">
                                                    <p className="font-black text-gray-800 uppercase tracking-widest text-[11px] mb-2 border-b border-gray-300 pb-1">Resolution Status</p>
                                                    {fireSafetyData.isResolved ? (
                                                        <div className="bg-white p-4 rounded border border-green-200 shadow-sm mt-3">
                                                            <p className="font-black text-green-600 text-[14px] uppercase tracking-widest mb-3">✓ RESOLVED</p>
                                                            <p className="text-gray-800 mb-2"><strong className="uppercase text-[10px] text-gray-500">Date:</strong> <span className="font-medium ml-2">{formatOrdinalDateTime(fireSafetyData.resolvedDate)}</span></p>
                                                            <p className="text-gray-800"><strong className="uppercase text-[10px] text-gray-500">By:</strong> <span className="font-medium ml-2">{fireSafetyData.resolvedBy}</span></p>
                                                        </div>
                                                    ) : (
                                                        <div className="bg-white p-4 rounded border border-red-200 shadow-sm mt-3">
                                                            <p className="text-red-600 font-black text-[14px] uppercase tracking-widest">⚠ ACTION REQUIRED</p>
                                                            <p className="text-xs font-medium text-red-400 mt-1 uppercase">Fault remains unresolved</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center py-4">
                                                <span className="text-2xl mr-3">✓</span>
                                                <p className="font-black text-green-700 text-[14px] uppercase tracking-widest m-0">No faults identified. Property is compliant.</p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex justify-end mt-12 break-inside-avoid">
                                        <div className="w-72 border-2 border-gray-300 rounded-lg p-5 bg-white shadow-sm">
                                            <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest border-b-2 border-gray-200 pb-2 mb-4 text-center">Authorized Sign-off</p>
                                            <div className="h-16 flex items-center justify-center mb-4 bg-gray-50 rounded border border-dashed border-gray-300">
                                                {fireSafetyData.signature ? (
                                                    <img src={fireSafetyData.signature} className="max-h-full max-w-full mix-blend-multiply" alt="Signature" crossOrigin="anonymous" />
                                                ) : (
                                                    <span className="text-gray-400 italic text-[10px] font-bold">No signature provided</span>
                                                )}
                                            </div>
                                            <p className="text-center font-black text-[14px] uppercase tracking-wide text-[#2f314b]">{tenancyInfo.clerkName || 'Inspector'}</p>
                                        </div>
                                    </div>
                                </>
                            )}

                        </div>
                    </div>
                ) : null}

            </div>

            <footer className="max-w-4xl mx-auto mt-8 text-center print:hidden pb-8">
                <div className="text-xs font-bold text-gray-500 mb-3 px-4 text-balance uppercase tracking-widest">
                    &copy; {new Date().getFullYear()} Luke Martin - Arlington Park Lettings & Estate Agents <br/> 25a Earlham Rd, Norwich NR2 3AD{' '}
                    <br/><a href="https://arlingtonpark.co.uk" target="_blank" rel="noopener noreferrer" className="hover:text-[#2f314b] underline transition mt-1 inline-block">arlingtonpark.co.uk</a>
                </div>
                <button onClick={() => setShowApiSettings(true)} className="text-[10px] font-bold text-gray-400 hover:text-gray-600 underline transition uppercase tracking-widest">
                    AI API Settings
                </button>
            </footer>

            {showApiSettings && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 print:hidden p-4 transition-opacity" onClick={handleModalBackdropClick}>
                    <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full border border-gray-200 animate-in zoom-in-95">
                        <h3 className="text-xl font-black text-gray-900 mb-6 border-b-2 border-gray-100 pb-2">API Configuration</h3>
                        <input
                            type="password"
                            value={activeApiKey}
                            onChange={handleApiChange}
                            placeholder="Gemini API Key..."
                            autoComplete="off"
                            className="w-full p-3 text-sm border-2 border-gray-200 rounded-xl focus:ring-[#2f314b] focus:border-[#2f314b] mb-4 font-medium transition"
                        />
                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mb-6">
                            <p className="text-[11px] font-bold text-blue-800 uppercase tracking-wide mb-1">Local Storage Active</p>
                            <p className="text-[11px] font-medium text-blue-600 leading-relaxed">This key and all property reports are saved securely to your browser's local IndexedDB. They are never sent to external database servers.</p>
                        </div>
                        <div className="flex justify-end">
                            <button onClick={() => setShowApiSettings(false)} className="bg-[#2f314b] text-white px-8 py-3 rounded-xl font-bold hover:bg-[#2f314b]/90 transition shadow-md">
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}