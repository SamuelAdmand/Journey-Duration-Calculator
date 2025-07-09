// --- DOM element references ---
const apiKeyInput = document.getElementById('api-key-input');
const clearKeyBtn = document.getElementById('clear-key-btn');
const pasteArea = document.getElementById('paste-area');
const pastedImage = document.getElementById('pasted-image');
const clearImageBtn = document.getElementById('clear-image-btn');
const calculateBtn = document.getElementById('calculate-btn');
const btnText = document.getElementById('btn-text');
const loader = document.getElementById('loader');
const resultsSection = document.getElementById('results-section');
const successContent = document.getElementById('success-content');
const departureTimeEl = document.getElementById('departure-time');
const arrivalTimeEl = document.getElementById('arrival-time');
const totalTimeEl = document.getElementById('total-time');
const errorMessage = document.getElementById('error-message');
const errorText = document.getElementById('error-text');
const resetBtn = document.getElementById('reset-btn');
// Journey Breakdown elements
const journeySeg1El = document.getElementById('journey-seg-1');
const journeySeg2El = document.getElementById('journey-seg-2');
const journeySeg3El = document.getElementById('journey-seg-3');
// Food charge elements
const foodChargeDepartureEl = document.getElementById('food-charge-departure');
const foodChargeTransitEl = document.getElementById('food-charge-transit');
const foodChargeArrivalEl = document.getElementById('food-charge-arrival');
const foodChargeTotalEl = document.getElementById('food-charge-total');

let imageBase64 = null;
const API_KEY_STORAGE = 'googleAiApiKey';

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', loadApiKey);
document.addEventListener('paste', handlePaste);
document.addEventListener('keydown', handleEnterKey);
pasteArea.addEventListener('click', captureFromClipboard);
calculateBtn.addEventListener('click', processImage);
clearImageBtn.addEventListener('click', clearImage);
resetBtn.addEventListener('click', resetApp);
apiKeyInput.addEventListener('input', saveApiKey);
clearKeyBtn.addEventListener('click', clearApiKey);


// --- API Key Management ---
function loadApiKey() {
    const savedKey = localStorage.getItem(API_KEY_STORAGE);
    if (savedKey) {
        apiKeyInput.value = savedKey;
    }
    checkFormState();
}

function saveApiKey() {
    const key = apiKeyInput.value.trim();
    if (key) {
        localStorage.setItem(API_KEY_STORAGE, key);
    } else {
        localStorage.removeItem(API_KEY_STORAGE);
    }
    checkFormState();
}

function clearApiKey() {
    localStorage.removeItem(API_KEY_STORAGE);
    apiKeyInput.value = '';
    checkFormState();
}

// --- Core Functions ---
function checkFormState() {
    // Enable the calculate button only if both an API key and an image are present.
    const hasApiKey = apiKeyInput.value.trim() !== '';
    const hasImage = imageBase64 !== null;
    calculateBtn.disabled = !(hasApiKey && hasImage);
}

function resetApp() {
    clearImage();
    resultsSection.classList.add('hidden');
}

function handleEnterKey(e) {
    if (e.key === 'Enter' && !calculateBtn.disabled) {
        e.preventDefault();
        processImage();
    }
}

async function processImage() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        showError("Please enter your Google AI API key to proceed.");
        return;
    }
    if (!imageBase64) {
        showError("No image data available. Please paste an image first.");
        return;
    }

    setLoading(true);
    resultsSection.classList.add('hidden');
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const prompt = `From the provided image of a travel itinerary, identify the very first departure entry and the very last arrival entry. Extract their dates and times. Provide the output as a single JSON object with the keys "departure" and "arrival". The value for each key should be a string in the format "DD-MM-YYYY HH:MM". Example: {"departure": "18-02-2025 14:00", "arrival": "21-02-2025 00:50"}`;

    const payload = {
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/png", data: imageBase64 } }] }]
    };
    
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
             if (response.status === 403) {
                throw new Error(`API request failed with status 403 (Forbidden). Please check if your API key is correct and has the necessary permissions.`);
            }
            throw new Error(`API request failed with status ${response.status}`);
        }

        const result = await response.json();
        
        if (result.candidates && result.candidates[0].content && result.candidates[0].content.parts[0].text) {
            let text = result.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
            const parsedData = JSON.parse(text);
            calculateTimeDifference(parsedData.departure, parsedData.arrival);
        } else {
            if (result.candidates && result.candidates[0].finishReason) {
                 throw new Error(`Could not extract data. Reason: ${result.candidates[0].finishReason}. The model may have blocked the response for safety reasons.`);
            }
            throw new Error("Could not extract data from the image. The response was empty.");
        }
    } catch (error) {
        console.error("Error processing image:", error);
        showError("Failed to analyze image. Details: " + error.message);
    } finally {
        setLoading(false);
    }
}

function calculateTimeDifference(departureStr, arrivalStr) {
    try {
        departureTimeEl.textContent = departureStr || "Not found";
        arrivalTimeEl.textContent = arrivalStr || "Not found";

        if (!departureStr || !arrivalStr) throw new Error("Departure or arrival time could not be extracted.");

        const departureDate = parseDateString(departureStr);
        const arrivalDate = parseDateString(arrivalStr);

        if (isNaN(departureDate) || isNaN(arrivalDate)) throw new Error("Invalid date format extracted. Please ensure the image contains dates like DD-MM-YYYY HH:MM.");
        if (arrivalDate < departureDate) throw new Error("Arrival time cannot be before departure time.");

        // --- Calculation Logic ---
        const isSameDay = arrivalDate.toDateString() === departureDate.toDateString();
        
        let seg1_ms = 0, seg2_ms = 0, seg3_ms = 0;
        let departureFactor, arrivalFactor, transitDays;

        if (isSameDay) {
            // Journey is on a single day.
            seg1_ms = arrivalDate - departureDate;
            journeySeg1El.textContent = formatDuration(seg1_ms);
            journeySeg2El.textContent = "0 days";
            journeySeg3El.textContent = "N/A";
            
            const singleDayHours = seg1_ms / (1000 * 60 * 60);
            const allowance = getAllowance(singleDayHours);
            departureFactor = allowance.factor;
            arrivalFactor = 0;
            transitDays = 0;

            foodChargeDepartureEl.textContent = `Single Day Journey: ${allowance.text}`;
            foodChargeTransitEl.textContent = '0 days';
            foodChargeArrivalEl.textContent = 'N/A';
        } else {
            // Journey spans multiple days.
            const midnightAfterDeparture = new Date(departureDate);
            midnightAfterDeparture.setHours(24, 0, 0, 0);

            const midnightBeforeArrival = new Date(arrivalDate);
            midnightBeforeArrival.setHours(0, 0, 0, 0);

            seg1_ms = midnightAfterDeparture - departureDate;
            seg3_ms = arrivalDate - midnightBeforeArrival;
            seg2_ms = midnightBeforeArrival - midnightAfterDeparture;
            
            journeySeg1El.textContent = formatDuration(seg1_ms);
            journeySeg2El.textContent = formatDuration(seg2_ms, true);
            journeySeg3El.textContent = formatDuration(seg3_ms);

            const departureHours = seg1_ms / (1000 * 60 * 60);
            const departureAllowance = getAllowance(departureHours);
            departureFactor = departureAllowance.factor;
            foodChargeDepartureEl.textContent = departureAllowance.text;

            transitDays = seg2_ms < 0 ? 0 : Math.round(seg2_ms / (1000 * 60 * 60 * 24));
            foodChargeTransitEl.textContent = `${transitDays} day(s)`;

            const arrivalHours = seg3_ms / (1000 * 60 * 60);
            const arrivalAllowance = getAllowance(arrivalHours);
            arrivalFactor = arrivalAllowance.factor;
            foodChargeArrivalEl.textContent = arrivalAllowance.text;
        }
        
        const totalEffectiveDays = departureFactor + transitDays + arrivalFactor;
        foodChargeTotalEl.textContent = `${totalEffectiveDays.toFixed(2)} days`;

        const total_ms = arrivalDate - departureDate;
        totalTimeEl.textContent = formatDuration(total_ms);

        successContent.classList.remove('hidden');
        successContent.classList.add('fade-in');
        resultsSection.classList.remove('hidden');
        errorMessage.classList.add('hidden');

    } catch (error) {
        console.error("Calculation Error:", error);
        showError(error.message);
    }
}

// --- Helper Functions ---

function getAllowance(hours) {
    if (hours > 12) return { factor: 1.0, text: "Full Day (100%)" };
    if (hours > 6) return { factor: 0.7, text: "Partial Day (70%)" };
    if (hours > 0) return { factor: 0.3, text: "Partial Day (30%)" };
    return { factor: 0.0, text: "No charge (< 1 minute)"};
}

function formatDuration(ms, isDaysOnly = false) {
    if (ms < 0) ms = 0;
    
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    if (isDaysOnly) return `${days} day${days !== 1 ? 's' : ''}`;
    
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

    let parts = [];
    if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    
    return parts.length > 0 ? parts.join(' ') : "0 minutes";
}

function parseDateString(dateStr) {
    const [datePart, timePart] = dateStr.split(' ');
    const [day, month, year] = datePart.split('-');
    const [hours, minutes] = timePart.split(':');
    return new Date(`${year}-${month}-${day}T${hours}:${minutes}:00`);
}

// --- Clipboard and UI Functions ---
async function captureFromClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.read) {
        showError("Clipboard API not supported. Please paste the image manually.");
        return;
    }
    try {
        const items = await navigator.clipboard.read();
        let imageFile = null;
        for (const item of items) {
            const imageType = item.types.find(type => type.startsWith('image/'));
            if (imageType) {
                const blob = await item.getType(imageType);
                imageFile = new File([blob], "clipboard-image.png", { type: imageType });
                break; 
            }
        }
        if (imageFile) {
            displayPastedImage(imageFile);
        } else {
            showError("No image found in the clipboard. Please copy an image first.");
        }
    } catch (err) {
        handleClipboardError(err);
    }
}

function clearImage() {
    imageBase64 = null;
    pastedImage.src = "";
    pastedImage.classList.add('hidden');
    clearImageBtn.classList.add('hidden');
    pasteArea.classList.remove('hidden');
    checkFormState(); // Update button state
    successContent.classList.add('hidden');
    errorMessage.classList.add('hidden');
}

function handlePaste(e) {
    const items = e.clipboardData.items;
    let imageFile = null;
    for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
            imageFile = items[i].getAsFile();
            break;
        }
    }
    if (imageFile) {
        e.preventDefault();
        displayPastedImage(imageFile);
    }
}

function displayPastedImage(file) {
    if (!file || typeof file.type === 'undefined' || !file.type.startsWith('image/')) {
        console.error("displayPastedImage received an invalid object:", file);
        showError("Could not display the pasted item as it is not a valid image.");
        return;
    }

    const displayReader = new FileReader();
    displayReader.onload = (event) => {
        pastedImage.src = event.target.result;
        pastedImage.classList.remove('hidden');
        clearImageBtn.classList.remove('hidden');
        pasteArea.classList.add('hidden');
        resultsSection.classList.add('hidden');
        checkFormState(); // Update button state
    };
    displayReader.readAsDataURL(file);

    const apiReader = new FileReader();
    apiReader.onloadend = () => { imageBase64 = apiReader.result.split(',')[1]; };
    apiReader.readAsDataURL(file);
}

function handleClipboardError(err) {
    console.error("Clipboard read error:", err);
    let message = "Could not read from clipboard. Please paste manually.";
    if (err.name === 'NotAllowedError') message = "Permission to access clipboard denied. Please allow access or paste manually.";
    showError(message);
}

function setLoading(isLoading) {
    calculateBtn.disabled = isLoading;
    if (isLoading) {
        btnText.classList.add('hidden');
        loader.classList.remove('hidden');
    } else {
        btnText.classList.remove('hidden');
        loader.classList.add('hidden');
        checkFormState(); // Re-check state after loading finishes
    }
}

function showError(message) {
    errorText.textContent = message;
    errorMessage.classList.remove('hidden');
    errorMessage.classList.add('fade-in');
    resultsSection.classList.remove('hidden');
    successContent.classList.add('hidden');
}
