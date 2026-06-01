import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define la ruta base para almacenamiento local
const UPLOADS_DIR = path.join(__dirname, '../uploads');

// Asegurar que el directorio de uploads existe
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

class StorageService {
  constructor() {
    this.storageType = process.env.STORAGE_TYPE || 'local'; // 'local' o 's3'
  }

  /**
   * Guarda un archivo en el almacenamiento configurado
   * @param {Object} file - Objeto de archivo de multer
   * @returns {Promise<Object>} Metadata del archivo guardado
   */
  async uploadFile(file) {
    if (this.storageType === 's3') {
      return await this.uploadToS3(file);
    } else {
      return await this.uploadToLocal(file);
    }
  }

  /**
   * Almacenamiento Local (Implementación actual)
   */
  async uploadToLocal(file) {
    // Multer ya guarda el archivo si se configura un storage de disco,
    // pero aquí centralizamos la lógica de retorno de URL/Path.
    const filename = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    // Si multer usó memoryStorage, escribimos el buffer
    if (file.buffer) {
      fs.writeFileSync(filePath, file.buffer);
    }

    return {
      filename: filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      url: `/uploads/${filename}`,
      storageType: 'local'
    };
  }

  /**
   * Almacenamiento S3 (Placeholder para el futuro)
   */
  async uploadToS3(file) {
    // TODO: Implementar lógica de AWS SDK cuando se configure S3
    console.log('S3 Storage no implementado aún. Usando local por defecto.');
    return await this.uploadToLocal(file);
  }

  /**
   * Elimina un archivo
   */
  async deleteFile(filename, storageType) {
    if (storageType === 's3') {
      // TODO: Implementar delete en S3
    } else {
      const filePath = path.join(UPLOADS_DIR, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }
}

export default new StorageService();
