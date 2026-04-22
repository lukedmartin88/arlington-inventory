import React, { useState, useRef, useEffect } from 'react';

// --- API Configuration ---
const apiKey = "AIzaSyAY9VnSSOP9nku_o3JDdGvtwTxOUWl7zGA"; 

const fetchWithRetry = async (url, options, retries = 5) => {
    const delays = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, delays[i]));
        }
    }
};

export default function App() {
    const [step, setStep] = useState(1);
    
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
                    // Fallback to standard download if sharing isn't supported
                    setErrorMsg("Direct sharing is not supported on this browser. The file has been downloaded instead so you can attach it to an email manually.");
                    window.html2pdf().set(opt).from(element).save();
                }
                setIsDownloading(false);
            }).catch(err => {
                console.error("PDF generation failed:", err);
                setIsDownloading(false);
            });
        } else {
            setErrorMsg("PDF engine not loaded yet. Please try again in a moment.");
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
        
        if (imagesToAnalyse.length === 0) {
            setErrorMsg(`Please provide at least one image for the ${isMain ? 'main room' : 'ensuite'}.`);
            return;
        }

        setAnalysing(true);
        setErrorMsg('');
        setLoadingState({ active: true, type: type, progress: 5, text: 'Preparing images...' });

        // Simulated progress interval to keep user informed
        const progressInterval = setInterval(() => {
            setLoadingState(prev => {
                if (!prev.active) return prev;
                
                // Increment progress slowly, capping at 95% until the actual fetch resolves
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
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
            
            const imageParts = imagesToAnalyse.map(img => ({
                inlineData: {
                    mimeType: img.mimeType,
                    data: img.data
                }
            }));

            const roomName = tenancyInfo.roomIdentifier || 'tenant room';
            
            const formatConstraint = `
Output the report EXACTLY in this format (do not use markdown bolding like **):

1. General Overview
• Cleanliness: [assessment]
• Decor: [assessment]
• Flooring: [assessment]

2. Detailed Item Condition
[Include relevant subheadings like Room, Windows & Heating, Furniture: Desk Area, Furniture: Sleeping Area, Storage, etc.]
• [Item name]: [Description]
Condition: [Condition]

(Repeat item and condition lines for all visible elements).
`;

            const promptText = isMain 
                ? `You are a highly meticulous UK property inventory clerk. Analyse the provided images of the ${roomName} in an HMO with extreme attention to detail. ${formatConstraint} 
                CRITICAL INSTRUCTION: Be extremely thorough when identifying damage. Carefully distinguish between surface stains/discolouration and structural damage (e.g., holes, tears, fraying, burns, or indentations in carpets and flooring; chips or deep scratches in furniture and walls). Look closely at shadows and textures to accurately identify the physical nature of any defect. 
                Note all marks, scuffs, or damage precisely. DO NOT mention if an item requires cleaning. Be precise and professional. Use UK English. Do not use em dashes.`
                : `You are a highly meticulous UK property inventory clerk. Analyse the provided images of the ensuite bathroom attached to the ${roomName} with extreme attention to detail. ${formatConstraint} 
                CRITICAL INSTRUCTION: Be extremely thorough when identifying damage. Carefully distinguish between surface discolouration, chips or cracks in enamel/ceramics, failing grout, peeling sealant, and structural damage. Look closely at shadows and textures to accurately identify the physical nature of any defect. 
                Focus on sanitaryware, tiling, and extractors. Note all marks, mould, limescale, or damage precisely. DO NOT mention if an item requires cleaning. Be precise and professional. Use UK English. Do not use em dashes.`;

            const payload = {
                contents: [{
                    role: "user",
                    parts: [
                        { text: promptText },
                        ...imageParts
                    ]
                }]
            };

            const data = await fetchWithRetry(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            clearInterval(progressInterval);
            setLoadingState(prev => ({ ...prev, progress: 100, text: 'Complete!' }));

            const aiDescription = data.candidates?.[0]?.content?.parts?.[0]?.text || "Analysis failed to return text.";
            const cleanDescription = aiDescription.replace(/\*\*/g, '');
            setReport(cleanDescription);

            // Hide the progress bar after a short delay
            setTimeout(() => {
                setLoadingState({ active: false, type: '', progress: 0, text: '' });
            }, 1500);

        } catch (error) {
            console.error("API Error:", error);
            clearInterval(progressInterval);
            setLoadingState({ active: false, type: '', progress: 0, text: '' });
            setErrorMsg(`Failed to analyse images for the ${isMain ? 'main room' : 'ensuite'}. Please ensure the API is accessible.`);
        } finally {
            setAnalysing(false);
        }
    };

    // --- NEW GEMINI LLM FEATURE: Polish Text ---
    const polishText = async (type) => {
        const isMain = type === 'main';
        const currentText = isMain ? mainReport : ensuiteReport;
        
        if (!currentText.trim()) return;

        const setPolishing = isMain ? setIsPolishingMain : setIsPolishingEnsuite;
        const setReport = isMain ? setMainReport : setEnsuiteReport;

        setPolishing(true);
        setErrorMsg('');

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
            const promptText = `You are a strict, objective UK property inventory clerk. Rewrite the following notes to sound highly professional, completely objective, and formal. Fix any grammar issues. DO NOT change the formatting structure, keep the exact same headings and bullet points. Do not use markdown bolding (**). Here are the notes:\n\n${currentText}`;

            const payload = {
                contents: [{ role: "user", parts: [{ text: promptText }] }]
            };

            const data = await fetchWithRetry(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            let polishedDescription = data.candidates?.[0]?.content?.parts?.[0]?.text || currentText;
            polishedDescription = polishedDescription.replace(/\*\*/g, '');
            setReport(polishedDescription);

        } catch (error) {
            console.error("API Error:", error);
            setErrorMsg("Failed to polish text. Please try again.");
        } finally {
            setPolishing(false);
        }
    };

    // --- NEW GEMINI LLM FEATURE: Extract Maintenance Tasks ---
    const generateMaintenanceTasks = async () => {
        const combinedReport = `${mainReport}\n\n${hasEnsuite ? ensuiteReport : ''}`;
        if (!combinedReport.trim()) return;

        setIsGeneratingTasks(true);
        setErrorMsg('');

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
            const promptText = `You are an expert property manager. Review the following inventory report and extract a concise, bulleted checklist of actionable maintenance, repair, or cleaning tasks required (e.g., "Clean rust from window mechanism", "Repair scuff near coat hooks"). If the condition is perfect, say "No maintenance required at this time." Output ONLY the bullet points.\n\nReport:\n${combinedReport}`;

            const payload = {
                contents: [{ role: "user", parts: [{ text: promptText }] }]
            };

            const data = await fetchWithRetry(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            setMaintenanceTasks(data.candidates?.[0]?.content?.parts?.[0]?.text || "No actionable tasks found.");

        } catch (error) {
            console.error("API Error:", error);
            setErrorMsg("Failed to generate maintenance list.");
        } finally {
            setIsGeneratingTasks(false);
        }
    };

    // --- NEW GEMINI LLM FEATURE: Generate Tenant Welcome Guide ---
    const generateTenantGuide = async () => {
        const combinedReport = `${mainReport}\n\n${hasEnsuite ? ensuiteReport : ''}`;
        if (!combinedReport.trim()) return;

        setIsGeneratingGuide(true);
        setErrorMsg('');

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
            const promptText = `You are the friendly property manager at Arlington Park. Based on the items and materials listed in the following inventory report (e.g., specific carpet type, uPVC windows, melamine desks, etc.), write a short, welcoming letter to the new tenant. 
            Give them 3 or 4 highly specific tips on how to care for these exact items to keep the room in excellent condition and help them get their full deposit back when they leave. Keep it warm, polite, and professional. Use UK English. Do not use em dashes.\n\nReport:\n${combinedReport}`;

            const payload = {
                contents: [{ role: "user", parts: [{ text: promptText }] }]
            };

            const data = await fetchWithRetry(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            setTenantGuide(data.candidates?.[0]?.content?.parts?.[0]?.text || "Failed to generate guide.");

        } catch (error) {
            console.error("API Error:", error);
            setErrorMsg("Failed to generate tenant guide.");
        } finally {
            setIsGeneratingGuide(false);
        }
    };


    const formatOrdinalDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;

        const day = date.getDate();
        const month = date.toLocaleDateString('en-GB', { month: 'long' });
        const year = date.getFullYear();

        const suffix = ["th", "st", "nd", "rd"];
        const v = day % 100;
        const ordinal = day + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);

        return `${ordinal} ${month} ${year}`;
    };

    const renderReportText = (text) => {
        if (!text) return null;
        const lines = text.split('\n');

        return lines.map((line, index) => {
            const trimmedLine = line.trim();
            if (!trimmedLine) return <div key={index} className="h-2"></div>;

            if (/^\d+\.\s/.test(trimmedLine)) {
                return <h3 key={index} className="text-lg font-bold mt-6 mb-2 text-gray-900">{trimmedLine}</h3>;
            }

            if (/^[A-Za-z][a-zA-Z &:]+$/.test(trimmedLine) && !trimmedLine.includes('•') && !trimmedLine.includes('Condition:')) {
                return <h4 key={index} className="text-md font-bold mt-5 mb-2 text-gray-900">{trimmedLine}</h4>;
            }

            if (trimmedLine.startsWith('•') || trimmedLine.startsWith('-')) {
                const cleanLine = trimmedLine.replace(/^-/, '•');
                const splitIndex = cleanLine.indexOf(':');
                
                if (splitIndex !== -1) {
                    const item = cleanLine.substring(0, splitIndex + 1);
                    const desc = cleanLine.substring(splitIndex + 1);
                    return (
                        <p key={index} className="mt-3 text-gray-800 text-[15px]">
                            <span className="font-bold">{item}</span>{desc}
                        </p>
                    );
                }
                return <p key={index} className="mt-3 text-gray-800 text-[15px] font-bold">{cleanLine}</p>;
            }

            if (trimmedLine.startsWith('Condition:')) {
                return <p key={index} className="text-gray-800 text-[15px] mb-2">{trimmedLine}</p>;
            }

            return <p key={index} className="text-gray-800 text-[15px]">{trimmedLine}</p>;
        });
    };

    return (
        <div className="min-h-screen bg-gray-100 text-gray-800 font-sans p-4 sm:p-8 print:p-0 print:bg-white">
            <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden print:shadow-none print:overflow-visible">
                
                {/* Application UI Header (Hidden on Print) */}
                <div className="bg-[#2f314b] text-white p-6 print:hidden flex items-center gap-6">
                    <div className="shrink-0">
                        <img 
                            src="https://www.arlingtonpark.co.uk/images/arlington-park-site-logo.png.pagespeed.ce.BJSqnaww-K.png" 
                            alt="Arlington Park" 
                            className="h-14 object-contain" 
                        />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">Inventory Form</h1>
                        <p className="text-white/80 mt-1">Generate formatted PDF reports automatically</p>
                    </div>
                </div>

                {/* Progress Steps (Hidden on Print) */}
                <div className="flex border-b border-gray-200 print:hidden">
                    <button 
                        onClick={() => setStep(1)} 
                        className={`flex-1 py-4 text-center font-medium ${step === 1 ? 'border-b-2 border-[#2f314b] text-[#2f314b] bg-[#2f314b]/5' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                        1. Details
                    </button>
                    <button 
                        onClick={() => setStep(2)} 
                        className={`flex-1 py-4 text-center font-medium ${step === 2 ? 'border-b-2 border-[#2f314b] text-[#2f314b] bg-[#2f314b]/5' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                        2. Analysis
                    </button>
                    <button 
                        onClick={() => setStep(3)} 
                        className={`flex-1 py-4 text-center font-medium ${step === 3 ? 'border-b-2 border-[#2f314b] text-[#2f314b] bg-[#2f314b]/5' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                        3. Review & Print
                    </button>
                </div>

                {/* Main Content Area */}
                <div className="p-0 sm:p-8 print:p-0">
                    
                    {/* STEP 1: Tenancy Details */}
                    {step === 1 && (
                        <div className="space-y-6 print:hidden">
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
                            <div className="pt-6 flex justify-end">
                                <button 
                                    onClick={() => setStep(2)}
                                    className="bg-[#2f314b] text-white px-8 py-3 rounded-md hover:bg-[#2f314b]/90 transition font-medium shadow-sm"
                                >
                                    Next: Condition Analysis
                                </button>
                            </div>
                        </div>
                    )}

                    {/* STEP 2: Condition Analysis */}
                    {step === 2 && (
                        <div className="space-y-8 print:hidden">
                            
                            {errorMsg && (
                                <div className="p-4 bg-red-50 text-red-700 rounded-md text-sm border border-red-200 shadow-sm">
                                    {errorMsg}
                                </div>
                            )}

                            {/* Main Room Section */}
                            <div className="bg-white border border-gray-200 p-6 rounded-lg shadow-sm">
                                <h3 className="text-lg font-semibold text-gray-900 mb-4">Main Room Photos ({tenancyInfo.roomIdentifier || 'Room'})</h3>
                                
                                <div className="space-y-4">
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                                        <div className="flex-1 border-2 border-dashed border-[#2f314b]/30 rounded-lg p-4 bg-[#2f314b]/5">
                                            <input 
                                                type="file" 
                                                multiple 
                                                accept="image/*"
                                                onChange={(e) => handleImageUpload(e, 'main')}
                                                ref={mainFileInputRef}
                                                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-[#2f314b] file:text-white hover:file:bg-[#2f314b]/90 cursor-pointer"
                                            />
                                        </div>
                                        {mainImages.length > 0 && (
                                            <div className="flex items-center gap-3">
                                                <span className="text-sm font-medium text-[#2f314b] bg-[#2f314b]/10 px-3 py-1 rounded-full">{mainImages.length} image(s)</span>
                                                <button onClick={() => clearImages('main')} className="text-sm text-red-600 hover:text-red-800 underline">Clear</button>
                                            </div>
                                        )}
                                    </div>

                                    <button 
                                        onClick={() => analyseImages('main')}
                                        disabled={isAnalysingMain || mainImages.length === 0}
                                        className={`w-full py-3 px-6 rounded-md font-bold text-white transition shadow-sm ${isAnalysingMain || mainImages.length === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-[#2f314b] hover:bg-[#2f314b]/90'}`}
                                    >
                                        {isAnalysingMain ? 'Analysing Images via AI...' : 'Generate AI Condition Report'}
                                    </button>

                                    {/* Progress Bar for Main Room */}
                                    {loadingState.active && loadingState.type === 'main' && (
                                        <div className="mt-4 bg-[#2f314b]/5 p-4 rounded-lg border border-[#2f314b]/10">
                                            <div className="flex justify-between text-xs text-[#2f314b] font-bold mb-2 uppercase tracking-wide">
                                                <span>{loadingState.text}</span>
                                                <span>{Math.round(loadingState.progress)}%</span>
                                            </div>
                                            <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                                                <div 
                                                    className="bg-[#2f314b] h-2.5 rounded-full transition-all duration-300 ease-out" 
                                                    style={{ width: `${loadingState.progress}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    )}

                                    {mainReport && (
                                        <div className="mt-6">
                                            <div className="flex justify-between items-end mb-2">
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700">Review & Edit Report:</label>
                                                    <p className="text-xs text-gray-500">Edit manually, or use the AI to polish your notes.</p>
                                                </div>
                                                <button 
                                                    onClick={() => polishText('main')}
                                                    disabled={isPolishingMain}
                                                    className="text-xs bg-[#2f314b]/10 text-[#2f314b] font-semibold px-3 py-1.5 rounded hover:bg-[#2f314b]/20 transition flex items-center gap-1"
                                                >
                                                    {isPolishingMain ? 'Polishing...' : '✨ Polish Text (Make Professional)'}
                                                </button>
                                            </div>
                                            <textarea 
                                                value={mainReport}
                                                onChange={(e) => setMainReport(e.target.value)}
                                                className="w-full p-4 border border-gray-300 rounded-md focus:ring-[#2f314b] focus:border-[#2f314b] text-sm h-64 font-mono leading-relaxed bg-gray-50"
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Ensuite Toggle */}
                            <div className="flex items-center space-x-3 bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                                <input 
                                    type="checkbox" 
                                    id="ensuiteToggle" 
                                    checked={hasEnsuite}
                                    onChange={(e) => setHasEnsuite(e.target.checked)}
                                    className="h-5 w-5 text-[#2f314b] rounded border-gray-300 focus:ring-[#2f314b]"
                                />
                                <label htmlFor="ensuiteToggle" className="font-medium text-gray-800 cursor-pointer select-none">
                                    Include Ensuite Bathroom in this report
                                </label>
                            </div>

                            {/* Ensuite Section */}
                            {hasEnsuite && (
                                <div className="bg-white border border-gray-200 p-6 rounded-lg shadow-sm border-t-4 border-t-[#2f314b]/60">
                                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Ensuite Photos</h3>
                                    
                                    <div className="space-y-4">
                                        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                                            <div className="flex-1 border-2 border-dashed border-[#2f314b]/30 rounded-lg p-4 bg-[#2f314b]/5">
                                                <input 
                                                    type="file" 
                                                    multiple 
                                                    accept="image/*"
                                                    onChange={(e) => handleImageUpload(e, 'ensuite')}
                                                    ref={ensuiteFileInputRef}
                                                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-[#2f314b] file:text-white hover:file:bg-[#2f314b]/90 cursor-pointer"
                                                />
                                            </div>
                                            {ensuiteImages.length > 0 && (
                                                <div className="flex items-center gap-3">
                                                    <span className="text-sm font-medium text-[#2f314b] bg-[#2f314b]/10 px-3 py-1 rounded-full">{ensuiteImages.length} image(s)</span>
                                                    <button onClick={() => clearImages('ensuite')} className="text-sm text-red-600 hover:text-red-800 underline">Clear</button>
                                                </div>
                                            )}
                                        </div>

                                        <button 
                                            onClick={() => analyseImages('ensuite')}
                                            disabled={isAnalysingEnsuite || ensuiteImages.length === 0}
                                            className={`w-full py-3 px-6 rounded-md font-bold text-white transition shadow-sm ${isAnalysingEnsuite || ensuiteImages.length === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-[#2f314b] hover:bg-[#2f314b]/90'}`}
                                        >
                                            {isAnalysingEnsuite ? 'Analysing Ensuite via AI...' : 'Generate AI Ensuite Report'}
                                        </button>

                                        {/* Progress Bar for Ensuite */}
                                        {loadingState.active && loadingState.type === 'ensuite' && (
                                            <div className="mt-4 bg-[#2f314b]/5 p-4 rounded-lg border border-[#2f314b]/10">
                                                <div className="flex justify-between text-xs text-[#2f314b] font-bold mb-2 uppercase tracking-wide">
                                                    <span>{loadingState.text}</span>
                                                    <span>{Math.round(loadingState.progress)}%</span>
                                                </div>
                                                <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                                                    <div 
                                                        className="bg-[#2f314b] h-2.5 rounded-full transition-all duration-300 ease-out" 
                                                        style={{ width: `${loadingState.progress}%` }}
                                                    ></div>
                                                </div>
                                            </div>
                                        )}

                                        {ensuiteReport && (
                                            <div className="mt-6">
                                                <div className="flex justify-between items-end mb-2">
                                                    <div>
                                                        <label className="block text-sm font-bold text-gray-700">Review & Edit Ensuite Report:</label>
                                                    </div>
                                                    <button 
                                                        onClick={() => polishText('ensuite')}
                                                        disabled={isPolishingEnsuite}
                                                        className="text-xs bg-[#2f314b]/10 text-[#2f314b] font-semibold px-3 py-1.5 rounded hover:bg-[#2f314b]/20 transition flex items-center gap-1"
                                                    >
                                                        {isPolishingEnsuite ? 'Polishing...' : '✨ Polish Text (Make Professional)'}
                                                    </button>
                                                </div>
                                                <textarea 
                                                    value={ensuiteReport}
                                                    onChange={(e) => setEnsuiteReport(e.target.value)}
                                                    className="w-full p-4 border border-gray-300 rounded-md focus:ring-[#2f314b] focus:border-[#2f314b] text-sm h-64 font-mono leading-relaxed bg-gray-50"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="pt-4 flex justify-between">
                                <button 
                                    onClick={() => setStep(1)}
                                    className="text-gray-600 px-6 py-2 hover:bg-gray-100 rounded-md transition font-medium border border-gray-300 bg-white"
                                >
                                    Back
                                </button>
                                <button 
                                    onClick={() => setStep(3)}
                                    className="bg-[#2f314b] text-white px-8 py-3 rounded-md hover:bg-[#2f314b]/90 transition font-bold shadow-sm"
                                >
                                    Continue to Final Report
                                </button>
                            </div>
                        </div>
                    )}

                    {/* STEP 3: Final Printable Report & LLM Tools */}
                    {step === 3 && (
                        <div className="space-y-8 print:space-y-0">
                            
                            {errorMsg && (
                                <div className="p-4 bg-red-50 text-red-700 rounded-md text-sm border border-red-200 shadow-sm print:hidden">
                                    {errorMsg}
                                </div>
                            )}

                            {/* Manager AI Tools (Hidden on Print) */}
                            <div className="print:hidden bg-indigo-50 border border-indigo-100 p-6 rounded-lg shadow-sm">
                                <h3 className="text-lg font-bold text-indigo-900 mb-4 flex items-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    Property Manager AI Tools
                                </h3>
                                <p className="text-sm text-indigo-800 mb-6">Use the data generated in your inventory report to instantly create useful management documents.</p>
                                
                                <div className="grid md:grid-cols-2 gap-6">
                                    {/* Tool 1: Maintenance Extractor */}
                                    <div className="bg-white p-4 rounded shadow-sm border border-indigo-100">
                                        <button 
                                            onClick={generateMaintenanceTasks}
                                            disabled={isGeneratingTasks || (!mainReport && !ensuiteReport)}
                                            className={`w-full py-2 px-4 rounded font-semibold text-white transition ${isGeneratingTasks || (!mainReport && !ensuiteReport) ? 'bg-indigo-300' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                                        >
                                            {isGeneratingTasks ? 'Extracting...' : '✨ Extract Maintenance Action Plan'}
                                        </button>
                                        {maintenanceTasks && (
                                            <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded text-sm whitespace-pre-wrap font-mono text-gray-700 h-40 overflow-y-auto">
                                                {maintenanceTasks}
                                            </div>
                                        )}
                                    </div>

                                    {/* Tool 2: Tenant Care Guide */}
                                    <div className="bg-white p-4 rounded shadow-sm border border-indigo-100">
                                        <button 
                                            onClick={generateTenantGuide}
                                            disabled={isGeneratingGuide || (!mainReport && !ensuiteReport)}
                                            className={`w-full py-2 px-4 rounded font-semibold text-white transition ${isGeneratingGuide || (!mainReport && !ensuiteReport) ? 'bg-teal-300' : 'bg-teal-600 hover:bg-teal-700'}`}
                                        >
                                            {isGeneratingGuide ? 'Writing Guide...' : '✨ Draft Tenant Welcome & Care Guide'}
                                        </button>
                                        {tenantGuide && (
                                            <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded text-sm whitespace-pre-wrap font-mono text-gray-700 h-40 overflow-y-auto">
                                                {tenantGuide}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Controls (Hidden on Print) */}
                            <div className="pt-2 flex justify-between print:hidden max-w-4xl mx-auto border-b pb-6 border-gray-200">
                                <button 
                                    onClick={() => setStep(2)}
                                    className="text-gray-600 px-6 py-2 hover:bg-gray-100 rounded-md transition font-medium border border-gray-300 bg-white"
                                >
                                    Back to Editor
                                </button>
                                <div className="flex gap-4">
                                    <button 
                                        onClick={handleEmailPDF}
                                        disabled={isDownloading}
                                        className={`px-6 py-3 rounded-md transition font-bold shadow-md flex items-center gap-2 ${isDownloading ? 'bg-blue-300 text-white cursor-wait' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                            <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                                            <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                                        </svg>
                                        Share / Email
                                    </button>
                                    <button 
                                        onClick={handleDownloadPDF}
                                        disabled={isDownloading}
                                        className={`px-8 py-3 rounded-md transition font-bold shadow-md flex items-center gap-2 ${isDownloading ? 'bg-[#2f314b]/70 text-white cursor-wait' : 'bg-[#2f314b] text-white hover:bg-[#2f314b]/90'}`}
                                    >
                                        {isDownloading ? (
                                            <span className="flex items-center gap-2">
                                                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                                Generating PDF...
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-2">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                  <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" />
                                                </svg>
                                                Download PDF Report
                                            </span>
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* The specific Arlington Park style printable container */}
                            <div className="bg-white p-10 print:p-0 w-full max-w-[210mm] mx-auto min-h-[297mm] text-gray-900 shadow-sm print:shadow-none" id="printable-report">
                                
                                {/* Header mirroring Arlington styling */}
                                <div className="mb-10 text-left">
                                    <img 
                                        src="https://www.arlingtonpark.co.uk/images/arlington-park-site-logo.png.pagespeed.ce.BJSqnaww-K.png" 
                                        alt="Arlington Park" 
                                        className="h-16 mb-6 object-contain" 
                                    />
                                    <h2 className="text-[20px] text-gray-900 font-medium" style={{fontFamily: "Arial, sans-serif"}}>
                                        Property Inventory & Schedule of Condition
                                    </h2>
                                </div>
                                
                                {/* Details Block */}
                                <div className="grid grid-cols-1 gap-2 mb-10 text-[15px] font-medium" style={{fontFamily: "Arial, sans-serif"}}>
                                    <div className="flex">
                                        <span className="w-48 font-semibold">Property Address:</span> 
                                        <span>{tenancyInfo.propertyAddress || ''}{tenancyInfo.propertyAddress && tenancyInfo.roomIdentifier ? ', ' : ''}{tenancyInfo.roomIdentifier ? `Room: ${tenancyInfo.roomIdentifier}` : ''}</span>
                                    </div>
                                    <div className="flex">
                                        <span className="w-48 font-semibold">Tenant Name:</span> 
                                        <span>{tenancyInfo.tenantName || ''}</span>
                                    </div>
                                    <div className="flex">
                                        <span className="w-48 font-semibold">Move-in Date:</span> 
                                        <span>{formatOrdinalDate(tenancyInfo.moveInDate)}</span>
                                    </div>
                                    <div className="flex">
                                        <span className="w-48 font-semibold">Inspection Date:</span> 
                                        <span>{formatOrdinalDate(tenancyInfo.dateOfInventory)}</span>
                                    </div>
                                    <div className="flex">
                                        <span className="w-48 font-semibold">Inspected By:</span> 
                                        <span>{tenancyInfo.clerkName || ''}</span>
                                    </div>
                                </div>

                                {/* Main Room Content */}
                                <div className="mb-8" style={{fontFamily: "Arial, sans-serif"}}>
                                    {mainReport ? renderReportText(mainReport) : <p className="text-gray-500 italic">No analysis generated yet.</p>}
                                </div>

                                {/* Ensuite Content */}
                                {hasEnsuite && ensuiteReport && (
                                    <div className="mt-8 pt-6 border-t border-gray-200" style={{fontFamily: "Arial, sans-serif"}}>
                                        <h3 className="text-xl font-bold mb-4 text-gray-900">Ensuite Bathroom</h3>
                                        {renderReportText(ensuiteReport)}
                                    </div>
                                )}

                                {/* Declaration Section */}
                                <div className="mt-16 break-inside-avoid print:break-inside-avoid" style={{fontFamily: "Arial, sans-serif"}}>
                                    <h3 className="text-lg font-bold mb-4">Declaration</h3>
                                    <p className="text-[15px] mb-8">This report is a fair and accurate representation of the property at the time of inspection.</p>
                                    
                                    <div className="space-y-4 text-[15px]">
                                        <p><strong>Signed (Agent):</strong> {tenancyInfo.clerkName || '_________________________'}</p>
                                        <p><strong>Date:</strong> {formatOrdinalDate(tenancyInfo.dateOfInventory) || '_________________________'}</p>
                                    </div>
                                </div>

                                {/* Image Appendix - 2x2 Grid Layout mimicking pages 3-13 */}
                                {(mainImages.length > 0 || ensuiteImages.length > 0) && (
                                    <div className="mt-16 break-before-page print:break-before-page" style={{fontFamily: "Arial, sans-serif"}}>
                                        <div className="grid grid-cols-2 gap-6 print:gap-4">
                                            {mainImages.map((img, index) => (
                                                <div key={`img-main-${index}`} className="break-inside-avoid print:break-inside-avoid flex flex-col h-full">
                                                    <img 
                                                        src={`data:${img.mimeType};base64,${img.data}`} 
                                                        className="w-full h-72 print:h-64 object-cover border border-gray-300 bg-gray-50" 
                                                        alt={`Main room ${index + 1}`} 
                                                    />
                                                </div>
                                            ))}
                                            {ensuiteImages.map((img, index) => (
                                                <div key={`img-en-${index}`} className="break-inside-avoid print:break-inside-avoid flex flex-col h-full">
                                                    <img 
                                                        src={`data:${img.mimeType};base64,${img.data}`} 
                                                        className="w-full h-72 print:h-64 object-cover border border-gray-300 bg-gray-50" 
                                                        alt={`Ensuite ${index + 1}`} 
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
        </div>
    );
}