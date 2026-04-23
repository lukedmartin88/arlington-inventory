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
    const defaultModels = [
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-2.5-flash-preview-09-2025',
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
    const [loadingState, setLoadingState] = useState({ active: false, type: '', progress: 0, text: '' });
    const [isProcessing, setIsProcessing] = useState(false); 
    const [errorMsg, setErrorMsg] = useState('');

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

    // REWRITTEN: Safer PDF generation using standard callbacks to prevent freezing
    const handleDownloadPDF = () => {
        const element = document.getElementById('printable-report');
        if (!element) return;
        
        if (!window.html2pdf) {
            console.warn("PDF library not loaded. Falling back to browser print.");
            window.print();
            return;
        }

        setIsProcessing(true);
        setErrorMsg('');

        const safeFilename = `Inventory_${tenancyInfo.roomIdentifier ? tenancyInfo.roomIdentifier.replace(/[^a-z0-9]/gi, '_') : 'Report'}.pdf`;

        const opt = {
            margin: 10,
            filename: safeFilename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, letterRendering: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'], avoid: ['.break-inside-avoid'] }
        };

        window.html2pdf()
            .set(opt)
            .from(element)
            .save()
            .then(() => {
                setIsProcessing(false);
            })
            .catch(err => {
                console.error("PDF generation failed:", err);
                setIsProcessing(false);
                setErrorMsg("PDF generation failed. You can use your browser's Print function (Ctrl+P / Cmd+P) to save as PDF.");
            });
    };

    const compressImage = (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
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
        const compressedFiles = await Promise.all(files.map(file => compressImage(file)));
        setMainImages(prev => [...prev, ...compressedFiles]);
    };

    const analyseImages = async () => {
        if (!activeApiKey) {
            setErrorMsg("Missing API Key. Please provide one via API Settings.");
            return;
        }
        if (mainImages.length === 0) {
            setErrorMsg(`Please provide at least one image.`);
            return;
        }

        setIsAnalysingMain(true);
        setErrorMsg('');
        setLoadingState({ active: true, progress: 5, text: 'Preparing images...' });

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
            const imageParts = mainImages.map(img => ({
                inlineData: { mimeType: img.mimeType, data: img.data }
            }));
            const roomName = tenancyInfo.roomIdentifier || 'tenant room';
            
            const formatConstraint = `
Output the report EXACTLY in this format using bolding for headings:
**1. General Overview**
• **Cleanliness:** [assessment]
• **Decor:** [assessment]
• **Flooring:** [assessment]

**2. Detailed Item Condition**
${roomName}
• **[Item name]:** [Description]
Condition: [Condition]
`;
            const promptText = `Analyse the images of ${roomName} in an HMO. ${formatConstraint} 
            Distinguish surface stains from structural damage (holes, burns). Be professional. Use UK English. Do not use em dashes.`;

            const payload = {
                contents: [{ role: "user", parts: [{ text: promptText }, ...imageParts] }]
            };

            const data = await callGeminiWithFallback(payload, activeApiKey);

            clearInterval(progressInterval);
            setLoadingState(prev => ({ ...prev, progress: 100, text: 'Complete!' }));
            const aiDescription = data.candidates?.[0]?.content?.parts?.[0]?.text || "Analysis failed to return text.";
            setMainReport(aiDescription);

            setTimeout(() => setLoadingState({ active: false, progress: 0, text: '' }), 1500);
        } catch (error) {
            console.error("API Error:", error);
            clearInterval(progressInterval);
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
            const promptText = `Rewrite the following notes to sound highly professional and completely objective. Maintain the exact same formatting, bullet points, and bold asterisks (**). Use UK English. Do not use em dashes: \n\n${mainReport}`;
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
        return text.split('\n').map((line, i) => {
            const parts = line.split(/(\*\*.*?\*\*)/g);
            return (
                <p key={i} className={`text-[15px] text-gray-800 ${line.trim() === '' ? 'h-3' : 'mt-1.5'}`}>
                    {parts.map((part, j) => {
                        if (part.startsWith('**') && part.endsWith('**')) {
                            return <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>;
                        }
                        return <span key={j}>{part}</span>;
                    })}
                </p>
            );
        });
    };

    return (
        <div className="min-h-screen bg-gray-100 text-gray-800 p-4 sm:p-8 print:p-0 print:bg-white font-sans">
            <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden print:shadow-none">
                
                <div className="bg-[#2f314b] text-white p-4 sm:p-6 print:hidden flex items-center gap-4">
                    <img src="https://www.arlingtonpark.co.uk/images/arlington-park-site-logo.png.pagespeed.ce.BJSqnaww-K.png" alt="Arlington Park Logo" className="h-10 sm:h-12 object-contain" />
                    <h1 className="text-xl sm:text-2xl font-bold">Arlington Park Inventory</h1>
                </div>

                <div className="flex border-b border-gray-200 print:hidden">
                    <button onClick={() => setStep(1)} className={`flex-1 py-4 text-center font-medium ${step === 1 ? 'border-b-2 border-[#2f314b] text-[#2f314b]' : 'text-gray-500 hover:bg-gray-50'}`}>1. Details</button>
                    <button onClick={() => setStep(2)} className={`flex-1 py-4 text-center font-medium ${step === 2 ? 'border-b-2 border-[#2f314b] text-[#2f314b]' : 'text-gray-500 hover:bg-gray-50'}`}>2. Analysis</button>
                    <button onClick={() => setStep(3)} className={`flex-1 py-4 text-center font-medium ${step === 3 ? 'border-b-2 border-[#2f314b] text-[#2f314b]' : 'text-gray-500 hover:bg-gray-50'}`}>3. Review</button>
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
                            <button onClick={() => setStep(2)} className="bg-[#2f314b] text-white px-8 py-3 rounded-md font-medium mt-4 shadow hover:bg-[#2f314b]/90 transition">Next</button>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-8">
                            {errorMsg && <div className="p-4 bg-red-50 text-red-700 rounded-md text-sm border border-red-200">{errorMsg}</div>}
                            
                            <div className="bg-white border border-gray-200 p-6 rounded-lg shadow-sm">
                                <h3 className="text-lg font-semibold text-gray-900 mb-4">Room Photos</h3>
                                <div className="p-4 border-2 border-dashed border-[#2f314b]/30 rounded-lg bg-[#2f314b]/5 mb-4">
                                    <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-[#2f314b] file:text-white cursor-pointer"/>
                                    {mainImages.length > 0 && (
                                        <p className="text-xs text-green-600 mt-2 font-medium">{mainImages.length} images loaded securely.</p>
                                    )}
                                </div>
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
                                <button onClick={() => setStep(3)} className="bg-[#2f314b] text-white px-8 py-3 rounded-md font-bold shadow hover:bg-[#2f314b]/90 transition">Final Review</button>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-6">
                            <div className="flex justify-between print:hidden mb-6">
                                {/* Disabled while processing so you don't accidentally click it mid-download */}
                                <button onClick={() => setStep(2)} disabled={isProcessing} className="text-gray-600 px-6 py-2 border rounded hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 transition">
                                    Back to Editor
                                </button>
                                <div className="flex gap-4">
                                    <button onClick={handleDownloadPDF} disabled={isProcessing} className="bg-[#2f314b] text-white px-8 py-2 rounded font-bold shadow hover:bg-[#2f314b]/90 disabled:bg-gray-400 flex items-center gap-2 transition">
                                        {isProcessing ? 'Generating...' : 'Download PDF'}
                                    </button>
                                </div>
                            </div>

                            {/* PRINTABLE PDF AREA */}
                            <div className="bg-white p-10 print:p-0 max-w-[210mm] mx-auto shadow-sm text-gray-900" id="printable-report" style={{fontFamily: "Arial, sans-serif"}}>
                                
                                <div className="mb-10 text-center flex flex-col items-center">
                                    <img src="https://www.arlingtonpark.co.uk/images/arlington-park-site-logo.png.pagespeed.ce.BJSqnaww-K.png" alt="Arlington Park" className="h-[4.5rem] mb-6 object-contain" />
                                    <h2 className="text-[22px] font-bold">Property Inventory & Schedule of Condition</h2>
                                </div>
                                
                                <div className="grid grid-cols-1 gap-3 mb-10 text-[15px]">
                                    <div className="flex"><span className="w-48 font-bold">Property Address:</span> <span>{tenancyInfo.propertyAddress || ''}{tenancyInfo.propertyAddress && tenancyInfo.roomIdentifier ? ', ' : ''}{tenancyInfo.roomIdentifier ? `${tenancyInfo.roomIdentifier}` : ''}</span></div>
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
                                    <div className="space-y-2 text-[15px]">
                                        <p><strong>Signed (Agent):</strong> {tenancyInfo.clerkName || '_________________________'}</p>
                                        <p><strong>Date:</strong> {formatOrdinalDate(tenancyInfo.dateOfInventory) || '_________________________'}</p>
                                    </div>
                                </div>

                                {/* Photographic Appendix Section */}
                                {mainImages.length > 0 && (
                                    <div className="html2pdf__page-break w-full mt-12 pt-10 border-t-2 border-gray-200">
                                        <h3 className="text-lg font-bold mb-6">Photographic Evidence</h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            {mainImages.map((img, idx) => (
                                                <div key={idx} className="break-inside-avoid mb-2">
                                                    <img 
                                                        src={`data:${img.mimeType};base64,${img.data}`} 
                                                        className="w-full h-auto object-cover rounded shadow-sm border border-gray-300" 
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
                <div className="text-xs text-gray-500 mb-2 px-4">
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
                            className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-[#2f314b] mb-2"
                        />
                        <p className="text-[11px] text-gray-500 mb-6">
                            This key is securely saved to your browser's local storage. You will not need to enter it again on this device.
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