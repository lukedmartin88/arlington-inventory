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

const app = initializeApp(firebaseConfig);
const firestoreDb = getFirestore(app);
const storage = getStorage(app);

const STORE_PROPS = 'properties';
const STORE_REPORTS = 'reports';

const getEnvKey = () => {
    try {
        const envKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (envKey) return envKey;
        const savedKey = localStorage.getItem('arlington_gemini_api_key');
        return savedKey || "";
    } catch (e) {
        console.warn("Local storage disabled or unavailable:", e);
        return "STORAGE_ERROR"; 
    }
};

const callGeminiWithFallback = async (payload, activeApiKey) => {
    let lastError = null;
    
    // Updated to use the active production models
    const defaultModels = [
        'gemini-3.5-flash',
        'gemini-3.0-flash',
        'gemini-2.5-flash',
        'gemini-1.5-flash'
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

const newId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

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
    if (docSnap.exists()) return docSnap.data();
    throw new Error("Report not found in database.");
};

// FIX: Re-added explicitly defining the MIME type in the upload string
const uploadImageToStorage = async (reportId, imageId, mimeType, base64Data) => {
    const path = `reports/${reportId}/${imageId}`;
    const imageRef = ref(storage, path);
    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Network timeout: Firebase upload took too long.")), 15000)
    );
    await Promise.race([
        uploadString(imageRef, base64Data, 'base64', { contentType: mimeType }),
        timeoutPromise
    ]);
    return await getDownloadURL(imageRef);
};

const deleteReportImages = async (reportId) => {
    try {
        const folderRef = ref(storage, `reports/${reportId}`);
        const listResult = await listAll(folderRef);
        await Promise.all(listResult.items.map(itemRef => deleteObject(itemRef)));
    } catch (e) {
        console.warn("Storage deletion blocked or path invalid:", e.message);
    }
};

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
    const [currentView, setCurrentView] = useState('home'); 
    const [properties, setProperties] = useState([]);
    const [selectedPropertyId, setSelectedPropertyId] = useState(null);
    const [propertyReports, setPropertyReports] = useState([]);
    const [showAddProperty, setShowAddProperty] = useState(false);
    const [newPropertyAddress, setNewPropertyAddress] = useState('');
    const [showApiSettings, setShowApiSettings] = useState(false);
    
    // Legacy PDF Upload States
    const [showPdfUpload, setShowPdfUpload] = useState(false);
    const [pdfFile, setPdfFile] = useState(null);
    const [pdfMeta, setPdfMeta] = useState({ type: 'inventory', date: '', inspector: '', label: '' });

    // Tenant Response States
    const [showTenantComment, setShowTenantComment] = useState(false);
    const [tenantCommentReportId, setTenantCommentReportId] = useState(null);
    const [tenantCommentText, setTenantCommentText] = useState('');
    const [tenantCommentImages, setTenantCommentImages] = useState([]);
    const [tenantCommentName, setTenantCommentName] = useState('');

    const [activeApiKey, setActiveApiKey] = useState(getEnvKey());
    const [step, setStep] = useState(0);
    const [reportType, setReportType] = useState(null); 
    const [selectedReportId, setSelectedReportId] = useState(null);
    
    const [tenancyInfo, setTenancyInfo] = useState({
        roomIdentifier: '', tenantName: '', moveInDate: '', checkOutDate: '', dateOfInventory: '', clerkName: '', hasEnsuite: false, checkoutScope: 'room'
    });
    const [mainImages, setMainImages] = useState([]);   
    const [mainReport, setMainReport] = useState('');
    const [maintenanceMeta, setMaintenanceMeta] = useState({ date: '', clerkName: '' });
    
    const [multiRoomData, setMultiRoomData] = useState([]);
    const [uncategorisedImages, setUncategorisedImages] = useState([]);
    const [lightboxImage, setLightboxImage] = useState(null);
    const roomInputRefs = useRef({});

    const [fireSafetyData, setFireSafetyData] = useState({
        smoke: { tested: false, count: '', location: '' }, co: { tested: false, count: '', location: '' }, heat: { tested: false, count: '', location: '' }, emergency: { tested: false, count: '', location: '', duration: '' },
        hasFaults: false, faults: '', actionPlan: '', isResolved: false, resolvedDate: '', resolvedBy: '', signature: ''
    });

    const [isAnalysingMain, setIsAnalysingMain] = useState(false);
    const [isPolishingMain, setIsPolishingMain] = useState(false);
    const [loadingState, setLoadingState] = useState({ active: false, progress: 0, text: '' });
    const [isProcessing, setIsProcessing] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [pdfFallbackMsg, setPdfFallbackMsg] = useState('');
    const [logoSrc, setLogoSrc] = useState(LOGO_URL);

    const progressIntervalRef = useRef(null);
    const currentProperty = properties.find(p => p.id === selectedPropertyId);
    const isMultiRoom = reportType === 'maintenance' || (reportType === 'checkout' && tenancyInfo.checkoutScope === 'property');
    const selectedReportComments = (propertyReports.find(r => r.id === selectedReportId) || {data:{}}).data.tenantComments || [];

    useEffect(() => {
        if (multiRoomData.length === 0) setMultiRoomData([{ id: newId(), name: '', images: [], report: '' }]);
    }, [multiRoomData.length]);

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

    useEffect(() => {
        if (!window.history.state || window.history.state.view !== currentView || window.history.state.step !== step) {
            if (window.history.state && window.history.state.view === currentView) {
                window.history.replaceState({ view: currentView, step: step }, "");
            } else {
                window.history.pushState({ view: currentView, step: step }, "");
            }
        }
    }, [currentView, step]);

    useEffect(() => {
        const handlePopState = async (event) => {
            if (event.state) {
                const { view, step: targetStep } = event.state;
                if (currentView === 'wizard' && view === 'wizard') {
                    if (step > targetStep) setStep(targetStep);
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
  
    const handleModalBackdropClick = (e) => {
        if (e.target === e.currentTarget) {
            setShowApiSettings(false);
            setShowPdfUpload(false);
            setShowTenantComment(false);
        }
    };

    useEffect(() => {
        if (!showApiSettings && !lightboxImage && !showPdfUpload && !showTenantComment) return;
        const handleKey = (e) => { 
            if (e.key === 'Escape') {
                setShowApiSettings(false);
                setShowPdfUpload(false);
                setShowTenantComment(false);
                setLightboxImage(null);
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [showApiSettings, lightboxImage, showPdfUpload, showTenantComment]);

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

    const handleEditReport = () => {
        setStep(1);
        setCurrentView('wizard');
    };

    const handleUseAsTemplate = async (id) => {
        const report = await dbGetReport(id);
        setReportType(report.reportType);
        
        const data = JSON.parse(JSON.stringify(report.data));
        if (data.tenancyInfo) {
            data.tenancyInfo.dateOfInventory = '';
            data.tenancyInfo.checkOutDate = '';
        }
        if (data.maintenanceMeta) {
            data.maintenanceMeta.date = '';
        }
        if (data.fireSafetyData) {
            data.fireSafetyData.signature = '';
        }

        setTenancyInfo(data.tenancyInfo || {});
        setMainImages(data.mainImages || []);
        setMainReport(data.mainReport || '');
        setMaintenanceMeta(data.maintenanceMeta || { date: '', clerkName: '' });
        setMultiRoomData(data.multiRoomData || [{ id: newId(), name: '', images: [], report: '' }]);
        setUncategorisedImages([]);
        setFireSafetyData(data.fireSafetyData || {});
        
        setSelectedReportId(null);
        setStep(1);
        setCurrentView('wizard');
    };

    const handlePdfUploadSubmit = async () => {
        if (!pdfFile) return setErrorMsg("Please select a PDF file.");
        setIsProcessing(true);
        setErrorMsg('');
        const reportId = newId();

        try {
            setLoadingState({ active: true, progress: 20, text: 'Reading PDF file...' });
            await new Promise(resolve => setTimeout(resolve, 50));

            const reader = new FileReader();
            const dataUrl = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(pdfFile);
            });

            setLoadingState({ active: true, progress: 50, text: 'Uploading to cloud storage...' });
            
            const cleanFilename = pdfFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
            const pdfRef = ref(storage, `reports/${reportId}/${cleanFilename}`);
            
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Upload timeout: The file took too long to upload.")), 25000));
            await Promise.race([
                uploadString(pdfRef, dataUrl, 'data_url'),
                timeoutPromise
            ]);

            const url = await getDownloadURL(pdfRef);

            setLoadingState({ active: true, progress: 85, text: 'Saving to database...' });

            const reportData = {
                id: reportId,
                propertyId: selectedPropertyId,
                reportType: pdfMeta.type,
                reportDate: pdfMeta.date || new Date().toISOString(),
                inspectorName: pdfMeta.inspector,
                createdAt: new Date().toISOString(),
                isExternalPdf: true,
                data: {
                    pdfUrl: url,
                    label: pdfMeta.label
                }
            };

            await dbPut(STORE_REPORTS, reportData);
            
            setLoadingState({ active: true, progress: 100, text: 'Uploaded successfully!' });
            await new Promise(resolve => setTimeout(resolve, 800));
            
            setShowPdfUpload(false);
            setPdfFile(null);
            setPdfMeta({ type: 'inventory', date: '', inspector: '', label: '' });
            setLoadingState({ active: false, progress: 0, text: '' });
            
            const reports = await dbGetReportsByProperty(selectedPropertyId);
            setPropertyReports(reports.sort((a,b) => new Date(b.reportDate) - new Date(a.reportDate)));

        } catch (err) {
            console.error(err);
            setErrorMsg(`Upload failed: ${err.message}`);
            setLoadingState({ active: false, progress: 0, text: '' });
        } finally {
            setIsProcessing(false);
        }
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

        const reportId = selectedReportId || newId();

        try {
            setLoadingState({ active: true, progress: 5, text: 'Preparing to save...' });
            await new Promise(resolve => setTimeout(resolve, 50));

            const unuploadedMain = mainImages.filter(img => img.data).map(img => ({ target: 'main', img }));
            const unuploadedMulti = multiRoomData.flatMap(room => 
                room.images.filter(img => img.data).map(img => ({ target: 'multi', roomId: room.id, img }))
            );
            
            const allUploadTasks = [...unuploadedMain, ...unuploadedMulti];
            let processedCount = 0;
            const totalUploads = allUploadTasks.length;

            const uploadPromises = allUploadTasks.map(async (task) => {
                const { img, target, roomId } = task;
                try {
                    const url = await uploadImageToStorage(reportId, img.id, img.mimeType, img.data);
                    processedCount++;
                    setLoadingState(prev => ({ ...prev, text: `Uploading images (${processedCount}/${totalUploads})...`, progress: 5 + (processedCount / Math.max(1, totalUploads)) * 75 }));
                    return { ...task, url, success: true };
                } catch (e) {
                    console.error("Failed to upload image:", img.id, e);
                    processedCount++;
                    setLoadingState(prev => ({ ...prev, progress: 5 + (processedCount / Math.max(1, totalUploads)) * 75 }));
                    return { ...task, url: '', success: false };
                }
            });

            const resolvedUploads = await Promise.all(uploadPromises);

            const mainImagesUploaded = mainImages.map(img => {
                const uploaded = resolvedUploads.find(r => r.target === 'main' && r.img.id === img.id);
                return uploaded ? { ...img, data: '', url: uploaded.url } : img;
            });

            const multiRoomDataUploaded = multiRoomData.map(room => {
                const updatedImages = room.images.map(img => {
                    const uploaded = resolvedUploads.find(r => r.target === 'multi' && r.roomId === room.id && r.img.id === img.id);
                    return uploaded ? { ...img, data: '', url: uploaded.url } : img;
                });
                return { ...room, images: updatedImages };
            });

            setLoadingState({ active: true, progress: 85, text: 'Writing report to database...' });
          
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
            
            setLoadingState({ active: true, progress: 100, text: 'Saved successfully!' });
            await new Promise(resolve => setTimeout(resolve, 800));
            setLoadingState({ active: false, progress: 0, text: '' });
            await goPortfolio();
            
        } catch (err) {
            console.error("Full Save Error Context:", err);
            let userError = "Failed to save report. Please check your connection.";
            if (err.message?.includes("Missing or insufficient permissions")) {
                userError = "Permission Denied: Your Firebase Database security rules are blocking the save.";
            } else if (err.message) {
                userError = `Save Error: ${err.message}`;
            }
            setErrorMsg(userError);
            setLoadingState({ active: false, progress: 0, text: '' });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDeleteReport = async (id) => {
        if (window.confirm("Delete this report permanently?")) {
            try {
                await deleteReportImages(id);
                await dbDelete(STORE_REPORTS, id);
                const reports = await dbGetReportsByProperty(selectedPropertyId);
                setPropertyReports(reports.sort((a,b) => new Date(b.reportDate) - new Date(a.reportDate)));
            } catch (e) {
                alert(e.message);
            }
        }
    };

    const handleOpenTenantComment = (reportId) => {
        setTenantCommentReportId(reportId);
        setTenantCommentText('');
        setTenantCommentImages([]);
        setTenantCommentName('');
        setShowTenantComment(true);
    };

    const handleTenantCommentImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        const results = await Promise.all(files.map(f => compressImage(f)));
        setTenantCommentImages(prev => [...prev, ...results.filter(r => !r.failed)]);
        e.target.value = '';
    };

    const handleSaveTenantComment = async () => {
        if (!tenantCommentText.trim() && tenantCommentImages.length === 0) return;
        setIsProcessing(true);
        setErrorMsg('');
        try {
            setLoadingState({ active: true, progress: 20, text: 'Uploading tenant images...' });
            const uploadedImages = await Promise.all(
                tenantCommentImages.map(async (img) => {
                    if (img.data) {
                        const url = await uploadImageToStorage(tenantCommentReportId, `tenant_${img.id}`, img.mimeType, img.data);
                        return { id: img.id, url, mimeType: img.mimeType };
                    }
                    return img;
                })
            );
            setLoadingState({ active: true, progress: 70, text: 'Saving to report...' });
            const report = await dbGetReport(tenantCommentReportId);
            const newComment = {
                id: newId(),
                tenantName: tenantCommentName.trim() || 'Tenant',
                text: tenantCommentText.trim(),
                images: uploadedImages,
                submittedAt: new Date().toISOString(),
            };
            const updatedComments = [...(report.data.tenantComments || []), newComment];
            const updatedReport = { ...report, data: { ...report.data, tenantComments: updatedComments } };
            await dbPut(STORE_REPORTS, updatedReport);
            setLoadingState({ active: true, progress: 100, text: 'Saved!' });
            await new Promise(r => setTimeout(r, 700));
            setShowTenantComment(false);
            const reports = await dbGetReportsByProperty(selectedPropertyId);
            setPropertyReports(reports.sort((a, b) => new Date(b.reportDate) - new Date(a.reportDate)));
        } catch (err) {
            setErrorMsg(`Failed to save comment: ${err.message}`);
        } finally {
            setIsProcessing(false);
            setLoadingState({ active: false, progress: 0, text: '' });
        }
    };

    const handleResetWizard = () => {
        setReportType(null);
        setSelectedReportId(null);
        setMainReport('');
        setMainImages([]);
        setUncategorisedImages([]);
        setTenancyInfo({ roomIdentifier: '', tenantName: '', moveInDate: '', checkOutDate: '', dateOfInventory: '', clerkName: '', hasEnsuite: false, checkoutScope: 'room' });
        setMaintenanceMeta({ date: '', clerkName: '' });
        setMultiRoomData([{ id: newId(), name: '', images: [], report: '' }]);
        setFireSafetyData({ smoke: { tested: false, count: '', location: '' }, co: { tested: false, count: '', location: '' }, heat: { tested: false, count: '', location: '' }, emergency: { tested: false, count: '', location: '', duration: '' }, hasFaults: false, faults: '', actionPlan: '', isResolved: false, resolvedDate: '', resolvedBy: '', signature: '' });
        setErrorMsg('');
    };

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
        try { localStorage.setItem('arlington_gemini_api_key', newKey); } catch (error) { console.warn(error); }
    };

    const addMultiRoom = () => {
        const rId = newId();
        setMultiRoomData(prev => [...prev, { id: rId, name: '', images: [], report: '' }]);
        setTimeout(() => {
            if (roomInputRefs.current[rId]) roomInputRefs.current[rId].focus();
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
                setUncategorisedImages(existing => [...existing, ...roomToDelete.images]);
            }
            return prev.filter(r => r.id !== rId);
        });
    };
    const updateMultiRoomName = (rId, val) => setMultiRoomData(prev => prev.map(r => r.id === rId ? { ...r, name: val } : r));
    const handleMultiReportChange = (rId, text) => setMultiRoomData(prev => prev.map(r => r.id === rId ? { ...r, report: text } : r));

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
                    const scale = Math.min(1, 800 / Math.max(img.width, img.height));
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve({ 
                        id: newId(), 
                        mimeType: 'image/jpeg', 
                        data: canvas.toDataURL('image/jpeg', 0.6).split(',')[1], 
                        room: '' 
                    });
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

    const handleBulkImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        const results = await Promise.all(files.map(f => compressImage(f)));
        const successful = results.filter(r => !r.failed);
        setUncategorisedImages(prev => [...prev, ...successful]);
        e.target.value = '';
    };

    const removeUncategorisedImage = (imgId) => setUncategorisedImages(prev => prev.filter(img => img.id !== imgId));

    const handleRemoveMultiImage = (rId, imgId) => {
        setMultiRoomData(prev => prev.map(r => r.id === rId ? { ...r, images: r.images.filter(i => i.id !== imgId) } : r));
    };

    const assignImageToRoom = (imgId, targetRoomId) => {
        if (!targetRoomId) return;
        setUncategorisedImages(prev => {
            const imgToMove = prev.find(img => img.id === imgId);
            if (imgToMove) {
                setMultiRoomData(rooms => rooms.map(room => {
                    if (room.id === targetRoomId) return { ...room, images: [...room.images, imgToMove] };
                    return room;
                }));
            }
            return prev.filter(img => img.id !== imgId);
        });
    };

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
            if (imgToMove) setUncategorisedImages(prev => [...prev, imgToMove]);
            return updatedRooms;
        });
    };

    const handleDownloadPDFWrapper = () => {
        const sourceElement = document.getElementById('printable-report');
        if (!sourceElement || isProcessing) return;

        setIsProcessing(true);
        setErrorMsg('');
        setPdfFallbackMsg('');

        let isCompleted = false;

        const safetyUnlock = setTimeout(() => {
            if (!isCompleted) {
                isCompleted = true;
                setIsProcessing(false);
                setErrorMsg("PDF generation stalled. Check storage permissions and CORS settings. Falling back to native print.");
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

                let safeFilename = 'Report.pdf';
                // FIX: Escaped forward slashes inside the path exclusion regex arrays
                const propStr = currentProperty?.address ? currentProperty.address.slice(0, 20).replace(/[\/\\?%*:|"<>]/g, '_') : 'Property';

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
                    // FIX: Escaped forward slashes inside the path exclusion regex arrays
                    safeFilename = `${filePrefix}_${tName}_${rNum}_${mDate}`.replace(/[\/\\?%*:|"<>]/g, '_').trim() + '.pdf';
                }

                const opt = {
                    margin: 10,
                    filename: safeFilename,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { 
                        scale: 2, 
                        useCORS: true, 
                        letterRendering: true, 
                        logging: false,
                        windowWidth: sourceElement.scrollWidth,
                        windowHeight: sourceElement.scrollHeight 
                    },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                };

                await window.html2pdf().set(opt).from(sourceElement).save();

            } catch (err) {
                console.error("PDF generation failed:", err); 
                setErrorMsg("PDF generation failed. Check storage permissions and CORS settings. Falling back to print.");
                window.print();
            } finally {
                if (!isCompleted) {
                    isCompleted = true; 
                    clearTimeout(safetyUnlock); 
                    setIsProcessing(false);
                }
            }
        };
        run();
    };

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

    const strictConditionInstruction = "Do NOT state that an item is 'present' or 'exists'. The presence of the item is already confirmed by the photograph. Jump straight to describing the condition, quantities, and cleanliness. Pay extremely close attention to detail: explicitly identify, count, and note multiples of items and explicitly describe any defects found. Be professional. Use UK English.";

    const analyseStandardImages = async () => {
        if (!activeApiKey || activeApiKey === "STORAGE_ERROR") return setErrorMsg("Missing API Key. Check settings.");
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
        if (!activeApiKey || activeApiKey === "STORAGE_ERROR") return setErrorMsg("Missing API Key. Check settings.");
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
Format your response using clear bullet points referring to [Image X]. Be professional. Use UK English.`;
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
        if (!mainReport.trim() || !activeApiKey || activeApiKey === "STORAGE_ERROR") return;
        setIsPolishingMain(true);
        try {
            const constraint = "Strictly reporting objective conditions only. Never state that an item is 'present' or 'exists' as the photo confirms existence. Use UK English only.";
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
        if (!activeApiKey || activeApiKey === "STORAGE_ERROR") return setErrorMsg("Missing API Key.");
        setIsPolishingMain(true);
        setErrorMsg('');
        
        let updatedRooms = JSON.parse(JSON.stringify(multiRoomData));
        const tasks = updatedRooms.filter(r => r.report && r.report.trim() !== '');

        for (const task of tasks) {
            try {
                const constraint = "Strictly report the objective conditions. Do not state items are present or exist. Use UK English only.";
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

    const canProceedToStep2 = isMultiRoom 
        ? multiRoomData.length > 0 && multiRoomData.every(r => r.name.trim() !== '') && (reportType === 'checkout' ? tenancyInfo.tenantName.trim() !== '' : true)
        : reportType === 'fire_safety' 
        ? true 
        : tenancyInfo.tenantName.trim() !== '' && tenancyInfo.roomIdentifier.trim() !== '';

    const canProceedToStep3 = isMultiRoom
        ? multiRoomData.some(r => r.report.trim() !== '' || r.images.length > 0)
        : reportType === 'fire_safety'
        ? (fireSafetyData.signature && fireSafetyData.signature.trim() !== '')
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
                `}
            </style>

            {lightboxImage && (
                <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setLightboxImage(null)}>
                    <img 
                        src={lightboxImage.data ? `data:${lightboxImage.mimeType};base64,${lightboxImage.data}` : lightboxImage.url} 
                        className="max-h-[90vh] max-w-[90vw] object-contain rounded-xl shadow-2xl" 
                        alt="Enlarged view" 
                    />
                </div>
            )}

            <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden print:shadow-none print:w-full print:max-w-full">

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
                            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                                <button onClick={() => setShowPdfUpload(true)} className="bg-white border-2 border-[#2f314b] text-[#2f314b] px-6 py-3 rounded-lg font-bold shadow-sm hover:bg-gray-50 transition text-center">
                                    Upload Past PDF
                                </button>
                                <button onClick={handleStartNewReport} className="bg-[#2f314b] text-white px-6 py-3 rounded-lg font-bold shadow hover:bg-[#2f314b]/90 transition text-center">
                                    + Create New Report
                                </button>
                            </div>
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
                                                {report.isExternalPdf && <span className="ml-3 text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full align-middle font-bold">Legacy PDF</span>}
                                            </p>
                                            <p className="text-sm font-bold text-[#2f314b] mt-1 mb-1">
                                                {report.isExternalPdf 
                                                    ? (report.data.label || 'Legacy Upload')
                                                    : (report.reportType === 'inventory' || (report.reportType === 'checkout' && report.data.tenancyInfo?.checkoutScope === 'room') 
                                                        ? `Room Let: ${report.data.tenancyInfo?.roomIdentifier || 'N/A'} (${report.data.tenancyInfo?.tenantName || 'N/A'})` 
                                                        : 'Entire Property Scope')}
                                            </p>
                                            <p className="text-sm text-gray-600 mt-1">
                                                <span className="font-semibold text-gray-500">{formatOrdinalDate(report.reportDate)}</span> 
                                                <span className="mx-2 hidden sm:inline">|</span> 
                                                <span className="block sm:inline mt-1 sm:mt-0">Inspector: {report.inspectorName || 'Not specified'}</span>
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap gap-2 w-full sm:w-auto border-t sm:border-0 pt-3 sm:pt-0">
                                            {report.isExternalPdf ? (
                                                <a href={report.data.pdfUrl} target="_blank" rel="noopener noreferrer" className="flex-1 sm:flex-none text-[#2f314b] bg-[#2f314b]/10 px-4 py-2 rounded font-bold hover:bg-[#2f314b]/20 transition text-center flex items-center justify-center">
                                                    View PDF
                                                </a>
                                            ) : (
                                                <>
                                                    <button onClick={() => handleViewSavedReport(report.id)} className="flex-1 sm:flex-none text-[#2f314b] bg-[#2f314b]/10 px-4 py-2 rounded font-bold hover:bg-[#2f314b]/20 transition text-center">
                                                        View
                                                    </button>
                                                    <button onClick={() => handleUseAsTemplate(report.id)} className="flex-1 sm:flex-none text-blue-600 bg-blue-50 px-4 py-2 rounded font-bold hover:bg-blue-100 transition text-center">
                                                        Use as Template
                                                    </button>
                                                    <button onClick={() => handleOpenTenantComment(report.id)} className="flex-1 sm:flex-none text-amber-700 bg-amber-50 px-4 py-2 rounded font-bold hover:bg-amber-100 transition text-center">
                                                        + Tenant Response
                                                    </button>
                                                </>
                                            )}
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

                {(currentView === 'wizard' || currentView === 'view') && (
                    <>
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

                            {currentView === 'wizard' && step === 2 && (
                                <div className="space-y-8">
                                    {errorMsg && <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm border-2 border-red-200 font-bold">{errorMsg}</div>}

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

                                    {isMultiRoom && (
                                        <div className="space-y-6">
                                            
                                            <div className="bg-white border-2 border-gray-100 p-6 rounded-xl shadow-sm">
                                                <h3 className="text-xl font-bold text-gray-900 border-b-2 border-gray-200 pb-2 mb-4">Master Photo Upload</h3>
                                                <p className="text-sm text-gray-500 mb-4 font-medium">Upload all your photos here in bulk, then use the dropdown beneath each photo to allocate it to the correct room.</p>
                                                
                                                <div className="p-4 border-2 border-dashed border-[#2f314b]/30 rounded-xl bg-gray-50 mb-6 transition hover:bg-gray-100">
                                                    <input type="file" multiple accept="image/*" onChange={handleBulkImageUpload} className="block w-full text-sm text-gray-500 file:mr-6 file:py-3 file:px-6 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-[#2f314b] file:text-white hover:file:bg-[#2f314b]/90 cursor-pointer" />
                                                </div>

                                                <div className="min-h-[120px] bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-4 transition-colors">
                                                    <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Uncategorised Photos</h4>
                                                    {uncategorisedImages.length === 0 ? (
                                                        <p className="text-sm text-gray-400 font-medium flex items-center justify-center h-16">All photos are currently assigned to rooms.</p>
                                                    ) : (
                                                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
                                                            {uncategorisedImages.map((img) => (
                                                                <div key={img.id} className="relative group rounded-lg overflow-hidden border border-gray-300 shadow-sm flex flex-col bg-white">
                                                                    <img 
                                                                        src={img.data ? `data:${img.mimeType};base64,${img.data}` : img.url} 
                                                                        className="w-full h-24 object-cover cursor-zoom-in" 
                                                                        onClick={() => setLightboxImage(img)}
                                                                        alt="Uncategorised upload"
                                                                    />
                                                                    <button 
                                                                        onClick={() => removeUncategorisedImage(img.id)} 
                                                                        className="absolute top-1 right-1 bg-red-600/90 text-white text-[10px] px-2 py-1 rounded font-bold opacity-0 group-hover:opacity-100 transition shadow-sm"
                                                                    >
                                                                        Del
                                                                    </button>
                                                                    <select
                                                                        className="text-[10px] font-bold p-2 border-t border-gray-300 w-full focus:ring-[#2f314b] focus:outline-none bg-gray-50 hover:bg-gray-100 cursor-pointer text-gray-700"
                                                                        onChange={(e) => assignImageToRoom(img.id, e.target.value)}
                                                                        defaultValue=""
                                                                    >
                                                                        <option value="" disabled>Assign to...</option>
                                                                        {multiRoomData.map(r => (
                                                                            <option key={r.id} value={r.id}>{r.name || 'Unnamed Room'}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-4 gap-4 mt-8">
                                                <h3 className="text-xl font-bold text-gray-900 border-b-2 border-gray-200 pb-1">Room-by-Room Breakdown</h3>
                                                <button onClick={() => analyseMultiRoomImages()} disabled={isAnalysingMain} className="bg-[#2f314b] text-white px-8 py-3 rounded-xl font-bold shadow-md hover:bg-[#2f314b]/90 transition disabled:bg-gray-400 w-full sm:w-auto">
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
                                                        <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-6 border-b-2 border-gray-200 pb-3 gap-4">
                                                            <h5 className="font-bold text-gray-800 text-xl">{room.name || 'Unnamed Room'}</h5>
                                                            <div className="flex gap-2 w-full sm:w-auto">
                                                                <button
                                                                    onClick={() => handleMultiReportChange(room.id, reportType === 'maintenance' ? 'No maintenance required.' : 'No issues identified.')}
                                                                    className="text-xs bg-green-100 text-green-700 border border-green-300 px-4 py-2 rounded-lg font-bold hover:bg-green-200 transition shadow-sm flex-1 sm:flex-none text-center"
                                                                >
                                                                    No Issues
                                                                </button>
                                                                <button 
                                                                    onClick={() => analyseMultiRoomImages(room.id)} 
                                                                    disabled={isAnalysingMain || room.images.length === 0} 
                                                                    className="text-xs bg-[#2f314b] text-white px-4 py-2 rounded-lg font-bold hover:bg-[#2f314b]/90 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex-1 sm:flex-none text-center"
                                                                >
                                                                    Generate Report
                                                                </button>
                                                            </div>
                                                        </div>
                                                        
                                                        {room.images.length > 0 ? (
                                                            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4 mb-6">
                                                                {room.images.map((img, idx) => (
                                                                    <div key={img.id} className="relative group rounded-lg overflow-hidden border border-gray-300 shadow-sm flex flex-col bg-white">
                                                                        <img 
                                                                            src={img.data ? `data:${img.mimeType};base64,${img.data}` : img.url} 
                                                                            className="w-full h-24 object-cover cursor-zoom-in" 
                                                                            onClick={() => setLightboxImage(img)}
                                                                            alt={`Assigned to ${room.name}`}
                                                                        />
                                                                        
                                                                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-2 pointer-events-none z-10">
                                                                            <button 
                                                                                onClick={() => moveImageToUncategorised(room.id, img.id)} 
                                                                                className="bg-white/90 text-gray-800 text-[10px] px-3 py-1.5 rounded font-bold pointer-events-auto hover:bg-white shadow-sm"
                                                                            >
                                                                                Unassign
                                                                            </button>
                                                                            <button 
                                                                                onClick={() => handleRemoveMultiImage(room.id, img.id)} 
                                                                                className="bg-red-600/90 text-white text-[10px] px-3 py-1.5 rounded font-bold pointer-events-auto hover:bg-red-700 shadow-sm"
                                                                            >
                                                                                Delete
                                                                            </button>
                                                                        </div>
                                                                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[9px] font-bold uppercase text-center py-0.5 pointer-events-none z-0">
                                                                            Image {idx + 1}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <div className="min-h-[80px] border-2 border-dashed border-gray-300 bg-white rounded-xl mb-6 flex flex-col items-center justify-center text-center p-4">
                                                                <p className="text-sm font-bold text-gray-400">No photos allocated to this room yet.</p>
                                                                <p className="text-[11px] text-gray-400 font-medium mt-1">Use the dropdown menus in the Uncategorised section above.</p>
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

                                    {canProceedToStep3 && (
                                        <div className="mt-8 pt-6 border-t border-gray-200 flex justify-end print:hidden">
                                            <button onClick={() => setStep(3)} className="bg-[#2f314b] text-white px-8 py-3 rounded-xl font-bold shadow hover:bg-[#2f314b]/90 transition text-md">
                                                Proceed to Review & Sign-off →
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* --- STEP 3 & SAVED REPORT PRINT-VIEW CONTAINER --- */}
                            {(currentView === 'view' || step === 3) && (
                                <div className="space-y-6">
                                    <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-200 print:hidden">
                                        <button onClick={goPortfolio} className="font-bold text-gray-600 hover:text-black transition">
                                            ← Back to Portfolio
                                        </button>
                                        <div className="flex gap-3">
                                            {currentView === 'wizard' && (
                                                <button onClick={() => setStep(2)} className="bg-gray-200 text-gray-700 px-5 py-2 rounded-lg font-bold hover:bg-gray-300 transition">
                                                    ← Edit Content
                                                </button>
                                            )}
                                            <button onClick={handleDownloadPDFWrapper} disabled={isProcessing} className="bg-[#2f314b] text-white px-6 py-2 rounded-lg font-bold shadow hover:bg-[#2f314b]/90 transition">
                                                {isProcessing ? 'Generating PDF...' : 'Download PDF Report'}
                                            </button>
                                        </div>
                                    </div>

                                    <div id="printable-report" className="bg-white p-6 sm:p-10 border border-gray-200 rounded-xl shadow-sm space-y-8 text-sm">
                                        <div className="flex justify-between items-start border-b-4 border-[#2f314b] pb-6">
                                            <div>
                                                <h2 className="text-2xl font-black text-gray-900 tracking-wide uppercase">{formatType(reportType)} Report</h2>
                                                <p className="text-gray-600 font-semibold mt-1">{currentProperty?.address}</p>
                                                <p className="text-xs text-gray-500 mt-1">Generated on: {formatOrdinalDate(new Date().toISOString().split('T')[0])}</p>
                                            </div>
                                            <img src={logoSrc} alt="Arlington Park Logo" className="h-14 object-contain" />
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-200">
                                            {reportType === 'maintenance' ? (
                                                <>
                                                    <p><strong>Inspection Date:</strong> {formatOrdinalDate(maintenanceMeta.date)}</p>
                                                    <p><strong>Inspector Name:</strong> {maintenanceMeta.clerkName || 'Not specified'}</p>
                                                </>
                                            ) : (
                                                <>
                                                    {tenancyInfo.tenantName && <p><strong>Tenant Name:</strong> {tenancyInfo.tenantName}</p>}
                                                    {tenancyInfo.roomIdentifier && reportType !== 'fire_safety' && <p><strong>Room Identifier:</strong> {tenancyInfo.roomIdentifier}</p>}
                                                    {tenancyInfo.moveInDate && reportType === 'inventory' && <p><strong>Move-in Date:</strong> {formatOrdinalDate(tenancyInfo.moveInDate)}</p>}
                                                    {tenancyInfo.checkOutDate && reportType === 'checkout' && <p><strong>Check-out Date:</strong> {formatOrdinalDate(tenancyInfo.checkOutDate)}</p>}
                                                    <p><strong>Inspection Date:</strong> {formatOrdinalDate(tenancyInfo.dateOfInventory)}</p>
                                                    <p><strong>Inspector Name:</strong> {tenancyInfo.clerkName || 'Not specified'}</p>
                                                </>
                                            )}
                                        </div>

                                        {!isMultiRoom && reportType !== 'fire_safety' && (
                                            <div className="space-y-6">
                                                <div className="prose max-w-none bg-white p-4 border border-gray-200 rounded-lg shadow-inner">
                                                    <h4 className="font-bold text-gray-900 mb-2 uppercase tracking-wide border-b border-gray-100 pb-1">Condition Details</h4>
                                                    {renderReportText(mainReport)}
                                                </div>
                                                {mainImages.length > 0 && (
                                                    <div>
                                                        <h4 className="font-bold text-gray-900 mb-3 uppercase tracking-wide">Photographic Evidence</h4>
                                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                                            {mainImages.map((img, idx) => (
                                                                <div key={img.id} className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50 flex flex-col">
                                                                    <img src={img.url || `data:${img.mimeType};base64,${img.data}`} alt={`Evidence ${idx + 1}`} className="w-full h-40 object-cover" />
                                                                    <div className="p-2 text-center text-xs bg-gray-100 font-bold border-t border-gray-200">
                                                                        Image {idx + 1} {img.room ? `- ${img.room}` : ''}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {isMultiRoom && (
                                            <div className="space-y-6">
                                                {multiRoomData.map((room, rIdx) => {
                                                    if (!room.report && room.images.length === 0) return null;
                                                    return (
                                                        <div key={room.id} className="border border-gray-200 rounded-xl p-4 bg-white space-y-4 break-inside-avoid">
                                                            <h4 className="font-black text-gray-900 text-base uppercase tracking-wide border-b border-gray-200 pb-1">
                                                                {rIdx + 1}. {room.name || 'Unnamed Room'}
                                                            </h4>
                                                            {room.report && (
                                                                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                                                    {renderReportText(room.report)}
                                                                </div>
                                                            )}
                                                            {room.images.length > 0 && (
                                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                                                    {room.images.map((img, iIdx) => (
                                                                        <div key={img.id} className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                                                                            <img src={img.url || `data:${img.mimeType};base64,${img.data}`} alt={`${room.name} evidence ${iIdx + 1}`} className="w-full h-28 object-cover" />
                                                                            <div className="p-1.5 text-center text-[10px] bg-gray-100 font-semibold border-t border-gray-200">
                                                                                Image {iIdx + 1}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {reportType === 'fire_safety' && (
                                            <div className="space-y-6">
                                                <div>
                                                    <h4 className="font-bold text-gray-900 mb-3 uppercase tracking-wide">Testing Matrices</h4>
                                                    <table className="w-full text-left border-collapse border border-gray-200">
                                                        <thead>
                                                            <tr className="bg-gray-100 border-b border-gray-200 text-xs font-bold uppercase text-gray-700">
                                                                <th className="p-2">Equipment</th>
                                                                <th className="p-2 text-center">Status</th>
                                                                <th className="p-2 text-center">Qty</th>
                                                                <th className="p-2">Location(s)</th>
                                                                <th className="p-2">Duration</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            <AlarmRow title="Smoke Detectors" config={fireSafetyData.smoke} />
                                                            <AlarmRow title="CO Alarms" config={fireSafetyData.co} />
                                                            <AlarmRow title="Heat Detectors" config={fireSafetyData.heat} />
                                                            <AlarmRow title="Emergency Lighting" config={fireSafetyData.emergency} />
                                                        </tbody>
                                                    </table>
                                                </div>

                                                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-3">
                                                    <p><strong>Faults Flagged:</strong> {fireSafetyData.hasFaults ? 'YES' : 'NO'}</p>
                                                    {fireSafetyData.hasFaults && (
                                                        <>
                                                            <p><strong>Defect Specs:</strong> {fireSafetyData.faults}</p>
                                                            <p><strong>Action Targets:</strong> {fireSafetyData.actionPlan}</p>
                                                            <p><strong>Resolution:</strong> {fireSafetyData.isResolved ? `COMPLETED on ${formatOrdinalDateTime(fireSafetyData.resolvedDate)} by ${fireSafetyData.resolvedBy}` : 'OUTSTANDING'}</p>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex justify-end pt-4 border-t border-gray-100 break-inside-avoid">
                                            <div className="w-64 border border-gray-300 rounded-xl p-4 bg-gray-50 text-center shadow-sm">
                                                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest border-b border-gray-200 pb-1.5 mb-3">Authorized Sign-off</p>
                                                <div className="h-16 flex items-center justify-center mb-3 bg-white rounded border border-gray-200">
                                                    {fireSafetyData.signature ? (
                                                        <img src={fireSafetyData.signature} className="max-h-full max-w-full mix-blend-multiply" alt="Authorized Signature" />
                                                    ) : (
                                                        <span className="text-gray-400 italic text-[10px] font-medium">No signature captured</span>
                                                    )}
                                                </div>
                                                <p className="font-black text-sm uppercase tracking-wide text-[#2f314b]">{tenancyInfo.clerkName || maintenanceMeta.clerkName || 'Inspector'}</p>
                                            </div>
                                        </div>

                                        {/* --- TENANT COMMENTARY PRINT AREA --- */}
                                        {selectedReportComments.length > 0 && (
                                            <div className="mt-8 border-t-2 border-amber-300 pt-6 break-inside-avoid">
                                                <h4 className="text-sm font-black text-amber-800 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                                                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                                                    Appendice: Tenant Responses
                                                </h4>
                                                <div className="space-y-4">
                                                    {selectedReportComments.map((comment) => (
                                                        <div key={comment.id} className="bg-amber-50/60 border border-amber-200 rounded-xl p-4 space-y-3">
                                                            <div className="flex justify-between items-center border-b border-amber-100 pb-1.5">
                                                                <span className="font-bold text-amber-900 text-xs uppercase tracking-wide">{comment.tenantName}</span>
                                                                <span className="text-[10px] text-amber-700 font-semibold">{formatOrdinalDateTime(comment.submittedAt)}</span>
                                                            </div>
                                                            {comment.text && <p className="text-xs text-gray-800 leading-relaxed whitespace-pre-line">{comment.text}</p>}
                                                            {comment.images && comment.images.length > 0 && (
                                                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                                                    {comment.images.map((img) => (
                                                                        <img key={img.id} src={img.url} alt="Tenant attachment" className="w-full h-20 object-cover rounded-lg border border-amber-200" />
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {currentView === 'wizard' && (
                                        <div className="flex justify-end gap-3 print:hidden pt-4">
                                            <button onClick={() => setStep(2)} className="px-6 py-3 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition">
                                                ← Back to Forms
                                            </button>
                                            <button onClick={handleSaveReportToPortfolio} disabled={isProcessing} className="px-8 py-3 font-bold bg-green-600 text-white rounded-xl hover:bg-green-700 transition shadow-md">
                                                {isProcessing ? 'Saving...' : 'Confirm & Save Report'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                        </div>
                    </div>
                ) : null}

            </div>

            {/* --- LEGACY PDF UPLOAD MODAL --- */}
            {showPdfUpload && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 print:hidden p-4 transition-opacity" onClick={handleModalBackdropClick}>
                    <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full border border-gray-200 animate-in zoom-in-95">
                        <h3 className="text-xl font-black text-gray-900 mb-6 border-b-2 border-gray-100 pb-2">Upload Past PDF Report</h3>
                        
                        <div className="space-y-4 mb-8">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Select PDF File <span className="text-red-500">*</span></label>
                                <input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files[0])} className="w-full text-sm font-medium border border-gray-300 rounded-lg p-2 focus:ring-[#2f314b] file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-xs file:font-bold file:bg-[#2f314b] file:text-white" />
                            </div>
                            
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Report Type <span className="text-red-500">*</span></label>
                                <select value={pdfMeta.type} onChange={(e) => setPdfMeta({...pdfMeta, type: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg font-medium text-sm focus:ring-[#2f314b]">
                                    <option value="inventory">Initial Condition / Inventory</option>
                                    <option value="checkout">Check-Out Report</option>
                                    <option value="maintenance">Maintenance Schedule</option>
                                    <option value="fire_safety">Fire Safety Check</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Report Description/Label</label>
                                <input type="text" placeholder="e.g. Room 1 (John Doe) or Full Property" value={pdfMeta.label} onChange={(e) => setPdfMeta({...pdfMeta, label: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg font-medium text-sm focus:ring-[#2f314b]" />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">Report Date</label>
                                    <input type="date" value={pdfMeta.date} onChange={(e) => setPdfMeta({...pdfMeta, date: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg font-medium text-sm focus:ring-[#2f314b]" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">Inspector</label>
                                    <input type="text" value={pdfMeta.inspector} onChange={(e) => setPdfMeta({...pdfMeta, inspector: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg font-medium text-sm focus:ring-[#2f314b]" />
                                </div>
                            </div>
                        </div>

                        {loadingState.active ? (
                             <div className="mb-6 animate-in fade-in">
                                 <div className="flex justify-between text-sm text-[#2f314b] font-bold mb-3 uppercase tracking-wider">
                                     <span>{loadingState.text}</span><span>{Math.round(loadingState.progress)}%</span>
                                 </div>
                                 <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                                     <div className="bg-[#2f314b] h-3 rounded-full transition-all duration-300" style={{ width: `${loadingState.progress}%` }}></div>
                                 </div>
                             </div>
                        ) : null}

                        {errorMsg && (
                            <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm border-2 border-red-200 mb-6 font-bold">{errorMsg}</div>
                        )}

                        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                            <button onClick={() => setShowPdfUpload(false)} disabled={isProcessing} className="px-6 py-3 font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition disabled:opacity-50">Cancel</button>
                            <button onClick={handlePdfUploadSubmit} disabled={isProcessing} className="px-6 py-3 font-bold bg-[#2f314b] text-white rounded-xl hover:bg-[#2f314b]/90 transition shadow-md disabled:opacity-50">Upload & Save</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- TENANT COMMENT MODAL --- */}
            {showTenantComment && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 print:hidden p-4 transition-opacity" onClick={handleModalBackdropClick}>
                    <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-lg w-full border border-gray-200 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
                        <h3 className="text-xl font-black text-gray-900 mb-1 border-b-2 border-amber-100 pb-3">Add Tenant Response</h3>
                        <p className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-6">This will be appended to the saved report</p>

                        <div className="space-y-4 mb-6">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Tenant Name</label>
                                <input
                                    type="text"
                                    placeholder="e.g. John Smith"
                                    value={tenantCommentName}
                                    onChange={(e) => setTenantCommentName(e.target.value)}
                                    className="w-full p-3 border border-gray-300 rounded-lg font-medium text-sm focus:ring-amber-400 focus:border-amber-400"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Comment / Dispute</label>
                                <textarea
                                    rows="5"
                                    placeholder="Tenant's comments, disputes, or observations about the report..."
                                    value={tenantCommentText}
                                    onChange={(e) => setTenantCommentText(e.target.value)}
                                    className="w-full p-3 border border-gray-300 rounded-lg font-medium text-sm focus:ring-amber-400 focus:border-amber-400 resize-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Supporting Photos (optional)</label>
                                <input
                                    type="file"
                                    multiple
                                    accept="image/*"
                                    onChange={handleTenantCommentImageUpload}
                                    className="w-full text-sm font-medium border border-gray-300 rounded-lg p-2 focus:ring-amber-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-xs file:font-bold file:bg-amber-600 file:text-white"
                                />
                                {tenantCommentImages.length > 0 && (
                                    <div className="grid grid-cols-3 gap-2 mt-3">
                                        {tenantCommentImages.map((img, idx) => (
                                            <div key={img.id} className="relative group rounded-lg overflow-hidden border border-gray-200">
                                                <img
                                                    src={img.data ? `data:${img.mimeType};base64,${img.data}` : img.url}
                                                    alt={`Tenant photo ${idx + 1}`}
                                                    className="w-full h-20 object-cover"
                                                />
                                                <button
                                                    onClick={() => setTenantCommentImages(prev => prev.filter(i => i.id !== img.id))}
                                                    className="absolute top-1 right-1 bg-red-600 text-white text-[10px] font-bold rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition"
                                                >✕</button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {loadingState.active && (
                            <div className="mb-4 animate-in fade-in">
                                <div className="flex justify-between text-sm text-amber-700 font-bold mb-2 uppercase tracking-wider">
                                    <span>{loadingState.text}</span><span>{Math.round(loadingState.progress)}%</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                                    <div className="bg-amber-500 h-2.5 rounded-full transition-all duration-300" style={{ width: `${loadingState.progress}%` }}></div>
                                </div>
                            </div>
                        )}

                        {errorMsg && (
                            <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm border-2 border-red-200 mb-4 font-bold">{errorMsg}</div>
                        )}

                        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                            <button onClick={() => setShowTenantComment(false)} disabled={isProcessing} className="px-6 py-3 font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition disabled:opacity-50">Cancel</button>
                            <button
                                onClick={handleSaveTenantComment}
                                disabled={isProcessing || (!tenantCommentText.trim() && tenantCommentImages.length === 0)}
                                className="px-6 py-3 font-bold bg-amber-600 text-white rounded-xl hover:bg-amber-700 transition shadow-md disabled:opacity-50"
                            >
                                Save Response
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
                            <p className="text-[11px] font-bold text-blue-800 uppercase tracking-wide mb-1">Cloud Storage Active</p>
                            <p className="text-[11px] font-medium text-blue-600 leading-relaxed">Your API key is saved to your browser's local storage. Property reports and data are saved securely to your Firebase Firestore database.</p>
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