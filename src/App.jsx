import React, { useState, useRef, useEffect } from 'react';

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
    // RESTORED: 'gemini-2.5-flash-preview-09-2025' is strictly required for the Canvas preview environment to function.
    const defaultModels = [
        'gemini-2.5-flash-preview-09-2025',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-flash',
        'gemini-1.5-pro'
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

export default function App() {
    const [step, setStep] = useState(1);
    const [showApiSettings, setShowApiSettings] = useState(false);
    const [activeApiKey, setActiveApiKey] = useState(getEnvKey());
    const [tenancyInfo, setTenancyInfo] = useState({
        propertyAddress: '', roomIdentifier: '', tenantName: '', moveInDate: '', dateOfInventory: '', clerkName: ''
    });
    const [mainImages, setMainImages] = useState([]);
    const [mainReport, setMainReport] = useState('');
    const [isAnalysingMain, setIsAnalysingMain] = useState(false);
    const [isPolishingMain, setIsPolishingMain] = useState(false);
    const [loadingState, setLoadingState] = useState({ active: false, progress: 0, text: '' });
    const [isProcessing, setIsProcessing] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [pdfFallbackMsg, setPdfFallbackMsg] = useState('');

    const progressIntervalRef = useRef(null);

    useEffect(() => {
        return () => {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
            }
        };
    }, []);

    const handleTenancyChange = (e) => {
        const { name, value } = e.target;
        setTenancyInfo(prev => ({ ...prev, [name]: value }));
    };

    const handleApiChange = (e) => {
        const newKey = e.target.value;
        setActiveApiKey(newKey);
        localStorage.setItem('arlington_gemini_api_key', newKey);
    };

    useEffect(() => {
        if (!document.getElementById('html2pdf-script')) {
            const script = document.createElement("script");
            script.id = 'html2pdf-script';
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
            script.async = true;
            script.onerror = () => {
                setPdfFallbackMsg("PDF library failed to load. Download will use native print.");
            };
            document.body.appendChild(script);
        }
    }, []);

    const handleDownloadPDF = () => {
        const sourceElement = document.getElementById('printable-report');
        if (!sourceElement || isProcessing) return;

        setIsProcessing(true);
        setErrorMsg('');
        setPdfFallbackMsg('');

        const run = async () => {
            try {
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

                if (!window.html2pdf) {
                    setPdfFallbackMsg("PDF library not loaded, using native print instead.");
                    window.print();
                    return;
                }

                const sandbox = document.createElement('div');
                sandbox.style.position = 'fixed';
                sandbox.style.left = '-9999px';
                sandbox.style.top = '0';
                sandbox.style.width = '210mm';

                const clone = sourceElement.cloneNode(true);

                clone.style.setProperty('--color-gray-900', '#111827');
                clone.style.setProperty('--color-gray-800', '#1f2937');
                clone.style.setProperty('--color-gray-700', '#374151');
                clone.style.setProperty('--color-gray-500', '#6b7280');
                clone.style.setProperty('--color-gray-200', '#e5e7eb');
                clone.style.setProperty('--color-white', '#ffffff');
                clone.style.color = '#111827';

                sandbox.appendChild(clone);
                document.body.appendChild(sandbox);

                const tName = tenancyInfo.tenantName ? tenancyInfo.tenantName.trim() : 'Tenant';
                const rNum = tenancyInfo.roomIdentifier ? tenancyInfo.roomIdentifier.trim() : 'Room';
                const mDate = tenancyInfo.moveInDate || 'NoDate';
                const rawFilename = `${tName} ${rNum} ${mDate}`;
                const safeFilename = rawFilename.replace(/[/\\?%*:|"<>]/g, '-').trim() + '.pdf';

                const opt = {
                    margin: 10,
                    filename: safeFilename,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: {
                        scale: 2,
                        useCORS: true,
                        letterRendering: true,
                        logging: false
                    },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                    pagebreak: { mode: ['css', 'legacy'], avoid: ['.break-inside-avoid'] }
                };

                try {
                    await window.html2pdf().set(opt).from(clone).save();
                } catch (err) {
                    console.error("PDF generation failed:", err);
                    setErrorMsg("PDF generation failed. Falling back to native print.");
                    window.print();
                } finally {
                    if (document.body.contains(sandbox)) {
                        document.body.removeChild(sandbox);
                    }
                }
            } finally {
                setIsProcessing(false);
            }
        };

        run();
    };

    const compressImage = (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onerror = () => {
                console.warn("Failed to read file:", file.name);
                resolve(null);
            };
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onerror = () => {
                    console.warn("Failed to decode image:", file.name);
                    resolve(null);
                };
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve({ mimeType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.8).split(',')[1] });
                };
            };
        });
    };

    const handleImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const compressedFiles = (await Promise.all(files.map(file => compressImage(file)))).filter(Boolean);

        if (compressedFiles.length < files.length) {
            setErrorMsg(`${files.length - compressedFiles.length} file(s) could not be read and were skipped.`);
        }

        setMainImages(prev => [...prev, ...compressedFiles]);
        e.target.value = '';
    };

    const handleRemoveImage = (indexToRemove) => {
        setMainImages(prev => prev.filter((_, i) => i !== indexToRemove));
    };

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
                let newProgress = prev.progress + (Math.random() * 8 + 2);
                if (newProgress > 95) newProgress = 95;
                let newText = prev.text;
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
            const roomName = tenancyInfo.roomIdentifier || 'tenant room';

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
            Distinguish surface stains from structural damage (holes, burns). Be professional. Use UK English. Do not use em dashes.`;

            const payload = {
                contents: [{ role: "user", parts: [{ text: promptText }, ...imageParts] }]
            };

            const data = await callGeminiWithFallback(payload, activeApiKey);

            clearInterval(progressIntervalRef.current);
            setLoadingState(prev => ({ ...prev, progress: 100, text: 'Complete!' }));
            const aiDescription = data.candidates?.[0]?.content?.parts?.[0]?.text || "Analysis failed to return text.";
            setMainReport(aiDescription);

            setTimeout(() => setLoadingState({ active: false, progress: 0, text: '' }), 1500);
        } catch (error) {
            console.error("API Error:", error);
            clearInterval(progressIntervalRef.current);
            setLoadingState({ active: false, progress: 0, text: '' });
            setErrorMsg(`Analysis failed: ${error.message}`);
        } finally {
            setIsAnalysingMain(false);
        }
    };

    const polishText = async () => {
        if (!mainReport.trim() || !activeApiKey) return;
        setIsPolishingMain(true);
        try {
            const promptText = `Rewrite the following notes to sound highly professional and completely objective. Maintain exact formatting, bolding, and image references like [Image X]. Use UK English only. Do not use em dashes: \n\n${mainReport}`;
            const payload = { contents: [{ role: "user", parts: [{ text: promptText }] }] };
            const data = await callGeminiWithFallback(payload, activeApiKey);
            setMainReport(data.candidates?.[0]?.content?.parts?.[0]?.text || mainReport);
        } catch (error) {
            setErrorMsg(`Failed to polish text: ${error.message}`);
        } finally {
            setIsPolishingMain(false);
        }
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
        const s = ["th", "st", "nd", "rd"], v = day % 100;
        return `${day}${s[(v - 20) % 10] || s[v] || s[0]} ${month} ${year}`;
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
                <p key={i} className={`text-[15px] text-gray-800 ${line.trim() === '' ? 'h-3' : 'mt-1.5'}`}>
                    {segments.length > 0 ? segments : line}
                </p>
            );
        });
    };

    const canProceedToStep2 = tenancyInfo.propertyAddress.trim() !== '' || tenancyInfo.tenantName.trim() !== '';
    const canProceedToStep3 = mainReport.trim() !== '';

    const handleStepClick = (targetStep) => {
        if (targetStep === 2 && !canProceedToStep2 && step < 2) return;
        if (targetStep === 3 && !canProceedToStep3 && step < 3) return;
        setStep(targetStep);
    };

    return (
        <div className="min-h-screen bg-gray-100 text-gray-800 p-4 sm:p-8 print:p-0 print:bg-white font-sans">
            <style>
                {`
                @media print {
                    body * { visibility: hidden; }
                    #printable-report, #printable-report * { visibility: visible; }
                    #printable-report { 
                        position: absolute; 
                        left: 0; 
                        top: 0; 
                        width: 100%; 
                        padding: 0; 
                        margin: 0; 
                        box-shadow: none;
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
                    <img 
                        src="https://www.arlingtonpark.co.uk/images/arlington-park-site-logo.png.pagespeed.ce.BJSqnaww-K.png" 
                        alt="Arlington Park Logo" 
                        crossOrigin="anonymous" 
                        className="h-10 sm:h-12 object-contain" 
                    />
                    <h1 className="text-xl sm:text-2xl font-bold">Arlington Park Inventory</h1>
                </div>

                <div className="flex border-b border-gray-200 print:hidden">
                    <button
                        onClick={() => handleStepClick(1)}
                        className={`flex-1 py-4 text-center font-medium transition ${step === 1 ? 'border-b-2 border-[#2f314b] text-[#2f314b]' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                        1. Details
                    </button>
                    <button
                        onClick={() => handleStepClick(2)}
                        disabled={!canProceedToStep2 && step < 2}
                        className={`flex-1 py-4 text-center font-medium transition ${step === 2 ? 'border-b-2 border-[#2f314b] text-[#2f314b]' : 'text-gray-500 hover:bg-gray-50'} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                        2. Analysis
                    </button>
                    <button
                        onClick={() => handleStepClick(3)}
                        disabled={!canProceedToStep3 && step < 3}
                        className={`flex-1 py-4 text-center font-medium transition ${step === 3 ? 'border-b-2 border-[#2f314b] text-[#2f314b]' : 'text-gray-500 hover:bg-gray-50'} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                        3. Review
                    </button>
                </div>

                <div className="p-6 sm:p-8">
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
                                        <input
                                            type="date"
                                            name="moveInDate"
                                            value={tenancyInfo.moveInDate}
                                            onChange={handleTenancyChange}
                                            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#2f314b] focus:border-[#2f314b]"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Inspection Date</label>
                                        <input
                                            type="date"
                                            name="dateOfInventory"
                                            value={tenancyInfo.dateOfInventory}
                                            onChange={handleTenancyChange}
                                            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#2f314b] focus:border-[#2f314b]"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Inspected By (Agent Name)</label>
                                        <input
                                            type="text"
                                            name="clerkName"
                                            value={tenancyInfo.clerkName}
                                            onChange={handleTenancyChange}
                                            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#2f314b] focus:border-[#2f314b]"
                                        />
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
                                <p className="text-xs text-gray-400 mt-1">Enter at least a property address or tenant name to continue.</p>
                            )}
                        </div>
                    )}

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
                                            <div key={idx} className="relative group rounded overflow-hidden border border-gray-200">
                                                <img
                                                    src={`data:${img.mimeType};base64,${img.data}`}
                                                    alt={`Upload ${idx + 1}`}
                                                    className="w-full h-20 object-cover"
                                                />
                                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
                                                    <button
                                                        onClick={() => handleRemoveImage(idx)}
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

                            {/* PRINTABLE PDF AREA */}
                            <div className="bg-white p-10 print:p-0 max-w-[210mm] mx-auto shadow-sm text-gray-900" id="printable-report" style={{ fontFamily: "Arial, sans-serif" }}>

                                <div className="mb-10 text-center flex flex-col items-center">
                                    <img 
                                        src="https://www.arlingtonpark.co.uk/images/arlington-park-site-logo.png.pagespeed.ce.BJSqnaww-K.png" 
                                        alt="Arlington Park" 
                                        crossOrigin="anonymous" 
                                        style={{ height: '72px' }}
                                        className="mb-6 object-contain" 
                                    />
                                    <h2 className="text-[22px] font-bold">Property Inventory & Schedule of Condition</h2>
                                </div>

                                <div className="grid grid-cols-1 gap-3 mb-10 text-[15px]">
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

                                <div className="prose max-w-none mb-12">
                                    {renderReportText(mainReport)}
                                </div>

                                <div className="mt-8 break-inside-avoid">
                                    <h3 className="text-lg font-bold mb-4">Declaration</h3>
                                    <p className="text-[15px] mb-8">This report is a fair and accurate representation of the property at the time of inspection.</p>
                                    <div className="space-y-4 text-[15px]">
                                        <p><strong>Signed (Agent):</strong> {tenancyInfo.clerkName || '_________________________'}</p>
                                        <p><strong>Date:</strong> {formatOrdinalDate(tenancyInfo.dateOfInventory) || '_________________________'}</p>
                                    </div>
                                </div>

                                {mainImages.length > 0 && (
                                    <div className="html2pdf__page-break w-full mt-12 pt-10 border-t-2 border-gray-200">
                                        <h3 className="text-lg font-bold mb-6">Photographic Evidence</h3>
                                        <div className="grid grid-cols-3 gap-4">
                                            {mainImages.map((img, idx) => (
                                                <div key={idx} className="break-inside-avoid mb-4">
                                                    <p className="text-xs font-bold mb-1 text-gray-500 uppercase tracking-wider">Image {idx + 1}</p>
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
                    &copy; {new Date().getFullYear()} Luke Martin - Arlington Park Lettings & Estate Agents, 25a Earlham Rd, Norwich NR2 3AD <a href="https://arlingtonpark.co.uk" target="_blank" rel="noopener noreferrer" className="hover:text-gray-700 underline transition">arlingtonpark.co.uk</a>
                </div>
                <button onClick={() => setShowApiSettings(true)} className="text-xs text-gray-400 hover:text-gray-600 underline transition">
                    API Settings
                </button>
            </footer>

            {showApiSettings && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 print:hidden p-4">
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