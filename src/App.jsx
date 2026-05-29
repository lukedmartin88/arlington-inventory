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
import {
  getStorage,
  ref,
  uploadString,
  getDownloadURL,
  deleteObject,
  listAll
} from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "fire-safety-testing.firebaseapp.com",
  projectId: "fire-safety-testing",
  storageBucket: "fire-safety-testing.firebasestorage.app",
  messagingSenderId: "622006469176",
  appId: "1:622006469176:web:fa890d9b1ec95ba9869ccd",
  measurementId: "G-DZ935GWD3B"
};

// Initialise Firebase, Firestore, and Storage
const app = initializeApp(firebaseConfig);
const firestoreDb = getFirestore(app);
const storage = getStorage(app);

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
        'gemini-2.5-flash-preview-05-20',
        'gemini-2.5-flash',
        'gemini-2.0-flash-exp',
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

// --- Firebase Firestore Database ---

const dbGetAll = async (storeName) => {
    const snapshot = await getDocs(collection(firestoreDb, storeName));
    return snapshot.docs.map(doc => doc.data());
};

const dbPut = async (storeName, item) => {
    const docRef = doc(firestoreDb, storeName, item.id);
    await setDoc(docRef, item);
    return item;
};

const dbDelete = async (storeName, id) => {
    const docRef = doc(firestoreDb, storeName, id);
    await deleteDoc(docRef);
};

const dbGetReportsByProperty = async (propertyId) => {
    const reportsRef = collection(firestoreDb, STORE_REPORTS);
    const q = query(reportsRef, where("propertyId", "==", propertyId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data());
};

const dbGetReport = async (id) => {
    const docRef = doc(firestoreDb, STORE_REPORTS, id);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
        return docSnap.data();
    } else {
        throw new Error("Report not found in database.");
    }
};

// --- Firebase Storage Helpers ---

const uploadImageToStorage = async (reportId, imageId, mimeType, base64Data) => {
    const path = `reports/${reportId}/${imageId}`;
    const imageRef = ref(storage, path);
    const dataUrl = `data:${mimeType};base64,${base64Data}`;
    await uploadString(imageRef, dataUrl, 'data_url');
    return await getDownloadURL(imageRef);
};

const deleteReportImages = async (reportId) => {
    try {
        const folderRef = ref(storage, `reports/${reportId}`);
        const listResult = await listAll(folderRef);
        await Promise.all(listResult.items.map(itemRef => deleteObject(itemRef)));
    } catch (e) {
        console.warn("Could not delete storage images for report:", reportId, e.message);
    }
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
    const [currentView, setCurrentView] = useState('home'); 
    
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
    
    // Multi-Room Data Arrays
    const [maintenanceMeta, setMaintenanceMeta] = useState({ date: '', clerkName: '' });
    const [multiRoomData, setMultiRoomData] = useState([{ id: newId(), name: '', images: [], report: '' }]);
    const [uncategorisedImages, setUncategorisedImages] = useState([]);
    
    // Lightbox State
    const [lightboxImage, setLightboxImage] = useState(null);
    const roomInputRefs = useRef({});

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

  // Sync browser back history with app views
  useEffect(() => {
    if (!window.history.state || window.history.state.view !== currentView || window.history.state.step !== step) {
      window.history.pushState({ view: currentView, step: step }, "");
    }
  }, [currentView, step]);

  useEffect(() => {
    const handlePopState = async (event) => {
      if (event.state) {
        const { view, step: targetStep } = event.state;
        
        if (currentView === 'wizard' && view === 'wizard') {
          if (step > targetStep) {
            setStep(targetStep);
          }
        } else {
          if (view === 'portfolio' && selectedPropertyId) {
            const reports = await dbGetReportsByProperty(selectedPropertyId);
            setPropertyReports(reports.sort((a,b) => new Date(b.reportDate) - new Date(a.reportDate)));
          }
          setCurrentView(view);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentView, step, selectedPropertyId]);
  
    // --- Modal Handler ---
    const handleModalBackdropClick = (e) => {
        if (e.target === e.currentTarget) setShowApiSettings(false);
    };

    useEffect(() => {
        if (!showApiSettings && !lightboxImage) return;
        const handleKey = (e) => { 
            if (e.key === 'Escape') {
                setShowApiSettings(false);
                setLightboxImage(null);
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [showApiSettings, lightboxImage]);

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
        setUncategorisedImages([]);
        setFireSafetyData(report.data.fireSafetyData || {});
        
        setSelectedReportId(id);
        setStep(3);
        setCurrentView('view');
    };

    const handleSaveReportToPortfolio = async () => {
        setIsProcessing(true);
        setErrorMsg('');
        let displayDate = new Date().toISOString();
        let inspectorName = '';

        if (reportType === 'inventory' || reportType === 'checkout' || reportType === 'fire_safety') {
            displayDate = tenancyInfo.dateOfInventory || displayDate;
            inspectorName = tenancyInfo.clerkName;
        } else if (reportType === 'maintenance') {
            displayDate = maintenanceMeta.date || displayDate;
            inspectorName = maintenanceMeta.clerkName;
        }

        const reportId = newId();

        try {
            setLoadingState({ active: true, progress: 10, text: 'Uploading images...' });

            const mainImagesUploaded = [];
            for (const img of mainImages) {
                if (!img.data) {
                    mainImagesUploaded.push(img);
                    continue;
                }
                try {
                    const url = await uploadImageToStorage(reportId, img.id, img.mimeType, img.data);
                    mainImagesUploaded.push({ ...img, data: '', url });
                } catch (e) {
                    console.error("Failed to upload image:", img.id, e);
                    mainImagesUploaded.push({ ...img, data: '' }); 
                }
            }

            const multiRoomDataUploaded = [];
            for (const room of multiRoomData) {
                const uploadedImages = [];
                for (const img of room.images) {
                    if (!img.data) {
                        uploadedImages.push(img);
                        continue;
                    }
                    try {
                        const url = await uploadImageToStorage(reportId, img.id, img.mimeType, img.data);
                        uploadedImages.push({ ...img, data: '', url });
                    } catch (e) {
                        console.error("Failed to upload multi-room image:", img.id, e);
                        uploadedImages.push({ ...img, data: '' });
                    }
                }
                multiRoomDataUploaded.push({ ...room, images: uploadedImages });
            }

            setLoadingState({ active: true, progress: 80, text: 'Saving report...' });
          
            const reportData = {
                id: reportId,
                propertyId: selectedPropertyId,
                reportType,
                reportDate: displayDate,
                inspectorName,
                createdAt: new Date().toISOString(),
                data: { tenancyInfo, mainImages: mainImagesUploaded, mainReport, maintenanceMeta, multiRoomData: multiRoomDataUploaded, fireSafetyData }
            };

            await dbPut(STORE_REPORTS, reportData);
            setLoadingState({ active: true, progress: 100, text: 'Saved!' });
            setTimeout(() => setLoadingState({ active: false, progress: 0, text: '' }), 1000);
            await goPortfolio();
        } catch (err) {
            console.error(err);
            setErrorMsg("Failed to save report. Check your connection and try again.");
            setLoadingState({ active: false, progress: 0, text: '' });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDeleteReport = async (id) => {
        if (window.confirm("Delete this report permanently?")) {
            await deleteReportImages(id);
            await dbDelete(STORE_REPORTS, id);
            const reports = await dbGetReportsByProperty(selectedPropertyId);
            setPropertyReports(reports.sort((a,b) => new Date(b.reportDate) - new Date(a.reportDate)));
        }
    };

    const handleResetWizard = () => {
        setReportType(null);
        setMainReport('');
        setMainImages([]);
        setUncategorisedImages([]);
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
    const addMultiRoom = () => {
        const rId = newId();
        setMultiRoomData(prev => [...prev, { id: rId, name: '', images: [], report: '' }]);
        
        // Auto-focus the newly created input
        setTimeout(() => {
            if (roomInputRefs.current[rId]) {
                roomInputRefs.current[rId].focus();
            }
        }, 50);
    };

    const handleRoomInputKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addMultiRoom();
        }
    };

    const removeMultiRoom = (rId) => {
        setMultiRoomData(prev => {
            const roomToDelete = prev.find(r => r.id === rId);
            if (roomToDelete && roomToDelete.images.length > 0) {
                // Rescue images back to the uncategorised pool
                setUncategorisedImages(existing => [...existing, ...roomToDelete.images]);
            }
            return prev.filter(r => r.id !== rId);
        });
    };
    const updateMultiRoomName = (rId, val) => setMultiRoomData(prev => prev.map(r => r.id === rId ? { ...r, name: val } : r));
    const handleMultiReportChange = (rId, text) => setMultiRoomData(prev => prev.map(r => r.id === rId ? { ...r, report: text } : r));

    // --- Image Processing & Assignment Handlers ---
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

    // Bulk Image Upload Handler
    const handleBulkImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        const results = await Promise.all(files.map(f => compressImage(f)));
        const successful = results.filter(r => !r.failed);
        setUncategorisedImages(prev => [...prev, ...successful]);
        e.target.value = '';
    };

    const removeUncategorisedImage = (imgId) => {
        setUncategorisedImages(prev => prev.filter(img => img.id !== imgId));
    };

    const handleRemoveMultiImage = (rId, imgId) => {
        setMultiRoomData(prev => prev.map(r => r.id === rId ? { ...r, images: r.images.filter(i => i.id !== imgId) } : r));
    };

    // Move from uncategorised to a specific room
    const assignImageToRoom = (imgId, targetRoomId) => {
        if (!targetRoomId) return;
        setUncategorisedImages(prev => {
            const imgToMove = prev.find(img => img.id === imgId);
            if (imgToMove) {
                setMultiRoomData(rooms => rooms.map(room => {
                    if (room.id === targetRoomId) {
                        return { ...room, images: [...room.images, imgToMove] };
                    }
                    return room;
                }));
            }
            return prev.filter(img => img.id !== imgId);
        });
    };

    // Move from a specific room back to uncategorised
    const moveImageToUncategorised = (roomId, imgId) => {
        setMultiRoomData(rooms => {
            let imgToMove = null;
            const updatedRooms = rooms.map(room => {
                if (room.id === roomId) {
                    imgToMove = room.images.find(img => img.id === imgId);
                    return { ...room, images: room.images.filter(img => img.id !== imgId) };
                }
                return room;
            });
            if (imgToMove) {
                setUncategorisedImages(prev => [...prev, imgToMove]);
            }
            return updatedRooms;
        });
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

    const analyseMultiRoomImages = async (specificRoomId = null) => {
        if (!activeApiKey) return setErrorMsg("Missing API Key.");
        setIsAnalysingMain(true);
        setErrorMsg('');
        
        let updatedRooms = JSON.parse(JSON.stringify(multiRoomData));
        const tasks = updatedRooms.filter(r => (specificRoomId ? r.id === specificRoomId : true) && r.images.length > 0);

        if (tasks.length === 0) {
            setErrorMsg("No images uploaded to analyse in the selected room(s).");
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

            {/* Lightbox Modal */}
            {lightboxImage && (
                <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setLightboxImage(null)}>
                    <img 
                        src={lightboxImage.data ? `data:${lightboxImage.mimeType};base64,${lightboxImage.data}` : lightboxImage.url} 
                        className="max-h-[90vh] max-w-[90vw] object-contain rounded-xl shadow-2xl" 
                        alt="Enlarged view" 
                    />
                </div>
            )}

            <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden print:shadow-none">

               {/* Main Branding Header */}
<div className="bg-[#2f314b] text-white p-4 sm:p-6 print:hidden flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
  <div className="flex items-center gap-4 cursor-pointer" onClick={goHome}>
    <img src={logoSrc} alt="Arlington Park Logo" crossOrigin="anonymous" className="h-10 sm:h-12 object-contain" />
    <h1 className="text-xl sm:text-2xl font-bold">Arlington Park Reports</h1>
  </div>
  
  {currentProperty?.address && (currentView === 'wizard' || currentView === 'view') && (
    <div className="bg-white/10 px-4 py-2 rounded-lg border border-white/20 text-sm font-semibold max-w-md truncate">
      <span className="text-white/60 font-normal block text-[11px] uppercase tracking-wider mb-0.5">Active Property</span>
      {currentProperty.address}
    </div>
  )}
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
                                            <p className="text-sm text-gray-500 mb-4 font-medium">Type a room name and press <kbd className="bg-gray-200 px-2 py-1 rounded text-xs font-bold text-gray-700 border border-gray-300 shadow-sm mx-1">Enter</kbd> to quickly add the next room.</p>
                                            <div className="space-y-4">
                                                {multiRoomData.map((room, idx) => (
                                                    <div key={room.id} className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200">
                                                        <span className="font-bold text-gray-400 w-6 text-center">{idx + 1}.</span>
                                                        <input 
                                                            type="text" 
                                                            value={room.name} 
                                                            onChange={(e) => updateMultiRoomName(room.id, e.target.value)} 
                                                            onKeyDown={handleRoomInputKeyDown}
                                                            placeholder="e.g. Kitchen, Bedroom 1, En-suite Bathroom" 
                                                            className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-[#2f314b] font-medium bg-white"
                                                            ref={el => roomInputRefs.current[room.id] = el}
                                                        />
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
                                                                <img 
                                                                    src={img.data ? `data:${img.mimeType};base64,${img.data}` : img.url} 
                                                                    alt={`Upload ${idx + 1}`} 
                                                                    className="w-full h-32 object-cover cursor-zoom-in" 
                                                                    onClick={() => setLightboxImage(img)}
                                                                />
                                                                <div className="absolute inset-0 bg-black/40 transition opacity-0 group-hover:opacity-100 flex items-center justify-center pointer-events-none">
                                                                    <button onClick={() => handleRemoveImage(img.id)} className="bg-red-600 text-white text-xs rounded-lg px-4 py-2 font-bold hover:bg-red-700 shadow pointer-events-auto">Remove</button>
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

                                    {/* Multi-Room Analysis UI (Maintenance, Full Property Checkout) with Dropdown Selectors */}
                                    {isMultiRoom && (
                                        <div className="space-y-6">
                                            
                                            {/* Master Bulk Upload Panel */}
                                            <div className="bg-white border-2 border-gray-100 p-6 rounded-xl shadow-sm">
                                                <h3 className="text-xl font-bold text-gray-900 border-b-2 border-gray-200 pb-2 mb-4">Master Photo Upload</h3>
                                                <p className="text-sm text-gray-500 mb-4 font-medium">Upload all your photos here in bulk, then use the dropdown beneath each photo to allocate it to the correct room.</p>
                                                
                                                <div className="p-4 border-2 border-dashed border-[#2f314b]/30 rounded-xl bg-gray-50 mb-6 transition hover:bg-gray-100">
                                                    <input type="file" multiple accept="image/*" onChange={handleBulkImageUpload} className="block w-full text-sm text-gray-500 file:mr-6 file:py-3 file:px-6 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-[#2f314b] file:text-white hover:file:bg-[#2f3