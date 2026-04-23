import React, { useState, useRef, useEffect } from 'react';

// --- API Configuration ---
// We check for an environment variable first. 
// If not found, the user can provide it via the UI.
const getEnvKey = () => {
    try {
        return import.meta.env.VITE_GEMINI_API_KEY || "";
    } catch (e) {
        return "";
    }
};

const fetchWithRetry = async (url, options, retries = 5) => {
    const delays = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const errorData = await response.json();
                const errorMessage = errorData.error?.message || `HTTP error! status: ${response.status}`;
                throw new Error(errorMessage);
            }
            return await response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, delays[i]));
        }
    }
};

export default function App() {
    const [step, setStep] = useState(1);
    const [showApiSettings, setShowApiSettings] = useState(false);
    
    // API Key state for privacy
    const [activeApiKey, setActiveApiKey] = useState(getEnvKey());
    
    // State for Tenancy Details
    const [tenancyInfo, setTenancyInfo] = useState({
        propertyAddress: '',
        roomIdentifier: '', 
        tenantName: '',
        moveInDate: '', 
        dateOfInventory: '',
        clerkName: ''
    });

    const [hasEnsuite, setHasEnsuite] = useState(false);

    // State for Main Room
    const [mainImages, setMainImages] = useState([]);
    const [mainReport, setMainReport] = useState('');
    const [isAnalysingMain, setIsAnalysingMain] = useState(false);
    const [isPolishingMain, setIsPolishingMain] = useState(false);

    // State for Ensuite
    const [ensuiteImages, setEnsuiteImages] = useState([]);
    const [ensuiteReport, setEnsuiteReport] = useState('');
    const [isAnalysingEnsuite, setIsAnalysingEnsuite] = useState(false);
    const [isPolishingEnsuite, setIsPolishingEnsuite] = useState(false);

    // State for Progress Bar
    const [loadingState, setLoadingState] = useState({ active: false, type: '', progress: 0, text: '' });

    // State for Manager Tools (LLM Features)
    const [maintenanceTasks, setMaintenanceTasks] = useState('');
    const [isGeneratingTasks, setIsGeneratingTasks] = useState(false);
    
    const [tenantGuide, setTenantGuide] = useState('');
    const [isGeneratingGuide, setIsGeneratingGuide] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);

    const [errorMsg, setErrorMsg] = useState('');

    const mainFileInputRef = useRef(null);
    const ensuiteFileInputRef = useRef(null);

    const handleTenancyChange = (e) => {
        const { name, value } = e.target;
        setTenancyInfo(prev => ({ ...prev, [name]: value }));
    };

    // Dynamically load html2pdf for direct PDF downloading
    useEffect(() => {
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
        script.async = true;
        document.body.appendChild(script);
        return () => {
            if (document.body.contains(script)) {
                document.body.removeChild(script);
            }
        };
    }, []);

    const handleDownloadPDF = () => {
        const element = document.getElementById('printable-report');
        if (!element) return;

        if (window.html2pdf) {
            setIsDownloading(true);
            const opt = {
                margin:       10,
                filename:     `Inventory_Report_${tenancyInfo.roomIdentifier ? tenancyInfo.roomIdentifier.replace(/[^a-z0-9]/gi, '_') : 'Room'}.pdf`,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, useCORS: true },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak:    { mode: ['css', 'legacy'], avoid: ['.break-inside-avoid'] }
            };

            window.html2pdf().set(opt).from(element).save().then(() => {
                setIsDownloading(false);
            }).catch(err => {
                console.error("PDF generation failed:", err);
                setIsDownloading(false);
                window.print(); // Fallback
            });
        } else {
            window.print(); // Fallback if script failed to load
        }
    };

    const handleEmailPDF = () => {
        const element = document.getElementById('printable-report');
        if (!element) return;

        if (window.html2pdf) {
            setIsDownloading(true);
            setErrorMsg('');
            const opt = {
                margin:       10,
                filename:     `Inventory_Report_${tenancyInfo.roomIdentifier ? tenancyInfo.roomIdentifier.replace(/[^a-z0-9]/gi, '_') : 'Room'}.pdf`,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, useCORS: true },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak:    { mode: ['css', 'legacy'], avoid: ['.break-inside-avoid'] }
            };

            window.html2pdf().set(opt).from(element).output('blob').then(async (pdfBlob) => {
                const file = new File([pdfBlob], opt.filename, { type: 'application/pdf' });
                
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            files: [file],
                            title: 'Property Inventory Report',
                            text: `Please find attached the property inventory report for ${tenancyInfo.propertyAddress || 'the property'}.`
                        });
                    } catch (error) {
                        console.error('Share cancelled or failed:', error);
                    }
                } else {
                    setErrorMsg("Direct sharing is not supported on this browser. The file has been downloaded instead.");
                    window.html2pdf().set(opt).from(element).save();
                }
                setIsDownloading(false);
            }).catch(err => {
                console.error("PDF generation failed:", err);
                setIsDownloading(false);
            });
        } else {
            setErrorMsg("PDF engine not loaded yet.");
        }
    };

    const compressImage = (file, maxWidth = 1024, maxHeight = 1024, quality = 0.7) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    let width = img.width;
                    let height = img.height;
                    if (width > height) {
                        if (width > maxWidth) {
                            height = Math.round((height * maxWidth) / width);
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width = Math.round((width * maxHeight) / height);
                            height = maxHeight;
                        }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL('image/jpeg', quality);
                    resolve({
                        mimeType: 'image/jpeg',
                        data: dataUrl.split(',')[1]
                    });
                };
                img.onerror = error => reject(error);
            };
            reader.onerror = error => reject(error);
        });
    };

    const handleImageUpload = async (e, type) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        const compressedFiles = await Promise.all(files.map(file => compressImage(file)));
        if (type === 'main') {
            setMainImages(prev => [...prev, ...compressedFiles]);
        } else {
            setEnsuiteImages(prev => [...prev, ...compressedFiles]);
        }
    };

    const clearImages = (type) => {
        if (type === 'main') {
            setMainImages([]);
            if (mainFileInputRef.current) mainFileInputRef.current.value = '';
        } else {
            setEnsuiteImages([]);
            if (ensuiteFileInputRef.current) ensuiteFileInputRef.current.value = '';
        }
    };

    const analyseImages = async (type) => {
        const isMain = type === 'main';
        const imagesToAnalyse = isMain ? mainImages : ensuiteImages;
        const setAnalysing = isMain ? setIsAnalysingMain : setIsAnalysingEnsuite;
        const setReport = isMain ? setMainReport : setEnsuiteReport;
        
        if (!activeApiKey) {
            setErrorMsg("Missing API Key. Please provide one in Step 1.");
            return;
        }
        if (imagesToAnalyse.length === 0) {
            setErrorMsg(`Please provide at least one image for the ${isMain ? 'main room' : 'ensuite'}.`);
            return;
        }

        setAnalysing(true);
        setErrorMsg('');
        setLoadingState({ active: true, type: type, progress: 5, text: 'Preparing images...' });

        const progressInterval = setInterval(() => {
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
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeApiKey}`;
            const imageParts = imagesToAnalyse.map(img => ({
                inlineData: { mimeType: img.mimeType, data: img.data }
            }));
            const roomName = tenancyInfo.roomIdentifier || 'tenant room';
            const formatConstraint = `
Output the report EXACTLY in this format:
1. General Overview
• Cleanliness: [assessment]
• Decor: [assessment]
• Flooring: [assessment]

2. Detailed Item Condition
• [Item name]: [Description]
Condition: [Condition]
`;
            const promptText = isMain 
                ? `Analyse the images of ${roomName} in an HMO. ${formatConstraint} 
                Distinguish surface stains from structural damage (holes, burns). Be professional. Use UK English.`
                : `Analyse the ensuite for ${roomName}. ${formatConstraint} 
                Focus on sanitaryware and tiling. Be professional. Use UK English.`;

            const payload = {
                contents: [{ role: "user", parts: [{ text: promptText }, ...imageParts] }]
            };

            const data = await fetchWithRetry(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            clearInterval(progressInterval);
            setLoadingState(prev => ({ ...prev, progress: 100, text: 'Complete!' }));
            const aiDescription = data.candidates?.[0]?.content?.parts?.[0]?.text || "Analysis failed.";
            setReport(aiDescription.replace(/\*\*/g, ''));

            setTimeout(() => setLoadingState({ active: false, type: '', progress: 0, text: '' }), 1500);
        } catch (error) {
            console.error("API Error:", error);
            clearInterval(progressInterval);
            setLoadingState({ active: false, type: '', progress: 0, text: '' });
            setErrorMsg(`Analysis failed: ${error.message}`);
        } finally {
            setAnalysing(false);
        }
    };

    const polishText = async (type) => {
        const isMain = type === 'main';
        const currentText = isMain ? mainReport : ensuiteReport;
        if (!currentText.trim() || !activeApiKey) return;
        const setPolishing = isMain ? setIsPolishingMain : setIsPolishingEnsuite;
        const setReport = isMain ? setMainReport : setEnsuiteReport;
        setPolishing(true);
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeApiKey}`;
            const promptText = `Rewrite professional and objective: \n\n${currentText}`;
            const payload = { contents: [{ role: "user", parts: [{ text: promptText }] }] };
            const data = await fetchWithRetry(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            setReport((data.candidates?.[0]?.content?.parts?.[0]?.text || currentText).replace(/\*\*/g, ''));
        } catch (error) {
            setErrorMsg("Failed to polish text.");
        } finally {
            setPolishing(false);
        }
    };

    const formatOrdinalDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        const day = date.getDate();
        const month = date.toLocaleDateString('en-GB', { month: 'long' });
        const year = date.getFullYear();
        const s = ["th", "st", "nd", "rd"], v = day % 100;
        return `${day}${s[(v - 20) % 10] || s[v] || s[0]} ${month} ${year}`;
    };

    const renderReportText = (text) => {
        if (!text) return null;
        return text.split('\n').map((line, i) => <p key={i} className="mt-2 text-[15px]">{line}</p>);
    };

    return (
        <div className="min-h-screen bg-gray-100 text-gray-800 p-4 sm:p-8 print:p-0 print:bg-white">
            <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden print:shadow-none">
                
                <div className="bg-[#2f314b] text-white p-6 print:hidden flex items-center gap-6">
                    <h1 className="text-2xl font-bold">Arlington Park Inventory</h1>
                </div>

                <div className="flex border-b border-gray-200 print:hidden">
                    <button onClick={() => setStep(1)} className={`flex-1 py-4 text-center font-medium ${step === 1 ? 'border-b-2 border-[#2f314b] text-[#2f314b]' : 'text-gray-500'}`}>1. Details</button>
                    <button onClick={() => setStep(2)} className={`flex-1 py-4 text-center font-medium ${step === 2 ? 'border-b-2 border-[#2f314b] text-[#2f314b]' : 'text-gray-500'}`}>2. Analysis</button>
                    <button onClick={() => setStep(3)} className={`flex-1 py-4 text-center font-medium ${step === 3 ? 'border-b-2 border-[#2f314b] text-[#2f314b]' : 'text-gray-500'}`}>3. Review</button>
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
                            <button onClick={() => setStep(2)} className="bg-[#2f314b] text-white px-8 py-3 rounded-md font-medium mt-4">Next</button>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-8">
                            {errorMsg && <div className="p-4 bg-red-50 text-red-700 rounded-md text-sm border border-red-200">{errorMsg}</div>}
                            <div className="bg-white border p-6 rounded-lg">
                                <h3 className="font-bold mb-4">Room Photos</h3>
                                <input type="file" multiple accept="image/*" onChange={(e) => handleImageUpload(e, 'main')} className="mb-4 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-[#2f314b] file:text-white"/>
                                <button onClick={() => analyseImages('main')} disabled={isAnalysingMain || mainImages.length === 0} className="w-full py-3 bg-[#2f314b] text-white rounded-md font-bold disabled:bg-gray-300">
                                    {isAnalysingMain ? 'Analysing...' : 'Generate Report'}
                                </button>
                                {mainReport && <textarea value={mainReport} onChange={(e) => setMainReport(e.target.value)} className="w-full mt-4 p-4 border rounded-md h-64 font-mono text-sm bg-gray-50"/>}
                            </div>
                            <button onClick={() => setStep(3)} className="bg-[#2f314b] text-white px-8 py-3 rounded-md font-bold">Final Review</button>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-6">
                            <div className="flex justify-between print:hidden mb-6">
                                <button onClick={() => setStep(2)} className="text-gray-600 px-4 py-2 border rounded">Back</button>
                                <div className="flex gap-4">
                                    <button onClick={handleEmailPDF} className="bg-blue-600 text-white px-6 py-2 rounded font-bold shadow">Share / Email</button>
                                    <button onClick={handleDownloadPDF} className="bg-[#2f314b] text-white px-6 py-2 rounded font-bold shadow">Download PDF</button>
                                </div>
                            </div>
                            <div className="bg-white p-10 print:p-0 max-w-[210mm] mx-auto min-h-[297mm] shadow-sm" id="printable-report">
                                <img src="https://www.arlingtonpark.co.uk/images/arlington-park-site-logo.png.pagespeed.ce.BJSqnaww-K.png" alt="Arlington Park" className="h-12 mb-6 object-contain" />
                                <h2 className="text-xl font-bold mb-6">Schedule of Condition</h2>
                                <div className="space-y-2 mb-10 text-sm">
                                    <p><strong>Property:</strong> {tenancyInfo.propertyAddress} {tenancyInfo.roomIdentifier}</p>
                                    <p><strong>Date:</strong> {formatOrdinalDate(tenancyInfo.dateOfInventory)}</p>
                                    <p><strong>Clerk:</strong> {tenancyInfo.clerkName}</p>
                                </div>
                                <div className="prose max-w-none">{renderReportText(mainReport)}</div>
                                <div className="mt-16 pt-8 border-t">
                                    <p className="text-sm"><strong>Signed:</strong> ___________________________</p>
                                    <p className="text-xs text-gray-400 mt-2">Generated on {formatOrdinalDate(new Date().toISOString())}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer with Settings Link */}
            <footer className="max-w-4xl mx-auto mt-6 text-center print:hidden pb-4">
                <button 
                    onClick={() => setShowApiSettings(true)} 
                    className="text-xs text-gray-400 hover:text-gray-600 underline transition"
                >
                    API Settings
                </button>
            </footer>

            {/* API Settings Modal */}
            {showApiSettings && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 print:hidden p-4">
                    <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
                        <h3 className="text-lg font-bold text-gray-900 mb-4">API Configuration</h3>
                        <input 
                            type="password" 
                            value={activeApiKey} 
                            onChange={(e) => setActiveApiKey(e.target.value)}
                            placeholder="Gemini API Key..."
                            className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-[#2f314b] mb-2"
                        />
                        <p className="text-[11px] text-gray-500 mb-6">
                            If you have set VITE_GEMINI_API_KEY in Vercel, this will auto-fill. Otherwise, paste your key here to use the app immediately.
                        </p>
                        <div className="flex justify-end">
                            <button 
                                onClick={() => setShowApiSettings(false)} 
                                className="bg-[#2f314b] text-white px-6 py-2 rounded-md font-medium hover:bg-[#2f314b]/90 transition"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}