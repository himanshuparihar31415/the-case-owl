import multer from 'multer';

const ALLOWED = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

export const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RESUME_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const okName = /\.(pdf|docx)$/i.test(file.originalname);
    if (ALLOWED.has(file.mimetype) || okName) cb(null, true);
    else cb(new Error('Upload a PDF or DOCX resume'));
  },
});
