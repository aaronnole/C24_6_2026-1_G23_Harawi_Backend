import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, '../uploads');
const WAVEFORMS_DIR = path.join(UPLOADS_DIR, 'waveforms');

function ensureDir(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

function sanitizeFilename(filename) {
  return String(filename || 'file')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildObjectKey(folder, filename) {
  const safeFilename = sanitizeFilename(filename);
  const normalizedFolder = folder
    ? String(folder).replace(/^\/+|\/+$/g, '').replace(/\\/g, '/')
    : '';
  const uniquePrefix = `${Date.now()}-${crypto.randomUUID()}`;

  return normalizedFolder
    ? `${normalizedFolder}/${uniquePrefix}-${safeFilename}`
    : `${uniquePrefix}-${safeFilename}`;
}

function encodeS3Key(key) {
  return String(key)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

ensureDir(UPLOADS_DIR);
ensureDir(WAVEFORMS_DIR);

class StorageService {
  constructor() {
    this.storageType = process.env.STORAGE_TYPE || 'local';
    this.bucketName = process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET || '';
    this.region = process.env.AWS_REGION || process.env.S3_REGION || '';
    this.publicBaseUrl = String(process.env.S3_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    this.endpoint = process.env.S3_ENDPOINT || undefined;
    this.forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true';
    this.s3Client = this.storageType === 's3'
      ? new S3Client({
          region: this.region || undefined,
          endpoint: this.endpoint,
          forcePathStyle: this.forcePathStyle,
        })
      : null;
  }

  isS3() {
    return this.storageType === 's3';
  }

  assertS3Config() {
    if (!this.bucketName) {
      throw new Error('Falta configurar S3_BUCKET_NAME para usar almacenamiento en S3.');
    }

    if (!this.region && !this.endpoint) {
      throw new Error('Falta configurar AWS_REGION para usar almacenamiento en S3.');
    }
  }

  getPublicUrl(key) {
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${encodeS3Key(key)}`;
    }

    if (!this.bucketName || !this.region) {
      throw new Error('No se pudo construir la URL publica del archivo en S3.');
    }

    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${encodeS3Key(key)}`;
  }

  getKeyFromUrl(url) {
    if (!url) return null;

    if (this.publicBaseUrl && url.startsWith(`${this.publicBaseUrl}/`)) {
      return decodeURIComponent(url.slice(this.publicBaseUrl.length + 1));
    }

    const regionalPrefix = this.region && this.bucketName
      ? `https://${this.bucketName}.s3.${this.region}.amazonaws.com/`
      : null;

    if (regionalPrefix && url.startsWith(regionalPrefix)) {
      return decodeURIComponent(url.slice(regionalPrefix.length));
    }

    return null;
  }

  async uploadFile(file, options = {}) {
    if (this.isS3()) {
      return this.uploadToS3(file, options);
    }

    return this.uploadToLocal(file, options);
  }

  async uploadGeneratedFile({ buffer, originalName, mimetype, folder = '' }) {
    const generatedFile = {
      buffer,
      originalname: originalName,
      mimetype,
      size: buffer.length,
    };

    return this.uploadFile(generatedFile, { folder });
  }

  async uploadToLocal(file, options = {}) {
    const folder = String(options.folder || '').replace(/^\/+|\/+$/g, '');
    const filename = `${Date.now()}-${sanitizeFilename(file.originalname)}`;
    const relativePath = folder ? path.join(folder, filename) : filename;
    const targetDir = folder ? path.join(UPLOADS_DIR, folder) : UPLOADS_DIR;
    const filePath = path.join(targetDir, filename);

    ensureDir(targetDir);

    if (!file.buffer) {
      throw new Error('No se recibio el contenido del archivo para guardarlo localmente.');
    }

    fs.writeFileSync(filePath, file.buffer);

    return {
      filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      key: relativePath.replace(/\\/g, '/'),
      url: `/uploads/${relativePath.replace(/\\/g, '/')}`,
      storageType: 'local',
    };
  }

  async uploadToS3(file, options = {}) {
    this.assertS3Config();

    if (!file.buffer) {
      throw new Error('No se recibio el contenido del archivo para subirlo a S3.');
    }

    const key = buildObjectKey(options.folder, file.originalname);
    const upload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
      },
    });

    await upload.done();

    return {
      filename: path.basename(key),
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      key,
      url: this.getPublicUrl(key),
      storageType: 's3',
    };
  }

  async deleteFile(fileIdentifier, storageType = this.storageType) {
    if (!fileIdentifier) return;

    if (storageType === 's3') {
      this.assertS3Config();
      const key = fileIdentifier.includes('://')
        ? this.getKeyFromUrl(fileIdentifier)
        : fileIdentifier;

      if (!key) return;

      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        })
      );
      return;
    }

    const normalizedPath = String(fileIdentifier)
      .replace(/^\/?uploads\/?/i, '')
      .replace(/\//g, path.sep);
    const filePath = path.join(UPLOADS_DIR, normalizedPath);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async deleteFiles(fileIdentifiers = [], storageType = this.storageType) {
    for (const fileIdentifier of fileIdentifiers) {
      try {
        await this.deleteFile(fileIdentifier, storageType);
      } catch (error) {
        console.error('No se pudo eliminar el archivo del storage:', error);
      }
    }
  }
}

export default new StorageService();
