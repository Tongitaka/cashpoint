let currentOperator = 'Mvola';

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDB();
        await checkAutoReset(); 
        await refreshUI();
    } catch (err) {
        console.error("Initialization error:", err);
    }

    const savedTheme = localStorage.getItem('cashpoint_theme') || 'light';
    setTheme(savedTheme);

    document.addEventListener('deviceready', onNativeDeviceReady, false);
});

function onNativeDeviceReady() {
    initSMSListener();
}

function toggleTheme() {
    const current = document.body.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    setTheme(next);
}

function setTheme(themeName) {
    document.body.setAttribute('data-theme', themeName);
    localStorage.setItem('cashpoint_theme', themeName);
    document.getElementById('theme-btn').innerText = themeName === 'dark' ? '☀️' : '🌙';
}

async function checkAutoReset() {
    const now = new Date();
    const currentDate = now.getDate();
    const currentMonth = now.getMonth();
    const lastResetMonth = localStorage.getItem('lastResetMonth');

    if (currentDate === 1 && lastResetMonth != currentMonth) {
        await clearDatabase();
        localStorage.setItem('lastResetMonth', currentMonth);
        alert("🗓️ Tonga ny 1-n'ny volana vaovao! Voafafa ho azy (Auto-Reset) ny Bokin'ny Vola.");
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    document.getElementById(`tab-${tabName}`).classList.add('active');
    
    const navIndex = tabName === 'dashboard' ? 0 : tabName === 'journal' ? 1 : 2;
    document.querySelectorAll('.nav-item')[navIndex].classList.add('active');

    if (tabName === 'journal' || tabName === 'dashboard') refreshUI();
}

function selectOperator(opName) {
    currentOperator = opName;
    const input = document.getElementById('selected-op');
    const ussdInput = document.getElementById('ussd-code');

    if (opName === 'Mvola') {
        input.value = "Mvola";
        ussdInput.placeholder = "*141# na *141*1*1*034XXXXXXX*50000#";
    } else if (opName === 'Orange') {
        input.value = "Orange Money";
        ussdInput.placeholder = "*144# na *144*1*1*032XXXXXXX*50000#";
    } 
}

function launchUSSDCall() {
    const code = document.getElementById('ussd-code').value.trim();
    if (!code) { alert("Apetraho aloha ny kaody USSD ho lancena!"); return; }
    const formattedCode = code.replace(/#/g, '%23');
    if (window.plugins && window.plugins.callNumber) {
        window.plugins.callNumber.callNumber(() => {}, (err) => alert("Tsy nahalasa ny appel: " + err), formattedCode, true);
    } else {
        window.location.href = `tel:${formattedCode}`;
    }
}

function lancerAchatCreditMvola() {
    const ussdCode = encodeURIComponent("#111*1#");
    if (window.plugins && window.plugins.callNumber) {
        window.plugins.callNumber.callNumber(() => {}, (err) => alert("Tsy nahalasa ny appel: " + err), ussdCode, true);
    } else { window.location.href = `tel:${ussdCode}`; }
}

async function lancerTestSMSUnique() {
    const sender = document.getElementById('test-sender').value;
    const body = document.getElementById('test-sms-body').value.trim();

    if (!body) {
        alert("Soraty na apetaho ao anaty textarea ny endriky ny SMS fitsapana!");
        return;
    }

    await processIncomingSMS(sender, body);
    document.getElementById('test-sms-body').value = '';
    alert("✅ Voaray sy voatsapa soa aman-tsara ilay SMS test!");
}

function initSMSListener() {
    if (window.SMSReceive) {
        window.SMSReceive.startWatch(() => {
            document.addEventListener('onSMSArrive', (e) => {
                processIncomingSMS(e.data.address, e.data.body);
            });
        }, (err) => console.error("Tsy afaka nanomboka SMS listener:", err));
    }
}

function parseSMSContent(body) {
    let type = "Inconnu", montant = 0, reference = "N/A", numero = "-", solde = 0, bonus = 0;
    const cleanBody = body.replace(/\s+/g, ' ');

    if (/depot|dépôt/i.test(cleanBody)) type = "Dépôt";
    else if (/retrait/i.test(cleanBody)) type = "Retrait";
    else if (/transfert|envoye|recu|reçu/i.test(cleanBody)) type = "Transfert";
    else if (/achat credit|achat de crédit|recharge/i.test(cleanBody)) type = "Achat Crédit";

    const numMatch = cleanBody.match(/(?:03[2348][0-9\s.-]{7,11}|\+?261\s*3[2348][0-9\s.-]{7,11})/);
    if (numMatch) numero = numMatch[0].replace(/[\s.-]/g, '');

    const refMatch = cleanBody.match(/(?:Ref|ID|Transaction|Trans)\s*:?\s*([A-Za-z0-9.]+)/i);
    if (refMatch) reference = refMatch[1];

    const montantMatch = cleanBody.match(/(?:de|montant|valeur)?\s*([\d\s,.]+)\s*Ar/i);
    if (montantMatch) montant = parseInt(montantMatch[1].replace(/[\s,.]/g, ''), 10) || 0;

    const soldeMatch = cleanBody.match(/(?:Solde|Nouveau solde|reste)\s*:?\s*([\d\s,.]+)\s*Ar/i);
    if (soldeMatch) solde = parseInt(soldeMatch[1].replace(/[\s,.]/g, ''), 10) || 0;

    const bonusMatch = cleanBody.match(/Bonus\s*:?\s*([\d\s,.]+)\s*Ar/i);
    if (bonusMatch) bonus = parseInt(bonusMatch[1].replace(/[\s,.]/g, ''), 10) || 0;

    return { type, montant, reference, numero, solde, bonus, date: new Date().toLocaleString('fr-FR'), timestamp: new Date().toISOString(), rawText: body };
}

async function processIncomingSMS(sender, body) {
    const parsedData = parseSMSContent(body);
    parsedData.operator = sender || "Opérateur";
    if (parsedData.type !== "Inconnu" || parsedData.reference !== "N/A" || parsedData.montant > 0) {
        await saveTransaction(parsedData);
        await refreshUI();
    }
}

async function refreshUI() {
    try {
        const transactions = await getAllTransactions();
        
        let countDepot = 0, countRetrait = 0, countTransfert = 0, countAchat = 0;
        let soldeFarany = 0;
        let bonusAndroany = 0, bonusSabotsy = 0, bonusVolana = 0;
        
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());

        const tbodyDashboard = document.getElementById('tx-tbody');
        const tbodyJournal = document.getElementById('full-journal-tbody');
        tbodyDashboard.innerHTML = ""; tbodyJournal.innerHTML = "";

        if (transactions.length === 0) {
            tbodyDashboard.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">Tsy mbola misy tranzaksion...</td></tr>`;
            tbodyJournal.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--text-muted);">Tsy mbola misy tranzaksion...</td></tr>`;
            document.getElementById('footer-solde-farany').innerText = "0 Ar";
        } else {
            soldeFarany = transactions[0].solde;

            transactions.forEach((tx, idx) => {
                const txDate = new Date(tx.timestamp);

                if (tx.type === "Dépôt") countDepot++;
                else if (tx.type === "Retrait") countRetrait++;
                else if (tx.type === "Transfert") countTransfert++;
                else if (tx.type === "Achat Crédit") countAchat++;

                if (tx.bonus > 0) {
                    if (txDate.toDateString() === now.toDateString()) bonusAndroany += tx.bonus;
                    if (txDate >= startOfWeek) bonusSabotsy += tx.bonus;
                    if (txDate.getMonth() === now.getMonth() && txDate.getFullYear() === now.getFullYear()) bonusVolana += tx.bonus;
                }

                let badgeClass = "badge-transfert";
                if (tx.type === "Dépôt") badgeClass = "badge-depot";
                else if (tx.type === "Retrait") badgeClass = "badge-retrait";
                else if (tx.type === "Achat Crédit") badgeClass = "badge-achat";

                if (idx < 5) {
                    tbodyDashboard.innerHTML += `<tr><td>${tx.date}</td><td><span class="badge ${badgeClass}">${tx.type}</span></td><td><strong>${tx.numero || '-'}</strong></td><td><strong>${tx.montant.toLocaleString()} Ar</strong></td><td>${tx.solde.toLocaleString()} Ar</td></tr>`;
                }

                tbodyJournal.innerHTML += `<tr><td>${tx.date}</td><td>${tx.operator}</td><td><span class="badge ${badgeClass}">${tx.type}</span></td><td><strong>${tx.numero || '-'}</strong></td><td><strong>${tx.montant.toLocaleString()} Ar</strong></td><td>${tx.bonus ? tx.bonus.toLocaleString() + ' Ar' : '-'}</td><td>${tx.reference}</td><td>${tx.solde.toLocaleString()} Ar</td></tr>`;
            });

            document.getElementById('footer-solde-farany').innerText = `${soldeFarany.toLocaleString()} Ar`;
        }

        document.getElementById('count-depot').innerText = countDepot;
        document.getElementById('count-retrait').innerText = countRetrait;
        document.getElementById('count-transfert').innerText = countTransfert;
        document.getElementById('count-achat').innerText = countAchat;
        
        document.getElementById('stat-solde-farany').innerText = `${soldeFarany.toLocaleString()} Ar`;
        document.getElementById('stat-bonus-androany').innerText = `${bonusAndroany.toLocaleString()} Ar`;
        document.getElementById('stat-bonus-sabotsy').innerText = `${bonusSabotsy.toLocaleString()} Ar`;
        document.getElementById('stat-bonus-volana').innerText = `${bonusVolana.toLocaleString()} Ar`;

    } catch (e) {
        console.error("UI Refresh error:", e);
    }
}

async function exportToCSV() {
    try {
        const txs = await getAllTransactions();
        if (txs.length === 0) { alert("Tsy misy data azo havoaka (Export)!"); return; }

        let csvContent = "Daty sy Ora,Operateur,Karazana,Laharana,Montant (Ar),Bonus (Ar),Reference,Solde Sisa (Ar)\n";
        txs.forEach(tx => {
            csvContent += `"${tx.date}","${tx.operator}","${tx.type}","${tx.numero}","${tx.montant}","${tx.bonus}","${tx.reference}","${tx.solde}"\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Boky_Vola_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        alert("Voaray anaty rakitra ny Bokin'ny Volanao (Export CSV)!");
    } catch (e) {
        console.error("Export error:", e);
        alert("Nisy olana ny fanaovana Export.");
    }
}

async function famafanaArovanaAminKaody() {
    const kaodyNampidirina = prompt("Ampiarovana ny data!\nAmpidiro ny kaody miafina hamafana ny Bokin'ny Vola rehetra:");
    if (kaodyNampidirina === "1234") {
        if (confirm("Tena tianao hafahana avokoa ve ny data rehetra ao amin'ny bokin'ny vola?")) {
            await clearDatabase();
            await refreshUI();
            alert("Voafafa ny data rehetra.");
        }
    } else if (kaodyNampidirina !== null) {
        alert("❌ Diso ny kaody! Tsy voafafa ny data.");
    }
}