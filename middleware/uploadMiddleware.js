const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 🟣 إنشاء مجلد الفيديوهات
const videoDir = path.join(__dirname, '../uploads/videos');
fs.mkdirSync(videoDir, { recursive: true });

// 🟣 إعداد التخزين للدروس (فيديو فقط)
const lessonStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, videoDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

// 🟣 فلتر للدروس (فيديو فقط)
const lessonFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (file.mimetype.startsWith('video/') || ext === '.mp4' || ext === '.mov') {
    cb(null, true);
  } else {
    cb(new Error('Only video files are allowed for lessons'), false);
  }
};

// ✅ ميدلوير رفع درس (فيديو فقط)
const uploadLesson = multer({
  storage: lessonStorage,
  fileFilter: lessonFileFilter,
}).single('video');

// 🟢 إنشاء مجلد التسليمات
const submissionDir = path.join(__dirname, '../uploads/submissions');
fs.mkdirSync(submissionDir, { recursive: true });

// 🟢 إعداد تخزين التسليمات (أي نوع)
const submissionStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, submissionDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

// ✅ ميدلوير رفع تسليم (أي نوع ملف)
const uploadSubmission = multer({
  storage: submissionStorage,
  // لا نضع fileFilter هنا حتى يقبل أي نوع ملف
}).single('file');

// 🧾 تصدير كلا الميدلويرين
module.exports = {
  uploadLesson,
  uploadSubmission
};









/* const multer = require('multer');
const path = require('path');
const fs = require('fs');

// تأكد من وجود المجلدات
const videoDir = path.join(__dirname, '../uploads/videos');
const pdfDir = path.join(__dirname, '../uploads/pdf');
fs.mkdirSync(videoDir, { recursive: true });
fs.mkdirSync(pdfDir, { recursive: true });

// إعداد التخزين للفيديو والPDF
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.mimetype.startsWith('video/')) {
      cb(null, videoDir);
    } else if (file.mimetype === 'application/pdf') {
      cb(null, pdfDir);
    } else {
      cb(new Error('Unsupported file type'), null);
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

// التحقق من نوع الملفات المقبولة
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('video/') || file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only video and PDF files are allowed'), false);
  }
};

const upload = multer({ storage, fileFilter });

// ميدلوير لدروس المعلم
const uploadLesson = upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'pdf', maxCount: 1 },
]);

module.exports = { uploadLesson };
*/
// backend/middleware/uploadMiddleware.js
/*const multer = require('multer');
const path = require('path');
const fs = require('fs');

// === Directories ===
const videoDir = path.join(__dirname, '../uploads/videos');
const pdfDir = path.join(__dirname, '../uploads/pdf');
const submissionDir = path.join(__dirname, '../uploads/submissions'); // 📂 جديد للتسليمات

fs.mkdirSync(videoDir, { recursive: true });
fs.mkdirSync(pdfDir, { recursive: true });
fs.mkdirSync(submissionDir, { recursive: true });

// === Storage for lessons (video/pdf) ===
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.mimetype.startsWith('video/')) {
      cb(null, videoDir);
    } else if (file.mimetype === 'application/pdf') {
      cb(null, pdfDir);
    } else {
      cb(new Error('Unsupported file type'), null);
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

// === Storage for student submissions ===
const submissionStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, submissionDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const fileFilter = (req, file, cb) => {
  if (
    file.mimetype.startsWith('video/') ||
    file.mimetype.startsWith('application/pdf') || // More permissive: startsWith
    file.mimetype.startsWith('application/x-pdf') || // Common alternative
    file.mimetype === 'application/octet-stream' ||
    file.mimetype.startsWith('image/') ||
    file.mimetype === 'text/plain'
  ) {
    cb(null, true);
  } else {
    console.warn(`File rejected by filter: ${file.originalname}, MIME type: ${file.mimetype}`); // Log actual MIME type
    cb(new Error('Unsupported file type. Allowed: Video, PDF, Image, Text.'), false);
  }
};

// === Uploaders ===
const upload = multer({ storage, fileFilter });
const uploadSubmission = multer({ storage: submissionStorage, fileFilter });

// === Export All ===
module.exports = {
  upload,                     // raw multer
  uploadLesson: upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'pdf', maxCount: 1 },
  ]),
  uploadSubmission: uploadSubmission.single('file') // 📥 الطالب يرفع ملف واحد
};*/
