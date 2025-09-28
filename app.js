import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  onSnapshot,
  runTransaction
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

/* ------------------ SETUP FIREBASE ------------------ */
const firebaseConfig = {
  apiKey: "AIzaSyBHFjQYNV3I972Z6iBjNV0rmwSaCRqRePw",
  authDomain: "borrowlocal-933e3.firebaseapp.com",
  projectId: "borrowlocal-933e3",
  storageBucket: "borrowlocal-933e3.firebasestorage.app",
  messagingSenderId: "508806095039",
  appId: "1:508806095039:web:afcc60ff7cc96b6277a60a",
  measurementId: "G-XJ59FF1E7K"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const devicesCol = collection(db, "devices");

let devices = [];

function normalizeDevicesArray(arr) {
  return arr.map(d => {
    d.borrowRecords = Array.isArray(d.borrowRecords) ? d.borrowRecords.map(r => ({
      firstname: r.firstname || "",
      lastname: r.lastname || "",
      department: r.department || "",
      quantity: Number(r.quantity || 0),
      borrowDate: r.borrowDate || new Date().toISOString()
    })) : [];

    d.borrowed = Number.isFinite(Number(d.borrowed)) ? Number(d.borrowed) : d.borrowRecords.reduce((s, r) => s + (Number(r.quantity)||0), 0);
    d.total = Number.isFinite(Number(d.total)) ? Number(d.total) : 0;
    return d;
  });
}

const defaultDevices = [
  { id: "1", name: 'ไขควง', total: 20, borrowed: 0, borrowRecords: []},
  { id: "2", name: 'คีม', total: 15, borrowed: 0, borrowRecords: []},
  { id: "3", name: 'ตลับเมตร', total: 10, borrowed: 0, borrowRecords: []},
];

async function seedDevicesIfEmpty() {
  const snap = await getDocs(devicesCol);
  if (snap.empty) {
    for (const d of defaultDevices) {
      await setDoc(doc(db, "devices", d.id), d);
    }
    console.log("Seeded devices into Firestore.");
  }
}

/* ------------------ Real-time listener ------------------ */
onSnapshot(devicesCol, (snapshot) => {
  const docs = snapshot.docs.map(s => ({ id: s.id, ...s.data() }));
  devices = normalizeDevicesArray(docs);
  renderDevices();
  populateDeviceOptions();
  renderStatus();
});

seedDevicesIfEmpty().catch(err => console.warn("seed error:", err));

/* ------------------ EMAIL FUNCTIONS ------------------ */
function sendLateReturnEmail(deviceName, details) {
  emailjs.send("service_eswn7hl", "template_late_return", {
    device_name: deviceName,
    details: details
  })
  .then(res => console.log("ส่งเมลคืนช้าสำเร็จ", res))
  .catch(err => console.error("ส่งเมลคืนช้าไม่สำเร็จ", err));
}

function sendLowStockEmail(deviceName, remaining, threshold) {
  emailjs.send("service_eswn7hl", "template_low_stock", {
    device_name: deviceName,
    remaining: remaining,
    threshold: threshold
  })
  .then(res => console.log("ส่งเมลสต็อกน้อยสำเร็จ", res))
  .catch(err => console.error("ส่งเมลสต็อกน้อยไม่สำเร็จ", err));
}

/* ------------------ UI Rendering ------------------ */
function renderDevices() {
  const tbody = document.querySelector('#device-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  devices.forEach(device => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${device.name}</td>
      <td>${device.total}</td>
      <td>${device.borrowed}</td>
    `;
    tbody.appendChild(tr);
  });
}

function populateDeviceOptions() {
  const select = document.getElementById('device-select');
  if (!select) return;
  select.innerHTML = '';
  devices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.id;
    option.textContent = device.name;
    select.appendChild(option);
  });
}

function renderStatus() {
  const tbody = document.querySelector('#status-table tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  const now = new Date();

  devices.forEach(device => {
    if (device.borrowRecords && device.borrowRecords.length > 0) {
      device.borrowRecords.forEach(record => {
        const borrowDate = new Date(record.borrowDate);
        const diffDays = Math.floor((now - borrowDate) / (1000 * 60 * 60 * 24));

        let statusText = "ยืมอยู่";
        let fine = 0;
        
        // จำนวนวันที่เกินกำหนด (ถ้ามี)
        const lateDays = diffDays > 7 ? diffDays - 7 : 0; 
        
        if (lateDays > 0) {
          statusText = "เกินกำหนด (" + lateDays + " วัน)"; // 👈 แสดงจำนวนวัน *ที่เกินกำหนด*
          fine = lateDays * 10; // 👈 คำนวณค่าปรับ 10 บาทต่อวัน (ถูกต้องตามโค้ดเดิม)

          // 🔔 ส่งอีเมลแจ้งเตือนคืนช้า
          sendLateReturnEmail(device.name, `\nผู้ยืม: ${record.firstname} ${record.lastname} (${record.department})\nยืมวันที่: ${borrowDate.toLocaleDateString()}\nเกินกำหนด: ${lateDays} วัน`);
        }
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${device.name}</td>
          <td>${record.quantity}</td>
          <td>${record.firstname || "-"}</td>
          <td>${record.lastname || "-"}</td>
          <td>${record.department || "-"}</td>
          <td>${isNaN(borrowDate) ? "-" : borrowDate.toLocaleDateString()}</td>
          <td>${statusText}</td>
          <td>${fine > 0 ? fine + " บาท" : "-"}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  });
}

/* ------------------ Borrow / Return ------------------ */
async function handleBorrowReturn(e) {
  e.preventDefault();
  const deviceId = document.getElementById('device-select')?.value;
  const action = document.getElementById('action-select')?.value;
  const quantity = parseInt(document.getElementById('quantity-input')?.value || "0", 10);
  const messageEl = document.getElementById('message');

  if (!deviceId) {
    messageEl.textContent = 'กรุณาเลือกอุปกรณ์';
    messageEl.style.color = 'red';
    return;
  }

  if (!quantity || quantity <= 0) {
    messageEl.textContent = 'กรุณากรอกจำนวนให้ถูกต้อง';
    messageEl.style.color = 'red';
    return;
  }

  const firstname = document.getElementById('firstname-input')?.value?.trim() || '';
  const lastname = document.getElementById('lastname-input')?.value?.trim() || '';
  const department = document.getElementById('department-input')?.value?.trim() || '';

  const docRef = doc(db, "devices", deviceId);

  try {
    await runTransaction(db, async (t) => {
      const snap = await t.get(docRef);
      if (!snap.exists()) throw new Error('ไม่พบอุปกรณ์ที่เลือก');

      const data = snap.data();
      const borrowed = Number(data.borrowed || 0);
      const total = Number(data.total || 0);
      const records = Array.isArray(data.borrowRecords) ? [...data.borrowRecords] : [];

      if (action === 'borrow') {
        if (total - borrowed < quantity) throw new Error(`อุปกรณ์ "${data.name}" มีจำนวนไม่เพียงพอ (เหลือ ${total - borrowed})`);
        const newRecord = { firstname, lastname, department, quantity, borrowDate: new Date().toISOString() };
        records.push(newRecord);
        t.update(docRef, { borrowRecords: records, borrowed: borrowed + quantity });

        // 🔔 เช็คสต็อกเหลือน้อย
        const remaining = total - (borrowed + quantity);
        if (remaining <= 5) {
          sendLowStockEmail(data.name, remaining, 5);
        }
      } else if (action === 'return') {
        if (borrowed < quantity) throw new Error(`จำนวนคืนมากกว่าจำนวนที่ยืมไป (${borrowed})`);
        let remaining = quantity;
        let i = 0;
        while (i < records.length && remaining > 0) {
          const r = records[i];
          if (r.quantity <= remaining) {
            remaining -= r.quantity;
            records.splice(i, 1);
          } else {
            r.quantity -= remaining;
            remaining = 0;
            i++;
          }
        }
        t.update(docRef, { borrowRecords: records, borrowed: Math.max(0, borrowed - quantity) });
      } else {
        throw new Error('การดำเนินการไม่ถูกต้อง');
      }
    });

    if (action === 'borrow') {
      messageEl.textContent = `ยืมอุปกรณ์ สำเร็จ`;
    } else {
      messageEl.textContent = `คืนอุปกรณ์ สำเร็จ`;
    }
    messageEl.style.color = 'green';
    e.target.reset();
  } catch (err) {
    messageEl.textContent = err.message || 'เกิดข้อผิดพลาด';
    messageEl.style.color = 'red';
    console.error(err);
  }
}

/* ------------------ Hook form submit ------------------ */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('borrow-return-form');
  if (form) form.addEventListener('submit', handleBorrowReturn);

  renderDevices();
  populateDeviceOptions();
  renderStatus();
});