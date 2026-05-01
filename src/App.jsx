import React, { useState, useRef, useEffect, useCallback } from 'react';

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
        'gemini-2.0-flash',
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

// Stable ordinal date formatter
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

const LOGO_URL = "https://i.ibb.co/N6Z7PwWc/Arlington-large-20251119-124957-0000.jpg";

// Stable ID generator for images
let _imgIdCounter = 0;
const newImgId = () => `img-${++_imgIdCounter}`;

export default function App() {
    const [step, setStep] = useState(1);
    const [showApiSettings, setShowApiSettings] = useState(false);
    const [activeApiKey, setActiveApiKey] = useState(getEnvKey());
    const [tenancyInfo, setTenancyInfo] = useState({
        propertyAddress: '', roomIdentifier: '', tenantName: '', moveInDate: '', dateOfInventory: '', clerkName: ''
    });
    const [mainImages, setMainImages] = useState([]);   // [{ id, mimeType, data }]
    const [mainReport, setMainReport] = useState('');
    const [isAnalysingMain, setIsAnalysingMain] = useState(false);
    const [isPolishingMain, setIsPolishingMain] = useState(false);
    const [loadingState, setLoadingState] = useState({ active: false, progress: 0, text: '' });
    const [isProcessing, setIsProcessing] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [pdfFallbackMsg, setPdfFallbackMsg] = useState('');
    const [logoSrc, setLogoSrc] = useState(LOGO_URL);

    const progressIntervalRef = useRef(null);

    // Cleanup interval on unmount
    useEffect(() => {
        return () => {
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        };
    }, []);

    // Load PDF engine
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

    // Pre-load logo as Base64 with graceful fallback
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
            } catch (e) {
                console.warn("Logo canvas conversion blocked by CORS; using URL fallback.", e);
            }
        };
        img.onerror = () => console.warn("Logo failed to load from remote URL.");
        img.src = LOGO_URL;
    }, []);

    // Close API settings modal on Escape key
    useEffect(() => {
        if (!showApiSettings) return;
        const handleKey = (e) => { if (e.key === 'Escape') setShowApiSettings(false); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [showApiSettings]);

    const handleTenancyChange = (e) => {
        const { name, value } = e.target;
        setTenancyInfo(prev => ({ ...prev, [name]: value }));
    };

    const handleApiChange = (e) => {
        const newKey = e.target.value;
        setActiveApiKey(newKey);
        try {
            localStorage.setItem('arlington_gemini_api_key', newKey);
        } catch (e) {
            console.warn("Could not save API key to localStorage:", e);
        }
    };

    const handleDownloadPDF = () => {
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
                if (sandboxRef && document.body.contains(sandboxRef)) {
                    document.body.removeChild(sandboxRef);
                }
                window.print();
            }
        }, 15000);

        const run = async () => {
            try {
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

                if (!window.html2pdf) {
                    isCompleted = true;
                    clearTimeout(safetyUnlock);
                    setPdfFallbackMsg("PDF library not loaded, using native print instead.");
                    window.print();
                    return;
                }

                sandboxRef = document.createElement('div');
                sandboxRef.style.position = 'fixed';
                sandboxRef.style.left = '-9999px';
                sandboxRef.style.top = '0';
                // Strict pixel width ensures text scales down proportionally without getting inflated
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

                const tName = tenancyInfo.tenantName?.trim() || 'Tenant';
                const rNum = tenancyInfo.roomIdentifier?.trim() || 'Room';
                const mDate = tenancyInfo.moveInDate || 'NoDate';
                const safeFilename = `${tName} ${rNum} ${mDate}`.replace(/[/\\?%*:|"<>]/g, '-').trim() + '.pdf';

                const opt = {
                    margin: 10,
                    filename: safeFilename,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { scale: 2, useCORS: true, letterRendering: true, logging: false, imageTimeout: 8000 },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                    pagebreak: { mode: ['css', 'legacy'], avoid: ['.break-inside-avoid'] }
                };

                await window.html2pdf().set(opt).from(clone).save();

                if (!isCompleted) {
                    isCompleted = true;
                    clearTimeout(safetyUnlock);
                    setIsProcessing(false);
                    if (sandboxRef && document.body.contains(sandboxRef)) {
                        document.body.removeChild(sandboxRef);
                    }
                }
            } catch (err) {
                if (!isCompleted) {
                    isCompleted = true;
                    clearTimeout(safetyUnlock);
                    setIsProcessing(false);
                    console.error("PDF generation failed:", err);
                    setErrorMsg("PDF generation failed. Falling back to native print.");
                    if (sandboxRef && document.body.contains(sandboxRef)) document.body.removeChild(sandboxRef);
                    window.print();
                }
            }
        };

        run();
    };

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
                    resolve({ id: newImgId(), mimeType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.8).split(',')[1] });
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

        if (failed.length > 0) {
            setErrorMsg(`The following file(s) could not be read and were skipped: ${failed.map(f => f.name).join(', ')}`);
        } else {
            setErrorMsg('');
        }

        setMainImages(prev => [...prev, ...successful]);
        e.target.value = '';
    };

    const handleRemoveImage = useCallback((idToRemove) => {
        setMainImages(prev => prev.filter(img => img.id !== idToRemove));
    }, []);

    const analyseImages = async () => {
        if (!activeApiKey) {
            setErrorMsg("Missing API Key. Please provide one via API Settings.");
            return;
        }
        if (mainImages.length === 0) {
            setErrorMsg("Please provide at least one image.");
            return;
        }

        setIsAnalysingMain(true);
        setErrorMsg('');
        setLoadingState({ active: true, progress: 5, text: 'Preparing images...' });

        progressIntervalRef.current = setInterval(() => {
            setLoadingState(prev => {
                if (!prev.active) return prev;
                let newProgress = Math.min(95, prev.progress + Math.random() * 8 + 2);
                let newText = 'Preparing images...';
                if (newProgress > 25) newText = 'Uploading securely...';
                if (newProgress > 50) newText = 'AI is inspecting the images...';
                if (newProgress > 80) newText = 'Formatting detailed report...';
                return { ...prev, progress: newProgress, text: newText };
            });
        }, 800);

        try {
            const imageParts = mainImages.map(img => ({
                inlineData: { mimeType: img.mimeType, data: img.data }
            }));
            const roomName = (tenancyInfo.roomIdentifier || 'tenant room').replace(/[<>"'`]/g, '').slice(0, 100);

            const formatConstraint = `
Output the report EXACTLY in this format using bolding for headings. 
When describing specific issues or items, refer to the corresponding image using "[Image X]" (e.g., [Image 1], [Image 2]).

**1. General Overview**
• **Cleanliness:** [assessment]
• **Decor:** [assessment]
• **Flooring:** [assessment]

**2. Detailed Item Condition**
${roomName}
• **[Item name]:** [Description] [Image X]
Condition: [Condition]
`;
            const promptText = `Analyse the images of ${roomName} in an HMO. ${formatConstraint} 
            Distinguish surface stains from structural damage (holes, burns). Be highly thorough in your analysis. Pay extremely close attention to detail: explicitly identify, count, and note multiples of items (e.g., all light fittings, all plug sockets) and explicitly describe any minor defects found, such as cracks in mirrors, marks, or scuffs. DO NOT suggest any improvements, recommendations, repairs, or fixes required under any circumstances; only strictly state the objective current condition. Be professional. Use UK English. Do not use em dashes.`;

            const payload = {
                contents: [{ role: "user", parts: [{ text: promptText }, ...imageParts] }]
            };

            const data = await callGeminiWithFallback(payload, activeApiKey);
            const aiDescription = data.candidates?.[0]?.content?.parts?.[0]?.text || "Analysis failed to return text.";
            setMainReport(aiDescription);

            setLoadingState(prev => ({ ...prev, progress: 100, text: 'Complete!' }));
            setTimeout(() => setLoadingState({ active: false, progress: 0, text: '' }), 1500);

        } catch (error) {
            console.error("API Error:", error);
            setErrorMsg(`Analysis failed: ${error.message}`);
            setLoadingState({ active: false, progress: 0, text: '' });
        } finally {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
            setIsAnalysingMain(false);
        }
    };

    const polishText = async () => {
        if (!mainReport.trim() || !activeApiKey) return;
        setIsPolishingMain(true);
        try {
            const promptText = `Rewrite the following notes to sound highly professional and completely objective. Maintain exact formatting, bolding, and image references like [Image X]. Ensure the tone strictly reports condition and DOES NOT suggest any improvements, recommendations, or repairs required. Use UK English only. Do not use em dashes: \n\n${mainReport}`;
            const payload = { contents: [{ role: "user", parts: [{ text: promptText }] }] };
            const data = await callGeminiWithFallback(payload, activeApiKey);
            setMainReport(data.candidates?.[0]?.content?.parts?.[0]?.text || mainReport);
        } catch (error) {
            setErrorMsg(`Failed to polish text: ${error.message}`);
        } finally {
            setIsPolishingMain(false);
        }
    };

    const renderReportText = (text) => {
        if (!text) return null;
        return text.split('\n').map((line, i) => {
            const segments = [];
            let lastIndex = 0;
            const boldRegex = /\*\*(.*?)\*\*/g;
            let match;
            while ((match = boldRegex.exec(line)) !== null) {
                if (match.index > lastIndex) {
                    segments.push(<span key={`t-${lastIndex}`}>{line.slice(lastIndex, match.index)}</span>);
                }
                segments.push(<strong key={`b-${match.index}`} className="font-semibold">{match[1]}</strong>);
                lastIndex = boldRegex.lastIndex;
            }
            if (lastIndex < line.length) {
                segments.push(<span key={`t-${lastIndex}`}>{line.slice(lastIndex)}</span>);
            }
            return (
                <p key={i} className={`text-[12px] text-gray-800 leading-[1.6] ${line.trim() === '' ? 'h-2' : 'mt-1.5'}`}>
                    {segments.length > 0 ? segments : line}
                </p>
            );
        });
    };

    const canProceedToStep2 = tenancyInfo.propertyAddress.trim() !== '' && tenancyInfo.tenantName.trim() !== '';
    const canProceedToStep3 = mainReport.trim() !== '';

    const handleStepClick = (targetStep) => {
        if (targetStep <= step) { setStep(targetStep); return; }
        if (targetStep === 2 && canProceedToStep2) { setStep(2); return; }
        if (targetStep === 3 && canProceedToStep3) { setStep(3); return; }
    };

    const handleModalBackdropClick = (e) => {
        if (e.target === e.currentTarget) setShowApiSettings(false);
    };

    return (
        <div className="min-h-screen bg-gray-100 text-gray-800 p-4 sm:p-8 print:p-0 print:bg-white font-sans">
            <style>
                {`
                @media print {
                    body * { visibility: hidden; }
                    #printable-report, #printable-report * { visibility: visible; }
                    #printable-report { 
                        position: absolute; left: 0; top: 0; width: 100%; 
                        padding: 0; margin: 0; box-shadow: none;
                    }
                    .html2pdf__page-break { page-break-before: always; }
                }
                #printable-report {
                    --color-gray-900: #111827 !important;
                    --color-gray-800: #1f2937 !important;
                    --color-gray-700: #374151 !important;
                    --color-gray-500: #6b7280 !important;
                    --color-gray-200: #e5e7eb !important;
                    --color-white: #ffffff !important;
                }
                `}
            </style>

            <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden print:shadow-none">

                <div className="bg-[#2f314b] text-white p-4 sm:p-6 print:hidden flex items-center gap-4">
                    <img src={logoSrc} alt="Arlington Park Logo" crossOrigin="anonymous" className="h-10 sm:h-12 object-contain" />
                    <h1 className="text-xl sm:text-2xl font-bold">Arlington Park Inventory</h1>
                </div>

                <div className="flex border-b border-gray-200 print:hidden">
                    {[1, 2, 3].map(s => (
                        <button
                            key={s}
                            onClick={() => handleStepClick(s)}
                            disabled={
                                (s === 2 && !canProceedToStep2 && step < 2) ||
                                (s === 3 && !canProceedToStep3 && step < 3)
                            }
                            className={`flex-1 py-4 text-center font-medium transition ${step === s ? 'border-b-2 border-[#2f314b] text-[#2f314b]' : 'text-gray-500 hover:bg-gray-50'} disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                            {s === 1 ? '1. Details' : s === 2 ? '2. Analysis' : '3. Review'}
                        </button>
                    ))}
                </div>

                <div className="p-6 sm:p-8">

                    {/* ── STEP 1 ── */}
                    {step === 1 && (
                        <div className="space-y-6">
                            <h2 className="text-xl font-semibold text-gray-800 mb-4">Tenancy Information</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-6">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Property Address</label>
                                        <textarea
                                            name="propertyAddress"
                                            value={tenancyInfo.propertyAddress}
                                            onChange={handleTenancyChange}
                                            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#2f314b] focus:border-[#2f314b]"
                                            rows="2"
                                            placeholder="e.g. 123 High Street, Norwich"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Room Number / Name</label>
                                        <input
                                            type="text"
                                            name="roomIdentifier"
                                            value={tenancyInfo.roomIdentifier}
                                            onChange={handleTenancyChange}
                                            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#2f314b] focus:border-[#2f314b]"
                                            placeholder="e.g. Room 1"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Tenant Name(s)</label>
                                        <input
                                            type="text"
                                            name="tenantName"
                                            value={tenancyInfo.tenantName}
                                            onChange={handleTenancyChange}
                                            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#2f314b] focus:border-[#2f314b]"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-6">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Move-in Date</label>
                                        <input type="date" name="moveInDate" value={tenancyInfo.moveInDate} onChange={handleTenancyChange} className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#2f314b] focus:border-[#2f314b]" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Inspection Date</label>
                                        <input type="date" name="dateOfInventory" value={tenancyInfo.dateOfInventory} onChange={handleTenancyChange} className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#2f314b] focus:border-[#2f314b]" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Inspected By (Agent Name)</label>
                                        <input type="text" name="clerkName" value={tenancyInfo.clerkName} onChange={handleTenancyChange} className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#2f314b] focus:border-[#2f314b]" />
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => setStep(2)}
                                disabled={!canProceedToStep2}
                                className="bg-[#2f314b] text-white px-8 py-3 rounded-md font-medium mt-4 shadow hover:bg-[#2f314b]/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Next
                            </button>
                            {!canProceedToStep2 && (
                                <p className="text-xs text-gray-400 mt-1">Enter both a property address and tenant name to continue.</p>
                            )}
                        </div>
                    )}

                    {/* ── STEP 2 ── */}
                    {step === 2 && (
                        <div className="space-y-8">
                            {errorMsg && <div className="p-4 bg-red-50 text-red-700 rounded-md text-sm border border-red-200">{errorMsg}</div>}

                            <div className="bg-white border border-gray-200 p-6 rounded-lg shadow-sm">
                                <h3 className="text-lg font-semibold text-gray-900 mb-4">Room Photos</h3>
                                <div className="p-4 border-2 border-dashed border-[#2f314b]/30 rounded-lg bg-[#2f314b]/5 mb-4">
                                    <input
                                        type="file"
                                        multiple
                                        accept="image/*"
                                        onChange={handleImageUpload}
                                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-[#2f314b] file:text-white cursor-pointer"
                                    />
                                    {mainImages.length > 0 && (
                                        <p className="text-xs text-green-600 mt-2 font-medium">{mainImages.length} image{mainImages.length !== 1 ? 's' : ''} loaded.</p>
                                    )}
                                </div>

                                {mainImages.length > 0 && (
                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-4">
                                        {mainImages.map((img, idx) => (
                                            <div key={img.id} className="relative group rounded overflow-hidden border border-gray-200">
                                                <img
                                                    src={`data:${img.mimeType};base64,${img.data}`}
                                                    alt={`Upload ${idx + 1}`}
                                                    className="w-full h-20 object-cover"
                                                />
                                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
                                                    <button
                                                        onClick={() => handleRemoveImage(img.id)}
                                                        className="opacity-0 group-hover:opacity-100 transition bg-red-600 text-white text-xs rounded px-2 py-1 font-medium"
                                                        title="Remove image"
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                                <p className="text-[10px] text-center text-gray-500 py-0.5 bg-gray-50">Image {idx + 1}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <button onClick={analyseImages} disabled={isAnalysingMain || mainImages.length === 0} className="w-full py-3 bg-[#2f314b] text-white rounded-md font-bold disabled:bg-gray-300 transition">
                                    {isAnalysingMain ? 'Analysing via AI...' : 'Generate Report'}
                                </button>

                                {loadingState.active && (
                                    <div className="mt-4 bg-[#2f314b]/5 p-4 rounded-lg border border-[#2f314b]/10">
                                        <div className="flex justify-between text-xs text-[#2f314b] font-bold mb-2 uppercase tracking-wide">
                                            <span>{loadingState.text}</span>
                                            <span>{Math.round(loadingState.progress)}%</span>
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                                            <div className="bg-[#2f314b] h-2.5 rounded-full transition-all duration-300" style={{ width: `${loadingState.progress}%` }}></div>
                                        </div>
                                    </div>
                                )}

                                {mainReport && (
                                    <div className="mt-6">
                                        <div className="flex justify-between mb-2">
                                            <label className="text-sm font-bold text-gray-700">Review & Edit:</label>
                                            <button onClick={polishText} disabled={isPolishingMain} className="text-xs bg-[#2f314b]/10 text-[#2f314b] px-3 py-1 rounded hover:bg-[#2f314b]/20">
                                                {isPolishingMain ? 'Polishing...' : '✨ Polish Text'}
                                            </button>
                                        </div>
                                        <textarea
                                            value={mainReport}
                                            onChange={(e) => setMainReport(e.target.value)}
                                            className="w-full p-4 border rounded-md h-64 font-mono text-sm bg-gray-50 focus:ring-[#2f314b]"
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-between">
                                <button onClick={() => setStep(1)} className="text-gray-600 px-6 py-2 border rounded hover:bg-gray-50">Back</button>
                                <button
                                    onClick={() => setStep(3)}
                                    disabled={!canProceedToStep3}
                                    className="bg-[#2f314b] text-white px-8 py-3 rounded-md font-bold shadow hover:bg-[#2f314b]/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Final Review
                                </button>
                            </div>
                            {!canProceedToStep3 && (
                                <p className="text-xs text-gray-400 text-right -mt-4">Generate a report first to proceed to review.</p>
                            )}
                        </div>
                    )}

                    {/* ── STEP 3 ── */}
                    {step === 3 && (
                        <div className="space-y-6">
                            {pdfFallbackMsg && (
                                <div className="p-3 bg-amber-50 text-amber-700 rounded-md text-sm border border-amber-200 print:hidden">{pdfFallbackMsg}</div>
                            )}

                            <div className="flex justify-between print:hidden mb-6">
                                <button onClick={() => setStep(2)} disabled={isProcessing} className="text-gray-600 px-6 py-2 border rounded hover:bg-gray-50 disabled:opacity-50 transition">
                                    Back to Editor
                                </button>
                                <div className="flex gap-4">
                                    <button onClick={handleDownloadPDF} disabled={isProcessing} className="bg-[#2f314b] text-white px-8 py-2 rounded font-bold shadow hover:bg-[#2f314b]/90 disabled:bg-gray-400 flex items-center gap-2 transition">
                                        {isProcessing ? 'Generating...' : 'Download PDF'}
                                    </button>
                                </div>
                            </div>

                            {/* PRINTABLE PDF AREA - All fonts completely pixel-locked for PDF */}
                            <div className="bg-white p-10 print:p-0 max-w-[210mm] mx-auto shadow-sm text-gray-900" id="printable-report" style={{ fontFamily: "Arial, sans-serif" }}>

                                <div className="mb-8 text-center flex flex-col items-center">
                                    <img src={logoSrc} alt="Arlington Park" crossOrigin="anonymous" style={{ height: '72px' }} className="mb-4 object-contain" />
                                    <h2 className="text-[18px] font-bold">Property Inventory & Schedule of Condition</h2>
                                </div>

                                <div className="grid grid-cols-1 gap-2 mb-8 text-[12px]">
                                    <div className="flex">
                                        <span className="w-48 font-bold">Property Address:</span>
                                        <span>
                                            {tenancyInfo.roomIdentifier || ''}
                                            {tenancyInfo.roomIdentifier && tenancyInfo.propertyAddress ? ', ' : ''}
                                            {tenancyInfo.propertyAddress || ''}
                                        </span>
                                    </div>
                                    <div className="flex"><span className="w-48 font-bold">Tenant Name:</span> <span>{tenancyInfo.tenantName || ''}</span></div>
                                    <div className="flex"><span className="w-48 font-bold">Move-in Date:</span> <span>{formatOrdinalDate(tenancyInfo.moveInDate)}</span></div>
                                    <div className="flex"><span className="w-48 font-bold">Inspection Date:</span> <span>{formatOrdinalDate(tenancyInfo.dateOfInventory)}</span></div>
                                    <div className="flex"><span className="w-48 font-bold">Inspected By:</span> <span>{tenancyInfo.clerkName || ''}</span></div>
                                </div>

                                <div className="mb-10">
                                    {renderReportText(mainReport)}
                                </div>

                                <div className="mt-8 break-inside-avoid">
                                    <h3 className="text-[14px] font-bold mb-4">Declaration</h3>
                                    <p className="text-[12px] mb-6">This report is a fair and accurate representation of the property at the time of inspection.</p>
                                    <div className="space-y-4 text-[12px]">
                                        <p><strong>Signed (Agent):</strong> {tenancyInfo.clerkName || '_________________________'}</p>
                                        <p><strong>Date:</strong> {formatOrdinalDate(tenancyInfo.dateOfInventory) || '_________________________'}</p>
                                    </div>
                                </div>

                                {mainImages.length > 0 && (
                                    <div className="html2pdf__page-break w-full mt-10 pt-8 border-t-2 border-gray-200" style={{ fontSize: 0 }}>
                                        <h3 className="text-[14px] font-bold mb-6" style={{ fontSize: '14px' }}>Photographic Evidence</h3>
                                        <div className="block w-full">
                                            {mainImages.map((img, idx) => (
                                                <div 
                                                    key={img.id} 
                                                    className="break-inside-avoid inline-block align-top mb-6" 
                                                    style={{ 
                                                        width: '31%', 
                                                        marginRight: idx % 3 === 2 ? '0' : '3.5%', 
                                                        fontSize: '12px',
                                                        pageBreakInside: 'avoid' 
                                                    }}
                                                >
                                                    <p className="text-[10px] font-bold mb-1 text-gray-500 uppercase tracking-wider">Image {idx + 1}</p>
                                                    <img
                                                        src={`data:${img.mimeType};base64,${img.data}`}
                                                        className="w-full h-40 object-cover rounded shadow-sm border border-gray-300"
                                                        alt={`Evidence ${idx + 1}`}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <footer className="max-w-4xl mx-auto mt-6 text-center print:hidden pb-6">
                <div className="text-xs text-gray-500 mb-2 px-4 text-balance">
                    &copy; {new Date().getFullYear()} Luke Martin - Arlington Park Lettings & Estate Agents, 25a Earlham Rd, Norwich NR2 3AD{' '}
                    <a href="https://arlingtonpark.co.uk" target="_blank" rel="noopener noreferrer" className="hover:text-gray-700 underline transition">arlingtonpark.co.uk</a>
                </div>
                <button onClick={() => setShowApiSettings(true)} className="text-xs text-gray-400 hover:text-gray-600 underline transition">
                    API Settings
                </button>
            </footer>

            {showApiSettings && (
                <div
                    className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 print:hidden p-4"
                    onClick={handleModalBackdropClick}
                >
                    <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
                        <h3 className="text-lg font-bold text-gray-900 mb-4">API Configuration</h3>
                        <input
                            type="password"
                            value={activeApiKey}
                            onChange={handleApiChange}
                            placeholder="Gemini API Key..."
                            autoComplete="off"
                            className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-[#2f314b] mb-2"
                        />
                        <p className="text-[11px] text-gray-500 mb-1">
                            This key is saved to your browser's local storage. You will not need to enter it again on this device.
                        </p>
                        <p className="text-[11px] text-amber-600 mb-6">
                            Note: Do not use this on a shared or public device, as the key is stored locally in your browser.
                        </p>
                        <div className="flex justify-end">
                            <button onClick={() => setShowApiSettings(false)} className="bg-[#2f314b] text-white px-6 py-2 rounded-md font-medium hover:bg-[#2f314b]/90 transition">
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}