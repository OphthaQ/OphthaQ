// ==========================================
// 1. FIREBASE ARCHITECTURE & INITIALIZATION
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, deleteDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// ==========================================
// 2. DYNAMIC SHEET CONFIGURATION & SYSTEM STATE
// ==========================================
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTTlH8ADzilx4j2pxVoBGaiptFK9fhhFxa3X2vk2u75KUsZjWFua-vQ5mo-Zt5OjUje8rsyeiFtawLB/pub?gid=1841373573&single=true&output=csv";

const paperTitlesMap = {
    ficoA: "FICO part A",
    ficoB: "FICO part B",
    ficoC: "FICO part C",
    ficoD: "FICO part D",
    seniorResidency: "Senior residency exam papers"
};

let quizPapers = {}; 
let activeQuestions = [];
let currentQuestionIndex = 0;
let score = 0;
let hasAnswered = false;
let currentUser = null;
let currentPaperKey = "";
let activeTab = "available";
let currentBookmarksMap = new Set();

// ==========================================
// 3. GOOGLE SHEET ASYNC CSV PARSER
// ==========================================
async function fetchQuestionsFromGoogleSheet() {
    try {
        const response = await fetch(GOOGLE_SHEET_CSV_URL);
        const csvText = await response.text();
        
        const rows = csvText.split(/\r?\n/).map(row => row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)); 
        quizPapers = {};

        for (let i = 1; i < rows.length; i++) {
            const columns = rows[i];
            if (columns.length < 8 || !columns[0]) continue; 

            const paperKey = columns[0].trim();
            const question = columns[1].replace(/^"|"$/g, '').trim();
            const option1 = columns[2].replace(/^"|"$/g, '').trim();
            const option2 = columns[3].replace(/^"|"$/g, '').trim();
            const option3 = columns[4].replace(/^"|"$/g, '').trim();
            const option4 = columns[5].replace(/^"|"$/g, '').trim();
            const correctIndex = parseInt(columns[6].trim(), 10);
            const explanation = columns[7].replace(/^"|"$/g, '').trim();

            if (!quizPapers[paperKey]) {
                quizPapers[paperKey] = {
                    title: paperTitlesMap[paperKey] || paperKey,
                    questions: []
                };
            }

            quizPapers[paperKey].questions.push({
                question: question,
                options: [option1, option2, option3, option4],
                correctIndex: correctIndex,
                explanation: explanation
            });
        }
        console.log("Database initialized successfully from Google Sheets!", quizPapers);
    } catch (error) {
        console.error("Failed to load spreadsheet elements:", error);
    }
}

// ==========================================
// 4. HOMEPAGE TAB CONTROLLER & DATA LOADER
// ==========================================
async function loadHomepage() {
    if (Object.keys(quizPapers).length === 0) {
        await fetchQuestionsFromGoogleSheet();
    }

    const papersListDiv = document.getElementById("papers-list");
    if (!papersListDiv) return;
    papersListDiv.innerHTML = ""; 

    for (let key in quizPapers) {
        const paperButton = document.createElement("button");
        paperButton.classList.add("paper-card");
        paperButton.innerText = quizPapers[key].title;
        
        paperButton.onclick = function() {
            startQuiz(key);
        };
        
        papersListDiv.appendChild(paperButton);
    }

    syncBookmarksMap().then(() => {
        loadUserHistory();
        loadBookmarkedQuestions();
    });
}

window.switchTab = function(tabName) {
    activeTab = tabName;
    
    const availableContainer = document.getElementById("papers-list-container");
    const historySection = document.getElementById("history-section");
    const bookmarksSection = document.getElementById("bookmarks-section");
    
    const tabAvailableBtn = document.getElementById("tab-available");
    const tabCompletedBtn = document.getElementById("tab-completed");
    const tabBookmarksBtn = document.getElementById("tab-bookmarks");

    availableContainer.classList.add("hide");
    historySection.classList.add("hide");
    bookmarksSection.classList.add("hide");
    
    tabAvailableBtn.style.backgroundColor = "transparent"; tabAvailableBtn.style.color = "#64748b";
    tabCompletedBtn.style.backgroundColor = "transparent"; tabCompletedBtn.style.color = "#64748b";
    tabBookmarksBtn.style.backgroundColor = "transparent"; tabBookmarksBtn.style.color = "#64748b";

    if (activeTab === "available") {
        availableContainer.classList.remove("hide");
        tabAvailableBtn.style.backgroundColor = "#ffffff"; tabAvailableBtn.style.color = "#2c3e50";
    } else if (activeTab === "completed") {
        historySection.classList.remove("hide");
        tabCompletedBtn.style.backgroundColor = "#ffffff"; tabCompletedBtn.style.color = "#2c3e50";
        loadUserHistory();
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
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                const historyCard = document.createElement("div");
                historyCard.style = "background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.01);";
                historyCard.innerHTML = `
                    <div style="text-align: left;">
                        <strong style="color: #2c3e50;">${data.paperName}</strong><br>
                        <span style="font-size: 11px; color: #94a3b8;">Completed: ${data.dateCompleted}</span>
                    </div>
                    <span style="font-weight: bold; color: ${data.percentage >= 50 ? '#2a9d8f' : '#e76f51'}; background-color: ${data.percentage >= 50 ? '#e6f4ea' : '#fce8e6'}; padding: 4px 10px; border-radius: 20px; font-size: 13px;">
                        ${data.score}/${data.total} (${data.percentage}%)
                    </span>
                `;
                historyList.appendChild(historyCard);
            });
        }
    } catch (error) {
        console.error("Error loading history:", error);
    }
}

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

window.toggleCurrentBookmark = async function() {
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
            paperTitle: quizPapers[currentPaperKey]?.title || currentPaperKey,
            questionText: questionData.question,
            options: questionData.options,
            correctAnswer: questionData.options[questionData.correctIndex],
            explanation: questionData.explanation
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

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 8px;">
                    <span style="font-size: 11px; background-color:#f1f5f9; padding: 3px 8px; border-radius:12px; color:#64748b; font-weight:500;">${data.paperTitle}</span>
                    <button onclick="removeBookmarkFromDashboard('${docSnap.id}')" style="background:transparent; border:none; color:#ef4444; font-size:12px; cursor:pointer;">Remove ✕</button>
                </div>
                <h4 style="margin: 5px 0 12px 0; font-size: 15px; color:#1e293b; line-height:1.4;">${data.questionText}</h4>
                <div>${optionsHTML}</div>
                <div style="margin-top:12px; padding-top:12px; border-top:1px dashed #e2e8f0; font-size:13px; color:#64748b;">
                    <strong>Explanation:</strong> ${data.explanation}
                </div>
            `;
            bookmarksList.appendChild(card);
        });
    } catch (e) { console.error("Error loading bookmarks view layout:", e); }
}

window.removeBookmarkFromDashboard = async function(id) {
    if (!currentUser) return;
    await deleteDoc(doc(db, "users", currentUser.uid, "bookmarks", id));
    currentBookmarksMap.delete(id);
    loadBookmarkedQuestions();
}

// ==========================================
// 6. QUIZ WORKFLOW CONTROLLERS
// ==========================================
function startQuiz(paperKey) {
    if (!currentUser) return alert("Access Denied! You must log in with your Google Account to take exam papers.");

    currentPaperKey = paperKey;
    activeQuestions = quizPapers[paperKey].questions;
    currentQuestionIndex = 0;
    score = 0;

    document.getElementById("home-screen").classList.add("hide");
    document.getElementById("quiz-screen").classList.remove("hide");

    loadQuestion();
}

function loadQuestion() {
    hasAnswered = false;
    const currentQuestion = activeQuestions[currentQuestionIndex];
    document.getElementById("question-text").innerText = currentQuestion.question;
    
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
        button.classList.remove("correct", "wrong");
    });

    document.getElementById("explanation-box").classList.add("hide");

    const totalQuestions = activeQuestions.length;
    const displayedQuestionNumber = currentQuestionIndex + 1;
    document.getElementById("progress-text").innerText = `Question ${displayedQuestionNumber} of ${totalQuestions}`;
    document.getElementById("progress-bar").style.width = ((displayedQuestionNumber / totalQuestions) * 100) + "%";
}

window.checkAnswer = function(selectedIndex) {
    if (hasAnswered) return;
    hasAnswered = true;

    const currentQuestion = activeQuestions[currentQuestionIndex];
    const optionButtons = document.querySelectorAll(".option-btn");
    
    optionButtons[currentQuestion.correctIndex].classList.add("correct");

    if (selectedIndex === currentQuestion.correctIndex) {
        score++;
    } else {
        optionButtons[selectedIndex].classList.add("wrong");
    }

    document.getElementById("explanation-text").innerText = currentQuestion.explanation;
    document.getElementById("explanation-box").classList.remove("hide");
}

window.nextQuestion = function() {
    if (!hasAnswered) return alert("Please select an answer first!");

    currentQuestionIndex++;
    
    if (currentQuestionIndex < activeQuestions.length) {
        loadQuestion();
    } else {
        const total = activeQuestions.length;
        const wrongAnswers = total - score;
        const correctPercentage = Math.round((score / total) * 100);
        const wrongPercentage = Math.round((wrongAnswers / total) * 100);

        document.getElementById("back-btn").classList.add("hide");
        saveScoreToCloud(score, total);

        document.getElementById("quiz-screen").innerHTML = `
            <h2 style="color: #2c3e50; margin-bottom: 5px;">Quiz Completed!</h2>
            <p style="color: #7f8c8d; font-size: 14px; margin-top: 0; margin-bottom: 25px;">Here is your performance breakdown</p>
            <div style="width: 160px; height: 160px; border-radius: 50%; margin: 20px auto; box-shadow: 0 8px 24px rgba(0,0,0,0.06); background: conic-gradient(#2a9d8f 0% ${correctPercentage}%, #e76f51 ${correctPercentage}% 100%);"></div>
            <div style="display: flex; justify-content: center; gap: 24px; margin-bottom: 25px; font-size: 14px; font-weight: 500;">
                <div style="display: flex; align-items: center; gap: 8px; color: #2c3e50;"><span style="width: 12px; height: 12px; border-radius: 50%; background-color: #2a9d8f; display: inline-block;"></span> Correct</div>
                <div style="display: flex; align-items: center; gap: 8px; color: #2c3e50;"><span style="width: 12px; height: 12px; border-radius: 50%; background-color: #e76f51; display: inline-block;"></span> Wrong</div>
            </div>
            <div class="results-summary" style="border: 1px solid #f1f5f9; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
                <div class="stat-row"><span>Total Questions:</span> <strong>${total}</strong></div>
                <div class="stat-row"><span>Correct Answers:</span> <span style="color: #2a9d8f; font-weight: bold;">${score} (${correctPercentage}%)</span></div>
                <div class="stat-row"><span>Wrong Answers:</span> <span style="color: #e76f51; font-weight: bold;">${wrongAnswers} (${wrongPercentage}%)</span></div>
            </div>
            <button id="next-btn" onclick="location.reload()" style="margin-top: 20px; background-color: #2c3e50;">Return to Homepage</button>
        `;
    }
}

async function saveScoreToCloud(finalScore, totalQuestions) {
    if (!currentUser) return;
    try {
        const percentage = Math.round((finalScore / totalQuestions) * 100);
        const paperNameStr = quizPapers[currentPaperKey]?.title || currentPaperKey;
        await setDoc(doc(db, "users", currentUser.uid, "completedPapers", currentPaperKey), {
            paperName: paperNameStr,
            score: finalScore,
            total: totalQuestions,
            percentage: percentage,
            dateCompleted: new Date().toLocaleDateString()
        });
    } catch (e) { console.error(e); }
}

window.goToHome = function() {
    document.getElementById("quiz-screen").classList.add("hide");
    document.getElementById("home-screen").classList.remove("hide");
}

// ==========================================
// 7. UTILITIES & AUTH MONITOR LISTENERS
// ==========================================
window.loginWithGoogle = function() {
    signInWithPopup(auth, provider).catch((e) => { alert("Login Failed: " + e.message); });
}

window.logout = function() {
    signOut(auth);
}

onAuthStateChanged(auth, (user) => {
    const welcomeText = document.getElementById("user-welcome");
    const loginBtn = document.getElementById("login-btn");
    const logoutBtn = document.getElementById("logout-btn");

    if (user) {
        currentUser = user;
        welcomeText.innerText = `Hello, ${user.displayName || "User"}`;
        loginBtn.classList.add("hide");
        logoutBtn.classList.remove("hide");
    } else {
        currentUser = null;
        welcomeText.innerText = "Please log in →";
        loginBtn.classList.remove("hide");
        logoutBtn.classList.add("hide");
    }
    switchTab("available");
    loadHomepage();
});