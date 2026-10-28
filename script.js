"use strict";

// Dán URL ở đây nếu muốn mở trang là tự tải dữ liệu.
// Để trống thì dán URL vào ô trên giao diện rồi nhấn nút đọc.
const DEFAULT_SHEET_URL = "";
const DEFAULT_SHEET_NAME = ""; // Ví dụ: "data". Để trống để dùng gid từ URL.

const form = document.getElementById("sheet-form");
const input = document.getElementById("sheet-url");
const button = document.getElementById("load-button");
const status = document.getElementById("status");
const tabInput = document.getElementById("sheet-name");
const thead = document.getElementById("sheet-head");
const tbody = document.getElementById("sheet-rows");
input.value = DEFAULT_SHEET_URL;
tabInput.value = DEFAULT_SHEET_NAME;

function showStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function getQueryUrl(value, sheetName = "") {
  const url = new URL(value.trim());
  const match = url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)(?:\/|$)/);
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !match) {
    throw new Error("Hãy dán liên kết chỉnh sửa Google Sheets dạng https://docs.google.com/spreadsheets/d/ID/edit…");
  }
  const hash = new URLSearchParams(url.hash.slice(1));
  const gid = hash.get("gid") || url.searchParams.get("gid") || "0";
  if (!sheetName && !/^\d+$/.test(gid)) throw new Error("gid của tab không hợp lệ.");
  // Không giới hạn range A:B nữa. headers=1 dùng dòng đầu làm nhãn cột.
  const params = new URLSearchParams({ headers: "1" });
  if (sheetName) params.set("sheet", sheetName);
  else params.set("gid", gid);
  return `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?${params}`;
}

function renderTable(data) {
  const rowCount = data.getNumberOfRows();
  let columnCount = data.getNumberOfColumns();
  // Loại cột trống ở cuối; vẫn giữ cột trống nằm giữa các cột có dữ liệu.
  while (columnCount > 0) {
    const col = columnCount - 1;
    if (data.getColumnLabel(col).trim()) break;
    let hasValue = false;
    for (let row = 0; row < rowCount; row++) {
      if (data.getFormattedValue(row, col).trim()) { hasValue = true; break; }
    }
    if (hasValue) break;
    columnCount--;
  }
  const header = document.createElement("tr");
  for (let col = 0; col < columnCount; col++) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = data.getColumnLabel(col) || `Cột ${col + 1}`;
    header.appendChild(th);
  }
  thead.replaceChildren(header);
  const fragment = document.createDocumentFragment();
  let count = 0;
  for (let row = 0; row < rowCount; row++) {
    const values = Array.from({ length: columnCount }, (_, col) => data.getFormattedValue(row, col));
    if (values.every(value => !value.trim())) continue;
    const tr = document.createElement("tr");
    for (const value of values) {
      const td = document.createElement("td");
      // Không dùng innerHTML với dữ liệu lấy từ bên ngoài.
      td.textContent = value;
      tr.appendChild(td);
    }
    fragment.appendChild(tr);
    count++;
  }
  tbody.replaceChildren(fragment);
  showStatus(columnCount ? `Đã tải ${count} dòng dữ liệu, ${columnCount} cột. Nhấn tải lại để cập nhật (có thể có độ trễ bộ nhớ đệm).` : "Tab chưa có dữ liệu.");
}

async function loadSheet() {
  let queryUrl;
  try {
    queryUrl = getQueryUrl(input.value, tabInput.value.trim());
  } catch (error) {
    showStatus(error.message, true);
    return;
  }
  button.disabled = true;
  thead.replaceChildren();
  tbody.replaceChildren();
  const diagnosticLink = document.getElementById("diagnostic-link");
  diagnosticLink.href = queryUrl + "&tqx=out:json";
  diagnosticLink.hidden = false;
  showStatus("Đang đọc Google Sheets…");
  // Đọc JSON bằng fetch trước để tránh phụ thuộc vào callback script chéo miền.
  // Không eval nội dung trả về; chỉ tách phần JSON trong phản hồi Google.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(queryUrl + "&tqx=out:json", {
      credentials: "omit", signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
    if (!match) throw new Error("Google không trả về dữ liệu JSON.");
    const payload = JSON.parse(match[1]);
    if (payload.status === "error") {
      throw new Error((payload.errors || []).map(e => e.detailed_message || e.message).join("; "));
    }
    renderTable(new google.visualization.DataTable(payload.table));
    button.disabled = false;
    return;
  } catch (error) {
    console.warn("Đọc bằng fetch chưa thành công; thử Google Query:", error.message);
  } finally {
    clearTimeout(timer);
  }
  showStatus("Đang thử phương thức đọc dự phòng…");
  const query = new google.visualization.Query(queryUrl, { sendMethod: "scriptInjection" });
  query.setTimeout(30);
  query.send((response) => {
    button.disabled = false;
    try {
      if (response.isError()) {
        throw new Error(`Không đọc được dữ liệu: ${response.getMessage()}\nNhấn đường dẫn kiểm tra bên dưới. Nếu thấy trang đăng nhập hoặc báo lỗi, kiểm tra URL/tab và quyền chia sẻ. Nếu thấy JSON chứa dữ liệu, kiểm tra Console/Network (F12) của trang web; thử chạy qua localhost thay vì file://.`);
      }
      renderTable(response.getDataTable());
    } catch (error) {
      showStatus(error.message, true);
    }
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!button.disabled) loadSheet();
});

if (!window.google || !google.charts) {
  showStatus("Không tải được thư viện Google. Kiểm tra mạng hoặc trình chặn nội dung rồi tải lại trang.", true);
} else {
  google.charts.load("current", { packages: ["table"] });
  google.charts.setOnLoadCallback(() => {
    button.disabled = false;
    showStatus("Dán liên kết Google Sheets rồi nhấn đọc dữ liệu.");
    if (DEFAULT_SHEET_URL) loadSheet();
  });
}
