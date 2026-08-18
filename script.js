// ==========================================
// 1. FIREBASE ARCHITECTURE & INITIALIZATION
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, deleteDoc, getDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";

// ⚠️ KEEP YOUR EXACT WORKING FIREBASE CONFIG OBJECT STAYS HERE!
const firebaseConfig = {
    apiKey: "AIzaSyAPsXLrRm1yWGuVC3kFOBdAW27j5dtcJwg",
    authDomain: "fico-app-f3cea.firebaseapp.com",
    databaseURL: "https://fico-app-f3cea-default-rtdb.firebaseio.com",
    projectId: "fico-app-f3cea",
    storageBucket: "fico-app-f3cea.firebasestorage.app",
    messagingSenderId: "825347276766",
    appId: "1:825347276766:web:40f252b3aea9f3522d274f",
    measurementId: "G-NMFPPKNLFV"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
connectFunctionsEmulator(functions, "localhost", 5001);
const provider = new GoogleAuthProvider();

// Only allow regular web image links from the spreadsheet.
function getSafeImageUrl(value) {
    if (!value) return "";

    try {
        const url = new URL(value);
        return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch {
        return "";
    }
}

function setOptionalImage(imageElement, sourceUrl) {
    const imageUrl = getSafeImageUrl(sourceUrl);
    imageElement.onerror = null;
    imageElement.removeAttribute("src");
    imageElement.classList.add("hide");

    if (!imageUrl) return;

    imageElement.onerror = () => {
        imageElement.removeAttribute("src");
        imageElement.classList.add("hide");
    };
    imageElement.src = imageUrl;
    imageElement.classList.remove("hide");
}

// ==========================================
// 2. DYNAMIC SHEET CONFIGURATION & SYSTEM STATE
// ==========================================
const BASE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTTlH8ADzilx4j2pxVoBGaiptFK9fhhFxa3X2vk2u75KUsZjWFua-vQ5mo-Zt5OjUje8rsyeiFtawLB/pub?single=true&output=csv&gid=";

// The 3-tier configuration for Categories -> Subcategories -> Papers
const appStructure = [
    {
        id: "basics",
        title: "Basics and visual sciences",
        subcategories: [
            { id: "ico", title: "ICO oriented", gid: "1809191004" }, // ICO A
            { id: "rco", title: "RCO oriented", gid: "1811206417" } // RCO 1 basic
        ]
    },
    {
        id: "optics",
        title: "Optics and Refraction",
        subcategories: [
            { id: "ico", title: "ICO oriented", gid: "1224324948" }, // ICO B
            { id: "rco", title: "RCO oriented", gid: "1882977709" } // RCO 1 optics
        ]
    },
    {
        id: "clinical",
        title: "Clinical ophthalmology",
        subcategories: [
            { id: "ico", title: "ICO oriented", gid: "1104654783" }, // ICO C
            { id: "rco", title: "RCO oriented", gid: "279021325" }, // RCO 2
            { id: "clinical_adv", title: "Clinical advanced", gid: "2003570964" } // ICO D
        ]
    },
    /*
    {
        id: "inicet",
        title: "INICET - SS",
        subcategories: [
            { id: "all", title: "All Papers", gid: "1974187783" } // INI - SS
        ]
    },
    {
        id: "senior",
        title: "Senior Residency exams",
        subcategories: [
            { id: "all", title: "All Papers", gid: "2121725938" } // Senior residency
        ]
    }
    */
];

let quizPapers = {};
let allPapersMap = {};
let activeQuestions = [];
let currentQuestionIndex = 0;
let score = 0;
let hasAnswered = false;
let currentUser = null;
let currentPaperKey = null;

let isPremium = false; // FREEMIUM LOGIC
let selectedPaperKeyForModal = null;
let examMode = "practice"; // "practice" | "timed"
let timeRemaining = 0;
let totalExamDuration = 0;
let timerInterval = null;
let startTimeStamp = null;
let userAnswers = [];
let activeExamsMap = {};
let completedPapersMap = {};
let activeTab = "available";
let currentBookmarksMap = new Set();

// ==========================================
// 3. GOOGLE SHEET ASYNC CSV PARSER
// ==========================================
async function fetchQuestionsFromGoogleSheet() {
    try {
        quizPapers = {}; // Will hold the nested structure
        allPapersMap = {}; // Flat lookup map for quick access by paperKey

        // Fetch all subcategories across all categories in parallel
        const fetchPromises = [];

        appStructure.forEach((category) => {
            // Initialize this category
            quizPapers[category.id] = {
                title: category.title,
                subcategories: {}
            };

            category.subcategories.forEach((subcategory) => {
                // Initialize this subcategory
                quizPapers[category.id].subcategories[subcategory.id] = {
                    title: subcategory.title,
                    papers: {}
                };

                const promise = fetch(BASE_CSV_URL + subcategory.gid)
                    .then(response => response.text())
                    .then(csvText => {
                        const rows = csvText.split(/\r?\n/).map(row => row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/));

                        for (let i = 1; i < rows.length; i++) {
                            const columns = rows[i];
                            if (columns.length < 8 || !columns[0]) continue;

                            const paperName = columns[0].replace(/^"|"$/g, '').trim();
                            // Unique key: category_subcategory_paperName
                            const paperKey = `${category.id}_${subcategory.id}_${paperName.replace(/[^a-zA-Z0-9]/g, '')}`;

                            const question = columns[1].replace(/^"|"$/g, '').trim();
                            const option1 = columns[2].replace(/^"|"$/g, '').trim();
                            const option2 = columns[3].replace(/^"|"$/g, '').trim();
                            const option3 = columns[4].replace(/^"|"$/g, '').trim();
                            const option4 = columns[5].replace(/^"|"$/g, '').trim();
                            const correctIndex = parseInt(columns[6].trim(), 10);
                            const explanation = columns[7].replace(/^"|"$/g, '').trim();
                            const explanationImageUrl = (columns[8] || '').replace(/^"|"$/g, '').trim();
                            const questionImageUrl = (columns[9] || '').replace(/^"|"$/g, '').trim();

                            const subcatData = quizPapers[category.id].subcategories[subcategory.id];

                            if (!subcatData.papers[paperKey]) {
                                const newPaper = {
                                    title: paperName,
                                    questions: [],
                                    categoryId: category.id,
                                    subcategoryId: subcategory.id
                                };
                                subcatData.papers[paperKey] = newPaper;
                                allPapersMap[paperKey] = newPaper; // Flat map for quick access
                            }

                            subcatData.papers[paperKey].questions.push({
                                question: question,
                                options: [option1, option2, option3, option4],
                                correctIndex: correctIndex,
                                explanation: explanation,
                                explanationImageUrl: explanationImageUrl,
                                questionImageUrl: questionImageUrl
                            });
                        }
                    });
                fetchPromises.push(promise);
            });
        });

        await Promise.all(fetchPromises);
        console.log("Database initialized successfully with nested categories!", quizPapers);
    } catch (error) {
        console.error("Failed to load spreadsheet elements:", error);
    }
}

// ==========================================
// 4. HOMEPAGE TAB CONTROLLER & DATA LOADER
// ==========================================
async function fetchActiveExamsMap() {
    activeExamsMap = {};
    if (!currentUser) return;
    try {
        const querySnapshot = await getDocs(collection(db, "users", currentUser.uid, "activeExams"));
        querySnapshot.forEach(docSnap => {
            activeExamsMap[docSnap.id] = docSnap.data();
        });
    } catch (e) {
        console.error("Error fetching active exams map:", e);
    }
}

async function fetchCompletedPapersMap() {
    completedPapersMap = {};
    if (!currentUser) return;
    try {
        const querySnapshot = await getDocs(collection(db, "users", currentUser.uid, "completedPapers"));
        querySnapshot.forEach(docSnap => {
            completedPapersMap[docSnap.id] = docSnap.data();
        });
    } catch (e) {
        console.error("Error fetching completed papers map:", e);
    }
}

async function loadHomepage() {
    if (Object.keys(quizPapers).length === 0) {
        await fetchQuestionsFromGoogleSheet();
    }

    await fetchActiveExamsMap();
    await fetchCompletedPapersMap();

    window.renderCategories(); // Render the categories view initially

    syncBookmarksMap().then(() => {
        loadUserHistory();
        loadBookmarkedQuestions();
    });
}

window.renderCategories = function () {
    const papersListDiv = document.getElementById("papers-list");
    const backBtn = document.getElementById("back-to-categories-container");
    const titleText = document.getElementById("papers-list-title");

    if (!papersListDiv) return;
    papersListDiv.innerHTML = "";

    if (backBtn) backBtn.classList.add("hide");
    if (titleText) titleText.innerText = "Select a Category";

    // Loop over the Categories
    for (let categoryId in quizPapers) {
        const categoryData = quizPapers[categoryId];
        const categoryButton = document.createElement("button");
        categoryButton.classList.add("paper-card");

        let paperCount = 0;
        for (let subId in categoryData.subcategories) {
            paperCount += Object.keys(categoryData.subcategories[subId].papers).length;
        }

        categoryButton.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span style="font-size: 16px; font-weight: 600;">${categoryData.title}</span>
                <span style="font-size: 12px; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 12px;">${paperCount} Papers</span>
            </div>
        `;

        categoryButton.onclick = function () {
            window.renderSubcategories(categoryId);
        };

        papersListDiv.appendChild(categoryButton);
    }
};

window.renderSubcategories = function (categoryId) {
    const papersListDiv = document.getElementById("papers-list");
    const backBtn = document.getElementById("back-to-categories-container");
    const titleText = document.getElementById("papers-list-title");

    if (!papersListDiv) return;
    papersListDiv.innerHTML = "";

    const categoryData = quizPapers[categoryId];

    if (backBtn) {
        backBtn.classList.remove("hide");
        // Back button goes to Categories
        backBtn.innerHTML = `<button class="back-nav-btn" onclick="renderCategories()" style="background: transparent; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; color: #475569;">← Back to Categories</button>`;
    }
    if (titleText) titleText.innerText = categoryData.title;

    for (let subId in categoryData.subcategories) {
        const subData = categoryData.subcategories[subId];

        // Skip rendering the subcategory if it is just a placeholder "all" (e.g. INICET)
        // Instead, just render the papers directly for that category!
        if (subId === "all") {
            window.renderPapersForSubcategory(categoryId, subId, true);
            return;
        }

        const subButton = document.createElement("button");
        subButton.classList.add("paper-card");

        const paperCount = Object.keys(subData.papers).length;

        subButton.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span style="font-size: 16px; font-weight: 600;">${subData.title}</span>
                <span style="font-size: 12px; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 12px;">${paperCount} Papers</span>
            </div>
        `;

        subButton.onclick = function () {
            window.renderPapersForSubcategory(categoryId, subId, false);
        };

        papersListDiv.appendChild(subButton);
    }
};

window.renderPapersForSubcategory = function (categoryId, subcategoryId, fromCategoryLevel) {
    const papersListDiv = document.getElementById("papers-list");
    const backBtn = document.getElementById("back-to-categories-container");
    const titleText = document.getElementById("papers-list-title");

    if (!papersListDiv) return;
    papersListDiv.innerHTML = "";

    const categoryData = quizPapers[categoryId];
    const subData = categoryData.subcategories[subcategoryId];

    if (backBtn) {
        backBtn.classList.remove("hide");
        if (fromCategoryLevel) {
            backBtn.innerHTML = `<button class="back-nav-btn" onclick="renderCategories()" style="background: transparent; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; color: #475569;">← Back to Categories</button>`;
        } else {
            backBtn.innerHTML = `<button class="back-nav-btn" onclick="renderSubcategories('${categoryId}')" style="background: transparent; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; color: #475569;">← Back to ${categoryData.title}</button>`;
        }
    }

    if (titleText) {
        titleText.innerText = fromCategoryLevel ? categoryData.title : `${categoryData.title} ➔ ${subData.title}`;
    }

    for (let paperKey in subData.papers) {
        const paperData = subData.papers[paperKey];
        const paperButton = document.createElement("button");
        paperButton.classList.add("paper-card");

        const hasProgress = activeExamsMap[paperKey];
        const isCompleted = completedPapersMap[paperKey];

        // Freemium check: The first paper in every subcategory is free, except for clinical advanced.
        let isFreePaper = false;
        if (subcategoryId !== "clinical_adv") {
            const firstPaperKey = Object.keys(subData.papers)[0];
            if (paperKey === firstPaperKey) {
                isFreePaper = true;
            }
        }

        const isLocked = !isPremium && !isFreePaper;

        if (isLocked) {
            paperButton.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; opacity: 0.7;">
                    <span>${paperData.title}</span>
                    <span style="font-size: 11px; background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; padding: 2px 8px; border-radius: 12px; font-weight: 600;">
                        🔒 Premium
                    </span>
                </div>
            `;
            paperButton.onclick = function () {
                alert("This paper is locked. Please use the Beta Tester Access in your profile to unlock all papers for free!");
                window.openProfileModal();
            };
        } else if (hasProgress) {
            const savedData = activeExamsMap[paperKey];
            const qNum = (savedData.currentQuestionIndex || 0) + 1;
            const totalQ = paperData.questions?.length || 0;
            const modeIcon = savedData.examMode === "timed" ? "⏱️" : "📖";
            paperButton.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <span>${paperData.title}</span>
                    <span style="font-size: 11px; background: #fef3c7; color: #92400e; border: 1px solid #fde68a; padding: 2px 8px; border-radius: 12px; font-weight: 600;">
                        ⏳ In Progress (${modeIcon} Q${qNum}/${totalQ})
                    </span>
                </div>
            `;
            paperButton.onclick = function () {
                startQuiz(paperKey);
            };
        } else if (isCompleted) {
            const compData = completedPapersMap[paperKey];
            const modeIcon = compData.mode === "timed" ? "⏱️" : "📖";
            paperButton.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <span>${paperData.title}</span>
                    <span style="font-size: 11px; background: #e6f4ea; color: #166534; border: 1px solid #86efac; padding: 2px 8px; border-radius: 12px; font-weight: 600;">
                        ✓ Completed (${modeIcon} ${compData.score}/${compData.total})
                    </span>
                </div>
            `;
            paperButton.onclick = function () {
                startQuiz(paperKey);
            };
        } else {
            // Free paper or premium user
            const tag = (isFreePaper && !isPremium) ? `<span style="font-size: 11px; background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; padding: 2px 8px; border-radius: 12px; font-weight: 600;">🎁 Free</span>` : ``;
            paperButton.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <span>${paperData.title}</span>
                    ${tag}
                </div>
            `;
            paperButton.onclick = function () {
                startQuiz(paperKey);
            };
        }

        papersListDiv.appendChild(paperButton);
    }
};

window.switchTab = function (tabName) {
    activeTab = tabName;

    const availableContainer = document.getElementById("papers-list-container");
    const bookmarksSection = document.getElementById("bookmarks-section");

    const tabAvailableBtn = document.getElementById("tab-available");
    const tabBookmarksBtn = document.getElementById("tab-bookmarks");

    availableContainer.classList.add("hide");
    bookmarksSection.classList.add("hide");

    tabAvailableBtn.style.backgroundColor = "transparent"; tabAvailableBtn.style.color = "#64748b";
    tabBookmarksBtn.style.backgroundColor = "transparent"; tabBookmarksBtn.style.color = "#64748b";

    if (activeTab === "available") {
        availableContainer.classList.remove("hide");
        tabAvailableBtn.style.backgroundColor = "#ffffff"; tabAvailableBtn.style.color = "#2c3e50";
    } else if (activeTab === "bookmarks") {
        bookmarksSection.classList.remove("hide");
        tabBookmarksBtn.style.backgroundColor = "#ffffff"; tabBookmarksBtn.style.color = "#2c3e50";
        loadBookmarkedQuestions();
    }
}

async function loadUserHistory() {
    const historyList = document.getElementById("history-list");
    if (!currentUser || !historyList) return;

    try {
        const querySnapshot = await getDocs(collection(db, "users", currentUser.uid, "completedPapers"));
        historyList.innerHTML = "";

        if (querySnapshot.empty) {
            historyList.innerHTML = `<p style="color: #94a3b8; font-size: 13px; text-align: center; margin-top: 20px;">No quiz history compiled yet.</p>`;
        } else {
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const modeLabel = data.mode === "timed" ? "⏱️ Timed" : "📖 Practice";
                const modeClass = data.mode === "timed" ? "timed" : "practice";
                const timeStr = data.timeSpent ? ` • Time: ${data.timeSpent}` : "";

                const historyCard = document.createElement("div");
                historyCard.style = "background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.01);";
                historyCard.innerHTML = `
                    <div style="text-align: left;">
                        <strong style="color: #2c3e50;">${data.paperName}</strong>
                        <span class="mode-badge ${modeClass}">${modeLabel}</span><br>
                        <span style="font-size: 11px; color: #94a3b8;">Completed: ${data.dateCompleted}${timeStr}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-weight: bold; color: ${data.percentage >= 50 ? '#2a9d8f' : '#e76f51'}; background-color: ${data.percentage >= 50 ? '#e6f4ea' : '#fce8e6'}; padding: 4px 10px; border-radius: 20px; font-size: 13px;">
                            ${data.score}/${data.total} (${data.percentage}%)
                        </span>
                        <button onclick="reviewHistoryItem('${docSnap.id}')" style="background: #e0e7ff; color: #4338ca; border: 1px solid #c7d2fe; padding: 4px 8px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 600;">
                            Review 🔍
                        </button>
                    </div>
                `;
                historyList.appendChild(historyCard);
            });
        }
    } catch (error) {
        console.error("Error loading history:", error);
    }
}

window.reviewHistoryItem = function (paperKey) {
    const compData = completedPapersMap[paperKey];
    if (!compData || !allPapersMap[paperKey]) return;

    currentPaperKey = paperKey;
    activeQuestions = allPapersMap[paperKey].questions;
    score = compData.score || 0;
    examMode = compData.mode || "practice";
    userAnswers = compData.userAnswers || new Array(activeQuestions.length).fill(null);

    document.getElementById("home-screen").classList.add("hide");
    document.getElementById("quiz-screen").classList.remove("hide");
    document.body.classList.add("test-active");

    window.renderReviewScreen();
};

// ==========================================
// 5. BOOKMARK STORAGE MANAGEMENT LOGIC
// ==========================================
async function syncBookmarksMap() {
    if (!currentUser) { currentBookmarksMap.clear(); return; }
    try {
        const snap = await getDocs(collection(db, "users", currentUser.uid, "bookmarks"));
        currentBookmarksMap.clear();
        snap.forEach(doc => currentBookmarksMap.add(doc.id));
    } catch (e) { console.error(e); }
}

window.toggleCurrentBookmark = async function () {
    if (!currentUser) return alert("Please log in to save bookmarks!");

    const questionData = activeQuestions[currentQuestionIndex];
    const questionId = btoa(unescape(encodeURIComponent(questionData.question))).replace(/=/g, "").substring(0, 50);
    const docRef = doc(db, "users", currentUser.uid, "bookmarks", questionId);
    const btn = document.getElementById("bookmark-toggle-btn");

    if (currentBookmarksMap.has(questionId)) {
        await deleteDoc(docRef);
        currentBookmarksMap.delete(questionId);
        btn.style.background = "#f1f5f9"; btn.style.color = "#475569";
        btn.querySelector("span").innerText = "🔖";
    } else {
        await setDoc(docRef, {
            paperTitle: allPapersMap[currentPaperKey]?.title || currentPaperKey,
            questionText: questionData.question,
            options: questionData.options,
            correctAnswer: questionData.options[questionData.correctIndex],
            explanation: questionData.explanation,
            explanationImageUrl: questionData.explanationImageUrl || "",
            questionImageUrl: questionData.questionImageUrl || ""
        });
        currentBookmarksMap.add(questionId);
        btn.style.background = "#e0f2fe"; btn.style.color = "#0369a1";
        btn.querySelector("span").innerText = "⭐";
    }
}

async function loadBookmarkedQuestions() {
    const bookmarksList = document.getElementById("bookmarks-list");
    if (!currentUser || !bookmarksList) return;

    try {
        const querySnapshot = await getDocs(collection(db, "users", currentUser.uid, "bookmarks"));
        bookmarksList.innerHTML = "";

        if (querySnapshot.empty) {
            bookmarksList.innerHTML = `<p style="color: #94a3b8; font-size: 13px; text-align: center; margin-top: 20px;">No bookmarked questions saved yet.</p>`;
            return;
        }

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const card = document.createElement("div");
            card.style = "background-color: #ffffff; border: 1px solid #e2e8f0; padding: 18px; border-radius: 8px; text-align: left; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02);";

            let optionsHTML = "";
            data.options.forEach(opt => {
                const isCorrect = opt === data.correctAnswer;
                optionsHTML += `<div style="padding: 8px 12px; margin-top: 6px; border-radius: 6px; font-size: 13px; border: 1px solid ${isCorrect ? '#86efac' : '#e2e8f0'}; background-color: ${isCorrect ? '#f0fdf4' : '#f8fafc'}; color: ${isCorrect ? '#166534' : '#475569'}; font-weight: ${isCorrect ? '600' : '400'};">
                    ${opt} ${isCorrect ? '✓ (Correct)' : ''}
                </div>`;
            });

            const explanationImageUrl = getSafeImageUrl(data.explanationImageUrl);
            const explanationImageHTML = explanationImageUrl
                ? `<img class="bookmark-explanation-image" src="${explanationImageUrl}" alt="Explanation diagram">`
                : "";
            const questionImageUrl = getSafeImageUrl(data.questionImageUrl);
            const questionImageHTML = questionImageUrl
                ? `<img class="bookmark-question-image" src="${questionImageUrl}" alt="Question diagram">`
                : "";

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 8px;">
                    <span style="font-size: 11px; background-color:#f1f5f9; padding: 3px 8px; border-radius:12px; color:#64748b; font-weight:500;">${data.paperTitle}</span>
                    <button onclick="removeBookmarkFromDashboard('${docSnap.id}')" style="background:transparent; border:none; color:#ef4444; font-size:12px; cursor:pointer;">Remove ✕</button>
                </div>
                <h4 style="margin: 5px 0 12px 0; font-size: 15px; color:#1e293b; line-height:1.4;">${data.questionText}</h4>
                ${questionImageHTML}
                <div>${optionsHTML}</div>
                <div style="margin-top:12px; padding-top:12px; border-top:1px dashed #e2e8f0; font-size:13px; color:#64748b;">
                    <strong>Explanation:</strong> ${data.explanation}
                    ${explanationImageHTML}
                </div>
            `;
            bookmarksList.appendChild(card);
        });
    } catch (e) { console.error("Error loading bookmarks view layout:", e); }
}

window.removeBookmarkFromDashboard = async function (id) {
    if (!currentUser) return;
    await deleteDoc(doc(db, "users", currentUser.uid, "bookmarks", id));
    currentBookmarksMap.delete(id);
    loadBookmarkedQuestions();
}

// ==========================================
// 6. MODE SELECTION & TIMER CONTROLLERS
// ==========================================
window.selectModeOption = function (mode) {
    const cards = document.querySelectorAll(".mode-card");
    cards.forEach(card => card.classList.remove("selected"));

    const selectedInput = document.querySelector(`input[name="exam-mode"][value="${mode}"]`);
    if (selectedInput) {
        selectedInput.checked = true;
        selectedInput.closest(".mode-card").classList.add("selected");
    }

    const timerSettingsBox = document.getElementById("timer-settings-box");
    if (mode === "timed") {
        timerSettingsBox.classList.remove("hide");
    } else {
        timerSettingsBox.classList.add("hide");
    }
};

window.closeModeModal = function () {
    document.getElementById("mode-select-modal").classList.add("hide");
};

function openModeModal(paperKey) {
    selectedPaperKeyForModal = paperKey;
    const modal = document.getElementById("mode-select-modal");
    const modalTitle = document.getElementById("modal-paper-title");
    modalTitle.innerText = allPapersMap[paperKey]?.title || "Select Exam Mode";

    window.selectModeOption("practice");
    modal.classList.remove("hide");
}

window.confirmStartQuiz = function () {
    const selectedRadio = document.querySelector('input[name="exam-mode"]:checked');
    const mode = selectedRadio ? selectedRadio.value : "practice";
    const durationValue = document.getElementById("timer-duration-select").value;

    closeModeModal();
    launchQuiz(selectedPaperKeyForModal, mode, durationValue);
};

function openResumeModal(paperKey) {
    selectedPaperKeyForModal = paperKey;
    const modal = document.getElementById("resume-select-modal");
    const title = document.getElementById("resume-modal-title");
    const infoBox = document.getElementById("resume-info-box");

    const saved = activeExamsMap[paperKey];
    const totalQ = allPapersMap[paperKey]?.questions?.length || 0;
    const modeLabel = saved.examMode === "timed" ? "⏱️ Timed Exam Mode" : "📖 Practice Mode";

    let timerInfo = "";
    if (saved.examMode === "timed" && saved.timeRemaining) {
        timerInfo = `<br><strong>Time Remaining:</strong> ${formatTimeDisplay(saved.timeRemaining)}`;
    }

    title.innerText = `Resume: ${allPapersMap[paperKey]?.title || paperKey}`;
    infoBox.innerHTML = `
        <strong>Exam Mode:</strong> ${modeLabel}<br>
        <strong>Saved Progress:</strong> Question ${(saved.currentQuestionIndex || 0) + 1} of ${totalQ}${timerInfo}<br>
        <span style="font-size: 11px; color: #64748b;">Last saved: ${saved.lastSaved ? new Date(saved.lastSaved).toLocaleTimeString() : 'Recently'}</span>
    `;

    modal.classList.remove("hide");
}

window.closeResumeModal = function () {
    document.getElementById("resume-select-modal").classList.add("hide");
};

window.confirmResumeQuiz = function () {
    closeResumeModal();
    resumeQuiz(selectedPaperKeyForModal);
};

window.confirmStartFreshQuiz = async function () {
    closeResumeModal();
    await clearActiveExamState(selectedPaperKeyForModal);
    openModeModal(selectedPaperKeyForModal);
};

function resumeQuiz(paperKey) {
    const saved = activeExamsMap[paperKey];
    if (!saved) return launchQuiz(paperKey, "practice", "auto");

    resetQuizScreenDOM();
    currentPaperKey = paperKey;
    examMode = saved.examMode || "practice";
    activeQuestions = allPapersMap[paperKey].questions;
    currentQuestionIndex = saved.currentQuestionIndex || 0;
    score = saved.score || 0;
    userAnswers = saved.userAnswers || new Array(activeQuestions.length).fill(null);
    totalExamDuration = saved.totalExamDuration || 0;
    timeRemaining = saved.timeRemaining || 0;

    startTimeStamp = Date.now() - (totalExamDuration - timeRemaining) * 1000;

    document.getElementById("home-screen").classList.add("hide");
    document.getElementById("quiz-screen").classList.remove("hide");
    document.body.classList.add("test-active");

    const timerBadge = document.getElementById("quiz-timer-badge");

    if (examMode === "timed") {
        timerBadge.classList.remove("hide");
        startTimer();
    } else {
        stopTimer();
        timerBadge.classList.add("hide");
    }

    loadQuestion();

    if (userAnswers[currentQuestionIndex] !== null && userAnswers[currentQuestionIndex] !== undefined) {
        hasAnswered = true;
        const currentQuestion = activeQuestions[currentQuestionIndex];
        const optionButtons = document.querySelectorAll(".option-btn");
        const selectedIndex = userAnswers[currentQuestionIndex];

        optionButtons[currentQuestion.correctIndex].classList.add("correct");
        if (selectedIndex !== currentQuestion.correctIndex) {
            optionButtons[selectedIndex].classList.add("wrong");
        }

        document.getElementById("explanation-text").innerText = currentQuestion.explanation;
        setOptionalImage(
            document.getElementById("explanation-image"),
            currentQuestion.explanationImageUrl
        );
        document.getElementById("explanation-box").classList.remove("hide");
    }
}

async function saveActiveExamState() {
    if (!currentUser || !currentPaperKey || activeQuestions.length === 0) return;
    try {
        const activeDocRef = doc(db, "users", currentUser.uid, "activeExams", currentPaperKey);
        const dataToSave = {
            paperKey: currentPaperKey,
            paperTitle: allPapersMap[currentPaperKey]?.title || currentPaperKey,
            examMode: examMode,
            currentQuestionIndex: currentQuestionIndex,
            score: score,
            userAnswers: userAnswers,
            timeRemaining: timeRemaining,
            totalExamDuration: totalExamDuration,
            lastSaved: new Date().toISOString()
        };
        activeExamsMap[currentPaperKey] = dataToSave;
        await setDoc(activeDocRef, dataToSave);
    } catch (e) {
        console.error("Error saving active exam progress:", e);
    }
}

async function clearActiveExamState(paperKey) {
    if (!currentUser || !paperKey) return;
    try {
        await deleteDoc(doc(db, "users", currentUser.uid, "activeExams", paperKey));
        delete activeExamsMap[paperKey];
    } catch (e) {
        console.error("Error clearing active exam state:", e);
    }
}

function openCompletedModal(paperKey) {
    selectedPaperKeyForModal = paperKey;
    const modal = document.getElementById("completed-select-modal");
    const title = document.getElementById("completed-modal-title");
    const infoBox = document.getElementById("completed-info-box");

    const compData = completedPapersMap[paperKey];
    const modeLabel = compData.mode === "timed" ? "⏱️ Timed Exam Mode" : "📖 Practice Mode";
    const timeStr = compData.timeSpent ? `<br><strong>Time Taken:</strong> ${compData.timeSpent}` : "";

    title.innerText = `Completed: ${allPapersMap[paperKey]?.title || paperKey}`;
    infoBox.innerHTML = `
        <strong>Exam Mode:</strong> ${modeLabel}<br>
        <strong>Final Score:</strong> <span style="color: ${compData.percentage >= 50 ? '#2a9d8f' : '#e76f51'}; font-weight: bold;">${compData.score}/${compData.total} (${compData.percentage}%)</span>${timeStr}<br>
        <span style="font-size: 11px; color: #64748b;">Completed on: ${compData.dateCompleted || 'Recently'}</span>
    `;

    modal.classList.remove("hide");
}

window.closeCompletedModal = function () {
    document.getElementById("completed-select-modal").classList.add("hide");
};

window.confirmReviewCompletedQuiz = function () {
    closeCompletedModal();
    const paperKey = selectedPaperKeyForModal;
    const compData = completedPapersMap[paperKey];

    currentPaperKey = paperKey;
    activeQuestions = allPapersMap[paperKey].questions;
    score = compData.score || 0;
    examMode = compData.mode || "practice";
    userAnswers = compData.userAnswers || new Array(activeQuestions.length).fill(null);

    document.getElementById("home-screen").classList.add("hide");
    document.getElementById("quiz-screen").classList.remove("hide");
    document.body.classList.add("test-active");

    window.renderReviewScreen();
};

window.confirmRetakeCompletedQuiz = function () {
    closeCompletedModal();
    openModeModal(selectedPaperKeyForModal);
};

function startQuiz(paperKey) {
    if (!currentUser) return alert("Access Denied! You must log in with your Google Account to take exam papers.");
    if (activeExamsMap[paperKey]) {
        openResumeModal(paperKey);
    } else if (completedPapersMap[paperKey]) {
        openCompletedModal(paperKey);
    } else {
        openModeModal(paperKey);
    }
}

function launchQuiz(paperKey, mode, durationSetting) {
    resetQuizScreenDOM();
    currentPaperKey = paperKey;
    examMode = mode;
    activeQuestions = allPapersMap[paperKey].questions;
    currentQuestionIndex = 0;
    score = 0;
    userAnswers = new Array(activeQuestions.length).fill(null);
    startTimeStamp = Date.now();

    document.getElementById("home-screen").classList.add("hide");
    document.getElementById("quiz-screen").classList.remove("hide");
    document.body.classList.add("test-active");

    const timerBadge = document.getElementById("quiz-timer-badge");

    if (examMode === "timed") {
        let durationInMinutes = 0;
        if (durationSetting === "auto") {
            durationInMinutes = Math.max(1, Math.round(activeQuestions.length * 1.5));
        } else {
            durationInMinutes = parseInt(durationSetting, 10) || 15;
        }
        totalExamDuration = durationInMinutes * 60;
        timeRemaining = totalExamDuration;
        timerBadge.classList.remove("hide");
        startTimer();
    } else {
        stopTimer();
        timerBadge.classList.add("hide");
    }

    loadQuestion();
}

function startTimer() {
    stopTimer();
    updateTimerDisplay();
    timerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();
        if (timeRemaining <= 0) {
            stopTimer();
            autoSubmitExam();
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function formatTimeDisplay(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const pad = (num) => String(num).padStart(2, "0");
    if (hrs > 0) {
        return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
}

function updateTimerDisplay() {
    const timerText = document.getElementById("timer-text");
    const timerBadge = document.getElementById("quiz-timer-badge");

    if (timerText) {
        timerText.innerText = formatTimeDisplay(Math.max(0, timeRemaining));
    }

    if (timeRemaining > 0 && timeRemaining % 10 === 0) {
        saveActiveExamState();
    }

    if (timerBadge && totalExamDuration > 0) {
        const ratio = timeRemaining / totalExamDuration;
        if (ratio <= 0.1) {
            timerBadge.classList.remove("timer-warning");
            timerBadge.classList.add("timer-urgent");
        } else if (ratio <= 0.2) {
            timerBadge.classList.remove("timer-urgent");
            timerBadge.classList.add("timer-warning");
        } else {
            timerBadge.classList.remove("timer-warning", "timer-urgent");
        }
    }
}

function autoSubmitExam() {
    alert("⏰ Time's up! Your exam is automatically being submitted.");
    renderResultsScreen();
}

function updatePaletteUI() {
    const palette = document.getElementById("question-palette");
    if (!palette) return;

    palette.innerHTML = "";
    activeQuestions.forEach((_, i) => {
        const btn = document.createElement("button");
        btn.className = "palette-btn";
        btn.innerText = i + 1;

        if (userAnswers[i] !== null) {
            btn.classList.add("answered");
        }
        if (i === currentQuestionIndex) {
            btn.classList.add("current");
        }

        btn.onclick = () => jumpToQuestion(i);
        palette.appendChild(btn);
    });
}

window.jumpToQuestion = function (index) {
    saveActiveExamState();
    currentQuestionIndex = index;
    loadQuestion();
}

window.confirmSubmitEarly = function () {
    const unansweredCount = userAnswers.filter(a => a === null).length;
    if (unansweredCount > 0) {
        if (confirm(`You have ${unansweredCount} unanswered questions. Are you sure you want to submit the test?`)) {
            renderResultsScreen();
        }
    } else {
        renderResultsScreen();
    }
}

function loadQuestion() {
    const currentQuestion = activeQuestions[currentQuestionIndex];
    document.getElementById("question-text").innerText = currentQuestion.question;
    setOptionalImage(
        document.getElementById("question-image"),
        currentQuestion.questionImageUrl
    );

    const questionId = btoa(unescape(encodeURIComponent(currentQuestion.question))).replace(/=/g, "").substring(0, 50);
    const btn = document.getElementById("bookmark-toggle-btn");
    if (currentBookmarksMap.has(questionId)) {
        btn.style.background = "#e0f2fe"; btn.style.color = "#0369a1"; btn.querySelector("span").innerText = "⭐";
    } else {
        btn.style.background = "#f1f5f9"; btn.style.color = "#475569"; btn.querySelector("span").innerText = "🔖";
    }

    const optionButtons = document.querySelectorAll(".option-btn");
    optionButtons.forEach((button, index) => {
        button.innerText = currentQuestion.options[index];
        button.classList.remove("correct", "wrong", "selected-option");
    });

    document.getElementById("explanation-box").classList.add("hide");
    setOptionalImage(document.getElementById("explanation-image"), "");

    const totalQuestions = activeQuestions.length;
    const displayedQuestionNumber = currentQuestionIndex + 1;
    document.getElementById("progress-text").innerText = `Question ${displayedQuestionNumber} of ${totalQuestions}`;
    document.getElementById("progress-bar").style.width = ((displayedQuestionNumber / totalQuestions) * 100) + "%";

    updatePaletteUI();

    // Show submit early button and palette only in timed mode
    const submitBtn = document.getElementById("submit-early-btn");
    const nextBtn = document.getElementById("next-btn");
    const palette = document.getElementById("question-palette");

    if (examMode === "practice") {
        if (palette) palette.style.display = "none";
        if (submitBtn) submitBtn.style.display = "none";
    } else {
        if (palette) palette.style.display = "flex";
        if (submitBtn && activeQuestions.length > 0) submitBtn.style.display = "block";
    }

    if (userAnswers[currentQuestionIndex] !== null) {
        // Question was already answered
        hasAnswered = true;
        nextBtn.innerText = "Next Question ➡️";

        const selectedIndex = userAnswers[currentQuestionIndex];
        const correctIndex = currentQuestion.correctIndex;

        if (examMode === "practice") {
            optionButtons[correctIndex].classList.add("correct");
            if (selectedIndex !== correctIndex) {
                optionButtons[selectedIndex].classList.add("wrong");
            }

            document.getElementById("explanation-text").innerText = currentQuestion.explanation;
            setOptionalImage(
                document.getElementById("explanation-image"),
                currentQuestion.explanationImageUrl
            );
            document.getElementById("explanation-box").classList.remove("hide");
        } else {
            optionButtons[selectedIndex].classList.add("selected-option");
        }
    } else {
        // Question is unanswered
        hasAnswered = false;
        if (examMode === "practice") {
            nextBtn.innerText = "Next Question ➡️";
        } else {
            nextBtn.innerText = "Skip ⏭";
        }
        document.getElementById("explanation-box").classList.add("hide");
        setOptionalImage(document.getElementById("explanation-image"), "");
    }
}

window.checkAnswer = function (selectedIndex) {
    if (hasAnswered) return;
    hasAnswered = true;
    userAnswers[currentQuestionIndex] = selectedIndex;

    const currentQuestion = activeQuestions[currentQuestionIndex];
    const optionButtons = document.querySelectorAll(".option-btn");

    if (examMode === "practice") {
        optionButtons[currentQuestion.correctIndex].classList.add("correct");

        if (selectedIndex === currentQuestion.correctIndex) {
            score++;
        } else {
            optionButtons[selectedIndex].classList.add("wrong");
        }

        document.getElementById("explanation-text").innerText = currentQuestion.explanation;
        setOptionalImage(
            document.getElementById("explanation-image"),
            currentQuestion.explanationImageUrl
        );

        document.getElementById("explanation-box").classList.remove("hide");
    } else {
        optionButtons[selectedIndex].classList.add("selected-option");
        if (selectedIndex === currentQuestion.correctIndex) {
            score++;
        }
    }

    document.getElementById("next-btn").innerText = "Next Question ➡️";
    updatePaletteUI();

    saveActiveExamState();
};

const ORIGINAL_QUIZ_SCREEN_HTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 8px;">
            <button id="back-btn" onclick="goToHome()" style="margin: 0;">← Back to Home</button>
            <div id="quiz-timer-badge" class="hide" style="display: flex; align-items: center; gap: 6px; background: #e0e7ff; color: #3730a3; padding: 6px 12px; border-radius: 20px; font-weight: 700; font-size: 14px; border: 1px solid #c7d2fe;">
                <span>⏱️</span> <span id="timer-text">00:00</span>
            </div>
            <button id="bookmark-toggle-btn" onclick="toggleCurrentBookmark()" style="background: #f1f5f9; border: 1px solid #cbd5e1; color: #475569; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 4px;">
                <span>🔖</span> Bookmark Question
            </button>
        </div>
        
        <div class="progress-container">
            <div id="progress-bar"></div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <p id="progress-text" style="margin-bottom: 5px;">Question 0 of 0</p>
        </div>
        
        <!-- Question Palette -->
        <div id="question-palette" style="display: flex; gap: 8px; overflow-x: auto; padding: 10px 0; margin-bottom: 15px; border-bottom: 1px solid #e2e8f0; scrollbar-width: thin;">
            <!-- Palette buttons will be generated here -->
        </div>
        
        <h2 id="question-text">Question text will go here</h2>
        <img id="question-image" class="hide" alt="Question diagram">
        
        <div class="options-container">
            <button class="option-btn" onclick="checkAnswer(0)">Option 1</button>
            <button class="option-btn" onclick="checkAnswer(1)">Option 2</button>
            <button class="option-btn" onclick="checkAnswer(2)">Option 3</button>
            <button class="option-btn" onclick="checkAnswer(3)">Option 4</button>
        </div>

        <div id="explanation-box" class="hide" style="
            background-color: #f8fafc;
            border-left: 4px solid #3b82f6;
            padding: 15px;
            margin-bottom: 20px;
            border-radius: 4px 8px 8px 4px;
            text-align: left;
            font-size: 14px;
            color: #475569;
            line-height: 1.5;
        ">
            <strong>Explanation:</strong>
            <p id="explanation-text" class="explanation-text"></p>
            <img id="explanation-image" class="hide" alt="Explanation diagram">
        </div>

        <div style="display: flex; gap: 10px; margin-top: 10px;">
            <button id="submit-early-btn" onclick="confirmSubmitEarly()" style="background-color: #ef4444; color: white; border: none; padding: 12px; border-radius: 8px; font-size: 16px; cursor: pointer; flex: 1; display: none;">Submit Test</button>
            <button id="next-btn" onclick="nextQuestion()" style="flex: 2;">Skip ⏭</button>
        </div>
`;

function resetQuizScreenDOM() {
    const quizScreen = document.getElementById("quiz-screen");
    if (quizScreen) {
        quizScreen.innerHTML = ORIGINAL_QUIZ_SCREEN_HTML;
    }
}

window.renderResultsScreen = function () {
    stopTimer();
    const total = activeQuestions.length;
    const unansweredCount = userAnswers.filter(a => a === null).length;
    const wrongAnswers = total - score - unansweredCount;

    let correctPct = Math.round((score / total) * 100);
    let wrongPct = Math.round((wrongAnswers / total) * 100);
    let unansweredPct = 100 - correctPct - wrongPct;

    const timeSpentSeconds = Math.max(1, Math.round((Date.now() - (startTimeStamp || Date.now())) / 1000));
    const timeSpentFormatted = formatTimeDisplay(timeSpentSeconds);

    saveScoreToCloud(score, total, examMode, timeSpentFormatted);

    const modeLabel = examMode === "timed" ? "⏱️ Timed Mode" : "📖 Practice Mode";

    document.getElementById("quiz-screen").innerHTML = `
        <h2 class="results-title">Quiz Completed!</h2>
        <p class="results-subtitle">Here is your performance breakdown</p>
        <span class="mode-badge ${examMode}" style="font-size: 13px; padding: 4px 12px; margin-bottom: 15px; display: inline-block;">${modeLabel}</span>
        
        <div class="results-chart">
            <div class="results-pie" style="background: conic-gradient(var(--chart-correct) 0% ${correctPct}%, var(--chart-wrong) ${correctPct}% ${correctPct + wrongPct}%, var(--chart-unanswered) ${correctPct + wrongPct}% 100%);">
                <div class="results-donut-inner">${correctPct}%</div>
            </div>
        </div>
        
        <div class="results-legend">
            <div class="legend-item"><span class="legend-color correct-color"></span> Correct</div>
            <div class="legend-item"><span class="legend-color wrong-color"></span> Wrong</div>
            <div class="legend-item"><span class="legend-color unanswered-color"></span> Unanswered</div>
        </div>
        
        <div class="results-summary">
            <div class="stat-row"><span>Total Questions:</span> <strong>${total}</strong></div>
            <div class="stat-row"><span>Correct Answers:</span> <span class="stat-correct">${score} (${correctPct}%)</span></div>
            <div class="stat-row"><span>Wrong Answers:</span> <span class="stat-wrong">${wrongAnswers} (${wrongPct}%)</span></div>
            <div class="stat-row"><span>Unanswered:</span> <span class="stat-unanswered">${unansweredCount} (${unansweredPct}%)</span></div>
            <div class="stat-row"><span>Time Taken:</span> <strong>${timeSpentFormatted}</strong></div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 25px;">
            <button onclick="renderReviewScreen()" style="background-color: #4f46e5; color: white; border: none; padding: 12px 20px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <span>🔍</span> Review Test Answers
            </button>
            <button onclick="goToHome()" style="background-color: #2c3e50; color: white; border: none; padding: 12px 20px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <span>🏠</span> Return to Homepage
            </button>
        </div>
    `;
}

window.toggleReviewBookmark = async function (idx) {
    if (!currentUser) return alert("Please log in to save bookmarks!");

    const questionData = activeQuestions[idx];
    if (!questionData) return;

    const questionId = btoa(unescape(encodeURIComponent(questionData.question))).replace(/=/g, "").substring(0, 50);
    const docRef = doc(db, "users", currentUser.uid, "bookmarks", questionId);
    const btn = document.getElementById(`review-bookmark-btn-${idx}`);

    if (currentBookmarksMap.has(questionId)) {
        await deleteDoc(docRef);
        currentBookmarksMap.delete(questionId);
        if (btn) {
            btn.style.background = "#f1f5f9";
            btn.style.color = "#475569";
            btn.style.border = "1px solid #cbd5e1";
            btn.innerHTML = "<span>🔖</span> Bookmark";
        }
        const card = document.getElementById(`review-card-${idx}`);
        if (card) card.dataset.bookmarked = "false";
    } else {
        await setDoc(docRef, {
            paperTitle: allPapersMap[currentPaperKey]?.title || currentPaperKey,
            questionText: questionData.question,
            options: questionData.options,
            correctAnswer: questionData.options[questionData.correctIndex],
            explanation: questionData.explanation,
            explanationImageUrl: questionData.explanationImageUrl || "",
            questionImageUrl: questionData.questionImageUrl || ""
        });
        currentBookmarksMap.add(questionId);
        if (btn) {
            btn.style.background = "#e0f2fe";
            btn.style.color = "#0369a1";
            btn.style.border = "1px solid #bae6fd";
            btn.innerHTML = "<span>⭐</span> Bookmarked";
        }
        const card = document.getElementById(`review-card-${idx}`);
        if (card) card.dataset.bookmarked = "true";
    }
};

window.filterReviewCards = function (status) {
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`filter-btn-${status}`);
    if (activeBtn) activeBtn.classList.add('active');

    const cards = document.querySelectorAll('.review-card');
    cards.forEach(card => {
        if (status === 'all') {
            card.style.display = 'block';
        } else if (status === 'bookmarked') {
            card.style.display = card.dataset.bookmarked === 'true' ? 'block' : 'none';
        } else if (card.dataset.status === status) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
};

window.renderReviewScreen = function () {
    const paperTitle = allPapersMap[currentPaperKey]?.title || "Exam Paper";
    const total = activeQuestions.length;

    let reviewCardsHTML = "";

    activeQuestions.forEach((q, idx) => {
        const userChoice = userAnswers[idx];
        const isCorrect = userChoice === q.correctIndex;
        const isSkipped = userChoice === null || userChoice === undefined;

        const questionId = btoa(unescape(encodeURIComponent(q.question))).replace(/=/g, "").substring(0, 50);
        const isBookmarked = currentBookmarksMap.has(questionId);
        const bookmarkBtnStyle = isBookmarked
            ? "background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd;"
            : "background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;";
        const bookmarkBtnText = isBookmarked ? "<span>⭐</span> Bookmarked" : "<span>🔖</span> Bookmark";

        let statusBadgeHTML = "";
        let cardStatus = "wrong";
        if (isCorrect) {
            cardStatus = "correct";
            statusBadgeHTML = `<span class="review-status-badge correct">✓ Correct</span>`;
        } else if (isSkipped) {
            cardStatus = "unanswered";
            statusBadgeHTML = `<span class="review-status-badge skipped">⚠️ Unanswered</span>`;
        } else {
            cardStatus = "wrong";
            statusBadgeHTML = `<span class="review-status-badge wrong">✗ Incorrect</span>`;
        }

        let optionsHTML = "";
        q.options.forEach((optText, optIdx) => {
            const isTargetCorrect = optIdx === q.correctIndex;
            const isUserPicked = optIdx === userChoice;

            let optionClass = "review-option";
            let optionBadge = "";

            if (isTargetCorrect && isUserPicked) {
                optionClass += " correct-choice";
                optionBadge = " ✓ (Your Correct Answer)";
            } else if (isTargetCorrect) {
                optionClass += " correct-choice";
                optionBadge = " ✓ (Correct Answer)";
            } else if (isUserPicked) {
                optionClass += " user-wrong-choice";
                optionBadge = " ✗ (Your Choice)";
            }

            optionsHTML += `<div class="${optionClass}">
                <strong>${String.fromCharCode(65 + optIdx)}.</strong> ${optText} ${optionBadge}
            </div>`;
        });

        const qImageUrl = getSafeImageUrl(q.questionImageUrl);
        const qImageHTML = qImageUrl
            ? `<img class="bookmark-question-image" src="${qImageUrl}" alt="Question diagram">`
            : "";

        const expImageUrl = getSafeImageUrl(q.explanationImageUrl);
        const expImageHTML = expImageUrl
            ? `<img class="bookmark-explanation-image" src="${expImageUrl}" alt="Explanation diagram">`
            : "";

        reviewCardsHTML += `
            <div id="review-card-${idx}" class="review-card" data-status="${cardStatus}" data-bookmarked="${isBookmarked}">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <strong style="font-size: 13px; color: #64748b;">Question ${idx + 1} of ${total}</strong>
                        ${statusBadgeHTML}
                    </div>
                    <button id="review-bookmark-btn-${idx}" onclick="toggleReviewBookmark(${idx})" style="${bookmarkBtnStyle} padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; display: flex; align-items: center; gap: 4px;">
                        ${bookmarkBtnText}
                    </button>
                </div>
                <h4 style="margin: 0 0 12px 0; font-size: 15px; color: #1e293b; line-height: 1.4;">${q.question}</h4>
                ${qImageHTML}
                <div>${optionsHTML}</div>
                <div style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed #cbd5e1; font-size: 13px; color: #475569; line-height: 1.5;">
                    <strong>Explanation:</strong> ${q.explanation}
                    ${expImageHTML}
                </div>
            </div>
        `;
    });

    document.getElementById("quiz-screen").innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <button class="back-nav-btn" onclick="renderResultsScreen()" style="background: none; border: none; color: #475569; font-size: 14px; cursor: pointer; font-weight: 600;">← Back to Summary</button>
            <span class="review-title-text" style="font-size: 13px; font-weight: 600; color: #2c3e50;">Reviewing: ${paperTitle}</span>
        </div>
        
        <h2 style="font-size: 20px; color: #1e293b; margin-bottom: 5px; text-align: left;">Question Breakdown</h2>
        <p style="font-size: 13px; color: #64748b; margin-top: 0; margin-bottom: 20px; text-align: left;">Review your submitted answers and explanations below:</p>

        <div class="review-filters">
            <button id="filter-btn-all" class="filter-btn active" onclick="filterReviewCards('all')">All</button>
            <button id="filter-btn-correct" class="filter-btn" onclick="filterReviewCards('correct')">Correct</button>
            <button id="filter-btn-wrong" class="filter-btn" onclick="filterReviewCards('wrong')">Incorrect</button>
            <button id="filter-btn-unanswered" class="filter-btn" onclick="filterReviewCards('unanswered')">Unanswered</button>
            <button id="filter-btn-bookmarked" class="filter-btn" onclick="filterReviewCards('bookmarked')">Bookmarked</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 12px;">
            ${reviewCardsHTML}
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 25px;">
            <button class="solid-nav-btn" onclick="renderResultsScreen()" style="background-color: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;">← Back to Summary</button>
            <button onclick="goToHome()" style="background-color: #2c3e50; color: white; border: none; padding: 12px 20px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <span>🏠</span> Return to Homepage
            </button>
        </div>
    `;

    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.nextQuestion = function () {
    if (examMode === "practice" && !hasAnswered) {
        return alert("In Practice Mode, you must answer the question before moving to the next one!");
    }

    currentQuestionIndex++;
    saveActiveExamState();

    if (currentQuestionIndex < activeQuestions.length) {
        loadQuestion();
    } else {
        const unansweredCount = userAnswers.filter(a => a === null).length;
        if (unansweredCount > 0) {
            if (confirm(`You have ${unansweredCount} unanswered questions. Are you sure you want to submit the test?`)) {
                renderResultsScreen();
            } else {
                // Go back to the first unanswered question
                currentQuestionIndex = userAnswers.indexOf(null);
                loadQuestion();
            }
        } else {
            renderResultsScreen();
        }
    }
};

async function saveScoreToCloud(finalScore, totalQuestions, mode = "practice", timeSpentFormatted = "N/A") {
    if (!currentUser) return;
    try {
        const percentage = Math.round((finalScore / totalQuestions) * 100);
        const paperNameStr = allPapersMap[currentPaperKey]?.title || currentPaperKey;
        await setDoc(doc(db, "users", currentUser.uid, "completedPapers", currentPaperKey), {
            paperName: paperNameStr,
            score: finalScore,
            total: totalQuestions,
            percentage: percentage,
            mode: mode,
            timeSpent: timeSpentFormatted,
            userAnswers: userAnswers,
            dateCompleted: new Date().toLocaleDateString()
        });
        await clearActiveExamState(currentPaperKey);
    } catch (e) { console.error(e); }
}

window.goToHome = function () {
    const isQuizActive = document.getElementById("question-text") !== null;
    if (isQuizActive && currentPaperKey && activeQuestions.length > 0) {
        saveActiveExamState();
    }
    stopTimer();
    resetQuizScreenDOM();
    document.getElementById("quiz-screen").classList.add("hide");
    document.getElementById("home-screen").classList.remove("hide");
    document.body.classList.remove("test-active");
    loadHomepage();
};

// ==========================================
// 7. UTILITIES & AUTH MONITOR LISTENERS
// ==========================================
window.loginWithGoogle = function () {
    signInWithPopup(auth, provider).catch((e) => { alert("Login Failed: " + e.message); });
}

window.logout = function () {
    signOut(auth);
}

onAuthStateChanged(auth, async (user) => {
    const welcomeText = document.getElementById("user-welcome");
    const loginBtn = document.getElementById("login-btn");
    const logoutBtn = document.getElementById("logout-btn");

    if (user) {
        currentUser = user;

        // Fetch isPremium status
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists() && userDoc.data().isPremium) {
                isPremium = true;
            } else {
                isPremium = false;
            }
        } catch (e) {
            console.error("Error fetching premium status:", e);
            isPremium = false;
        }

        const premiumTag = isPremium
            ? `<span style="font-size: 11px; background: linear-gradient(45deg, #f59e0b, #fbbf24); color: white; padding: 2px 8px; border-radius: 12px; margin-left: 6px; font-weight: 600;">PRO</span>`
            : `<span style="font-size: 11px; background: #e2e8f0; color: #475569; padding: 2px 8px; border-radius: 12px; margin-left: 6px; font-weight: 600;">FREE</span>`;
        welcomeText.innerHTML = `Hello, ${user.displayName || "User"} ${premiumTag}`;
        loginBtn.classList.add("hide");
        logoutBtn.classList.remove("hide");
    } else {
        currentUser = null;
        isPremium = false;
        welcomeText.innerText = "Please log in →";
        loginBtn.classList.remove("hide");
        logoutBtn.classList.add("hide");
    }
    switchTab("available");
    loadHomepage();
});

// ==========================================
// RAZORPAY SUBSCRIPTION CHECKOUT
// ==========================================
window.claimBetaAccess = async function () {
    if (!currentUser) {
        alert("Please log in with Google to claim your Beta Tester access!");
        return window.loginWithGoogle();
    }

    if (isPremium) {
        alert("You are already a Premium member!");
        return;
    }

    const passcodeInput = document.getElementById("beta-passcode-input").value.trim().toUpperCase();
    if (!passcodeInput) {
        alert("Please enter a passcode.");
        return;
    }

    try {
        // Show loading state
        document.body.style.cursor = "wait";

        // Validate passcode in Firestore
        const passcodeRef = doc(db, "passcodes", passcodeInput);
        const passcodeSnap = await getDoc(passcodeRef);

        if (!passcodeSnap.exists()) {
            document.body.style.cursor = "default";
            alert("Invalid passcode. Please check your email for the correct code.");
            return;
        }

        const passcodeData = passcodeSnap.data();
        if (passcodeData.used) {
            document.body.style.cursor = "default";
            alert("This passcode has already been used! Each code is single-use only.");
            return;
        }

        // Mark passcode as used
        await setDoc(passcodeRef, {
            used: true,
            claimedBy: currentUser.uid,
            claimedAt: new Date().toISOString()
        }, { merge: true });

        // Update user in Firestore
        await setDoc(doc(db, "users", currentUser.uid), { isPremium: true }, { merge: true });

        isPremium = true;

        alert("Success! You now have full Premium Access. Thank you for your feedback!");

        // Force a reload of the UI
        loadHomepage();

        // Update profile UI
        const premiumTag = `<span style="font-size: 11px; background: linear-gradient(45deg, #f59e0b, #fbbf24); color: white; padding: 2px 8px; border-radius: 12px; margin-left: 6px; font-weight: 600;">PRO</span>`;
        document.getElementById("user-welcome").innerHTML = `Hello, ${currentUser.displayName || "User"} ${premiumTag}`;

        // Re-open profile modal to update the visual state
        window.openProfileModal();

        document.body.style.cursor = "default";
    } catch (error) {
        document.body.style.cursor = "default";
        console.error("Error claiming beta access:", error);
        alert("An error occurred while upgrading your account. Please try again.");
    }
};


// ==========================================
// 8. THEME MANAGEMENT
// ==========================================
window.toggleTheme = function () {
    document.body.classList.toggle("dark-mode");
    const isDark = document.body.classList.contains("dark-mode");
    localStorage.setItem("theme", isDark ? "dark" : "light");

    const themeBtn = document.getElementById("theme-toggle-btn");
    if (themeBtn) {
        themeBtn.innerText = isDark ? "🌙" : "☀️";
    }
};

// Initialize theme immediately
(function initTheme() {
    const savedTheme = localStorage.getItem("theme");
    const isDark = savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches);

    if (isDark) {
        document.body.classList.add("dark-mode");
    }

    // Use setTimeout to ensure DOM elements are parsed if this runs early
    setTimeout(() => {
        const themeBtn = document.getElementById("theme-toggle-btn");
        if (themeBtn) {
            themeBtn.innerText = isDark ? "🌙" : "☀️";
        }
    }, 0);
})();

// ==========================================
// 10. PROFILE MANAGEMENT
// ==========================================
window.openProfileModal = function () {
    if (!currentUser) return;

    document.getElementById("profile-name-input").value = currentUser.displayName || "";

    const statusDiv = document.getElementById("profile-subscription-status");
    const plansSection = document.getElementById("profile-plans-section");

    if (isPremium) {
        statusDiv.innerHTML = `<span style="color: #16a34a;">✅ Premium Member</span>`;
        plansSection.style.display = "none";
    } else {
        statusDiv.innerHTML = `<span style="color: #64748b;">Free Tier</span>`;
        plansSection.style.display = "block";
    }

    document.getElementById("home-screen").classList.add("hide");
    document.getElementById("quiz-screen").classList.add("hide");
    document.getElementById("profile-screen").classList.remove("hide");
};

window.closeProfileModal = function () {
    document.getElementById("profile-screen").classList.add("hide");
    document.getElementById("home-screen").classList.remove("hide");
};

window.saveProfileName = async function () {
    if (!currentUser) return;
    const newName = document.getElementById("profile-name-input").value.trim();
    if (!newName) return alert("Name cannot be empty!");

    try {
        await updateProfile(currentUser, { displayName: newName });

        // Update UI
        const premiumTag = isPremium
            ? `<span style="font-size: 11px; background: linear-gradient(45deg, #f59e0b, #fbbf24); color: white; padding: 2px 8px; border-radius: 12px; margin-left: 6px; font-weight: 600;">PRO</span>`
            : `<span style="font-size: 11px; background: #e2e8f0; color: #475569; padding: 2px 8px; border-radius: 12px; margin-left: 6px; font-weight: 600;">FREE</span>`;
        document.getElementById("user-welcome").innerHTML = `Hello, ${newName} ${premiumTag}`;

        alert("Profile name updated successfully!");
    } catch (error) {
        console.error("Error updating profile:", error);
        alert("Failed to update profile name.");
    }
};
(function initContentProtection() {
    // Disable right click (context menu)
    document.addEventListener('contextmenu', event => event.preventDefault());

    // Disable copy, cut, paste
    document.addEventListener('copy', event => event.preventDefault());
    document.addEventListener('cut', event => event.preventDefault());
    document.addEventListener('paste', event => event.preventDefault());

    // Disable keyboard shortcuts (Ctrl+C, Cmd+C, Ctrl+P, Cmd+P, Ctrl+S, Cmd+S, PrintScreen, etc.)
    document.addEventListener('keydown', event => {
        // Prevent PrintScreen (some browsers)
        if (event.key === 'PrintScreen') {
            navigator.clipboard.writeText('');
            event.preventDefault();
        }

        // Check for Ctrl or Cmd key combinations
        if (event.ctrlKey || event.metaKey) {
            const forbiddenKeys = ['c', 'p', 's', 'x', 'a']; // Copy, Print, Save, Cut, Select All
            if (forbiddenKeys.includes(event.key.toLowerCase())) {
                event.preventDefault();
            }
        }
    });

    // Attempt to clear clipboard if window loses focus (Screenshot deterrent)
    window.addEventListener('blur', () => {
        try {
            navigator.clipboard.writeText('');
        } catch (err) {
            // Ignore errors
        }
    });
})();
