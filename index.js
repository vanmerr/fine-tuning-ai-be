require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const XLSX = require("xlsx"); // Thêm dòng này

const app = express();
app.use(
  cors({
    origin: [
      "https://fine-tuning-ai-fe.onrender.com",
      "http://localhost:5173"
    ],
    methods: ["GET", "POST"],
    credentials: true,
  })
);
app.use(express.json());

const upload = multer({ dest: "uploads/" });

// Khởi tạo Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Hàm đọc file thành buffer
function fileToGenerativePart(filePath, mimeType) {
  const data = fs.readFileSync(filePath);
  return {
    inlineData: {
      data: data.toString("base64"),
      mimeType,
    },
  };
}

// Hàm trích xuất text từ file
async function extractText(filePath, mimetype) {
  if (mimetype === "application/pdf") {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  }
  if (
    mimetype ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  if (mimetype === "text/plain") {
    return fs.readFileSync(filePath, "utf8");
  }
  // Thêm xử lý cho file Excel
  if (
    mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    const workbook = XLSX.readFile(filePath);
    let text = "";
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
      sheet.forEach((row) => {
        text += row.join(" ") + "\n";
      });
    });
    return text;
  }
  throw new Error("Unsupported file type");
}

// Upload & phân tích file, lưu vào data.txt
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const { file } = req;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    // Tự trích xuất text từ file
    const text = await extractText(file.path, file.mimetype);

    fs.unlinkSync(file.path); // Xóa file sau khi xử lý

    // Lưu nội dung vào data.txt (ghi tiếp)
    fs.appendFileSync("data.txt", "\n\n" + text, "utf8");

    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API chat: kết hợp câu hỏi với data.txt
app.post("/api/chat", async (req, res) => {
  try {
    const { question } = req.body;
    // Đọc nội dung từ data.txt
    const context = fs.existsSync("data.txt")
      ? fs.readFileSync("data.txt", "utf8")
      : "";

    const prompt = `
You are an intelligent assistant tasked with answering user questions based on the provided document(s).

When receiving a question, follow these steps:

If the question is related to the content of the provided document:
    - Extract the relevant information from the document to form your answer.
    - If any part of the relevant content contains a URL (link) that appears related to the question:
        - Visit that URL to gather additional information.
        - Combine the information from the URL and the document to provide a complete and accurate response.

If the question is unrelated to the document:
    - Answer the question using your general knowledge as a standard AI assistant.

When responding, clearly indicate which case you are handling by stating one of the following:

"Based on the content of the provided document..."

"I accessed a related link in the document to supplement the answer..."

"This question is not related to the document, so I will answer based on general knowledge..."

--------------------------
Document content:
${context}

Question: ${question}

`;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // hoặc nếu cần chất lượng cao hơn: gemini-1.5-pro
    const result = await model.generateContent([{ text: prompt }]);
    const answer = result.response.text();

    res.json({ answer });
  
  } catch (err) {

    res.status(500).json({ error: err.message });
  }
});

// API health check
app.get("/api/ping", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(5000, () => console.log("Backend running on http://localhost:5000"));
