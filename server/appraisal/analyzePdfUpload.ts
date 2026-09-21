import multer from 'multer';

const storage = multer.memoryStorage();

export const analyzePdfUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, fieldSize: 12 * 1024 * 1024 },
});
